/**
 * O ADMINISTRADOR DO CRM — a rodada que mantém a casa em ordem sozinha.
 *
 * Tem DUAS metades, separadas de propósito:
 *
 *  1. `decidirAcoes` — PURA. Recebe um retrato estruturado (ids, datas,
 *     booleanos, status) e devolve a lista de ações. Não lê título, nota,
 *     nome nem mensagem: texto de cliente é dado, nunca instrução, e a forma
 *     mais barata de garantir isso é a função não ter onde ler texto. Sem LLM
 *     na v1; determinística; testável sem banco.
 *  2. `executarAdministrador` — carrega o retrato (sempre filtrado pela
 *     organização que o JOB informou), decide, e executa no máximo `limite`
 *     ações pelas ferramentas seguras de `lib/mcp/tools/administracao.ts`
 *     (que auditam cada uma). Devolve um relatório.
 *
 * ─── AS REGRAS (pequenas, de propósito) ─────────────────────────────────────
 *  R1  Lead aberto numa etapa ARQUIVADA        → move para a primeira etapa
 *      ativa do mesmo funil (se não houver, não faz nada).
 *  R2  Lead aberto sem atividade há 7+ dias
 *      e sem tarefa em aberto                  → cria tarefa de retomada.
 *  R3  Conversa aberta/pendente, sem responsável,
 *      com a última mensagem do cliente há 24h+ → etiqueta o contato com
 *      `sem-responsavel` (uma vez por contato, e não repete se já tem).
 *
 * Idempotência vem do próprio retrato: depois de mover, o lead não está mais em
 * etapa arquivada; depois da tarefa, `temTarefaAberta`; depois da etiqueta,
 * `tagsDoContato`. Rodar duas vezes seguidas não repete nada.
 *
 * Desligado por padrão: quem chama (a rota de cron) só roda com
 * `ADMIN_AGENT_ENABLED=true`.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { McpContext } from "@/lib/mcp/types";
import {
  ADMIN_AGENT_ACTOR_ID,
  executarFerramentaAdministrador,
} from "@/lib/mcp/tools/administracao";

export const DIAS_PARA_LEAD_PARADO = 7;
export const HORAS_PARA_CONVERSA_SEM_RESPONSAVEL = 24;
/** Teto do que uma rodada LÊ por tabela — o limite de AÇÕES é outro. */
const TETO_DE_LEITURA = 500;
const TETO_DO_LIMITE = 100;

const DIA_MS = 86_400_000;
const HORA_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Retrato estruturado (nenhum campo de texto livre do cliente)
// ---------------------------------------------------------------------------

export interface LeadParaAvaliar {
  id: string;
  contactId: string | null;
  pipelineId: string;
  stageId: string;
  stageArquivada: boolean;
  primeiraEtapaAtivaId: string | null;
  ultimaAtividadeEm: string | null;
  criadoEm: string;
  temTarefaAberta: boolean;
}

export interface ConversaParaAvaliar {
  id: string;
  contactId: string | null;
  status: string;
  atribuidaA: string | null;
  ultimaEntradaEm: string | null;
  tagsDoContato: string[];
}

export interface RetratoDaOrganizacao {
  leads: LeadParaAvaliar[];
  conversas: ConversaParaAvaliar[];
}

export type AcaoDoAdministrador =
  | { ferramenta: "admin_mover_etapa"; args: { lead_id: string; to_stage_id: string } }
  | { ferramenta: "admin_criar_tarefa"; args: { lead_id: string; titulo: string; prazo: string; prioridade: "medium" } }
  | { ferramenta: "admin_etiquetar_contato"; args: { contact_id: string; tag: "sem-responsavel" } };

const TITULO_DA_TAREFA_DE_RETOMADA = "Retomar contato com lead parado";

// ---------------------------------------------------------------------------
// Decisão — PURA
// ---------------------------------------------------------------------------

export function decidirAcoes(retrato: RetratoDaOrganizacao, agora: Date): AcaoDoAdministrador[] {
  const acoes: AcaoDoAdministrador[] = [];
  const agoraMs = agora.getTime();

  for (const lead of retrato.leads) {
    if (lead.stageArquivada) {
      if (lead.primeiraEtapaAtivaId) {
        acoes.push({
          ferramenta: "admin_mover_etapa",
          args: { lead_id: lead.id, to_stage_id: lead.primeiraEtapaAtivaId },
        });
      }
      continue;
    }
    if (lead.temTarefaAberta) continue;
    const ref = Date.parse(lead.ultimaAtividadeEm ?? lead.criadoEm);
    if (Number.isFinite(ref) && agoraMs - ref >= DIAS_PARA_LEAD_PARADO * DIA_MS) {
      acoes.push({
        ferramenta: "admin_criar_tarefa",
        args: {
          lead_id: lead.id,
          titulo: TITULO_DA_TAREFA_DE_RETOMADA,
          prazo: new Date(agoraMs + DIA_MS).toISOString(),
          prioridade: "medium",
        },
      });
    }
  }

  const contatosJaEtiquetados = new Set<string>();
  for (const c of retrato.conversas) {
    if (c.status !== "open" && c.status !== "pending") continue;
    if (c.atribuidaA !== null || !c.contactId || !c.ultimaEntradaEm) continue;
    if (c.tagsDoContato.includes("sem-responsavel")) continue;
    if (contatosJaEtiquetados.has(c.contactId)) continue;
    const ref = Date.parse(c.ultimaEntradaEm);
    if (!Number.isFinite(ref) || agoraMs - ref < HORAS_PARA_CONVERSA_SEM_RESPONSAVEL * HORA_MS) continue;
    contatosJaEtiquetados.add(c.contactId);
    acoes.push({
      ferramenta: "admin_etiquetar_contato",
      args: { contact_id: c.contactId, tag: "sem-responsavel" },
    });
  }

  return acoes;
}

// ---------------------------------------------------------------------------
// Carregamento do retrato — SEMPRE escopado pela organização do job
// ---------------------------------------------------------------------------

interface LinhaEtapa {
  id: string;
  pipeline_id: string;
  position: number;
  is_archived: boolean;
  is_won: boolean;
  is_lost: boolean;
}

async function carregarRetrato(sb: SupabaseClient, organizationId: string): Promise<RetratoDaOrganizacao> {
  const ler = async <T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as T[];
  };

  const etapas = await ler<LinhaEtapa>(
    sb
      .from("crm_stages")
      .select("id, pipeline_id, position, is_archived, is_won, is_lost")
      .eq("organization_id", organizationId),
  );
  const etapaPorId = new Map(etapas.map((e) => [e.id, e]));
  const primeiraAtiva = new Map<string, LinhaEtapa>();
  for (const e of etapas) {
    if (e.is_archived || e.is_won || e.is_lost) continue;
    const atual = primeiraAtiva.get(e.pipeline_id);
    if (!atual || e.position < atual.position) primeiraAtiva.set(e.pipeline_id, e);
  }

  const leads = await ler<{
    id: string;
    contact_id: string | null;
    pipeline_id: string;
    stage_id: string;
    last_activity_at: string | null;
    created_at: string;
  }>(
    sb
      .from("crm_leads")
      .select("id, contact_id, pipeline_id, stage_id, last_activity_at, created_at")
      .eq("organization_id", organizationId)
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(TETO_DE_LEITURA),
  );

  const tarefas = await ler<{ lead_id: string }>(
    sb
      .from("crm_tasks")
      .select("lead_id")
      .eq("organization_id", organizationId)
      .in("status", ["pending", "in_progress"])
      .not("lead_id", "is", null)
      .limit(TETO_DE_LEITURA * 4),
  );
  const comTarefa = new Set(tarefas.map((t) => t.lead_id));

  const conversas = await ler<{
    id: string;
    contact_id: string | null;
    status: string;
    assigned_to_user_id: string | null;
    last_inbound_at: string | null;
  }>(
    sb
      .from("conversations")
      .select("id, contact_id, status, assigned_to_user_id, last_inbound_at")
      .eq("organization_id", organizationId)
      .in("status", ["open", "pending"])
      .is("assigned_to_user_id", null)
      .order("last_inbound_at", { ascending: true })
      .limit(TETO_DE_LEITURA),
  );

  const idsDeContato = [...new Set(conversas.map((c) => c.contact_id).filter((x): x is string => !!x))];
  const tagsPorContato = new Map<string, string[]>();
  if (idsDeContato.length > 0) {
    const contatos = await ler<{ id: string; tags: string[] | null }>(
      sb.from("contacts").select("id, tags").eq("organization_id", organizationId).in("id", idsDeContato),
    );
    for (const c of contatos) tagsPorContato.set(c.id, c.tags ?? []);
  }

  return {
    leads: leads.map((l) => ({
      id: l.id,
      contactId: l.contact_id,
      pipelineId: l.pipeline_id,
      stageId: l.stage_id,
      stageArquivada: etapaPorId.get(l.stage_id)?.is_archived === true,
      primeiraEtapaAtivaId: primeiraAtiva.get(l.pipeline_id)?.id ?? null,
      ultimaAtividadeEm: l.last_activity_at,
      criadoEm: l.created_at,
      temTarefaAberta: comTarefa.has(l.id),
    })),
    conversas: conversas.map((c) => ({
      id: c.id,
      contactId: c.contact_id,
      status: c.status,
      atribuidaA: c.assigned_to_user_id,
      ultimaEntradaEm: c.last_inbound_at,
      tagsDoContato: c.contact_id ? (tagsPorContato.get(c.contact_id) ?? []) : [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

export interface AdministradorAgente {
  /** Identifica o administrador na auditoria (metadata.actor_id). */
  id?: string;
  /** Cliente de serviço; as ferramentas filtram `organization_id` em toda consulta. */
  supabase: SupabaseClient;
  agora?: () => Date;
}

export interface RelatorioDoAdministrador {
  organizationId: string;
  /** Ações que as regras pediram nesta rodada (antes do limite). */
  decididas: number;
  executadas: number;
  falhas: number;
  adiadasPeloLimite: number;
  acoes: Array<{ ferramenta: string; ok: boolean; erro?: string }>;
}

export async function executarAdministrador(
  admin: AdministradorAgente,
  opcoes: { organizationId: string; limite: number },
): Promise<RelatorioDoAdministrador> {
  const { organizationId } = opcoes;
  const limite = Number.isFinite(opcoes.limite)
    ? Math.max(0, Math.min(Math.floor(opcoes.limite), TETO_DO_LIMITE))
    : 0;
  const relatorio: RelatorioDoAdministrador = {
    organizationId,
    decididas: 0,
    executadas: 0,
    falhas: 0,
    adiadasPeloLimite: 0,
    acoes: [],
  };
  if (limite === 0) return relatorio;

  const agora = admin.agora?.() ?? new Date();
  const retrato = await carregarRetrato(admin.supabase, organizationId);
  const decididas = decidirAcoes(retrato, agora);
  relatorio.decididas = decididas.length;

  const ctx: McpContext = {
    organizationId,
    role: "manager",
    actor: { type: "ai_agent", id: admin.id ?? ADMIN_AGENT_ACTOR_ID, role: "manager" },
    // Não é um token: o administrador roda pelo job. Vazio vira NULL na auditoria.
    apiTokenId: "",
    requestId: randomUUID(),
    supabase: admin.supabase,
  };

  const aExecutar = decididas.slice(0, limite);
  relatorio.adiadasPeloLimite = decididas.length - aExecutar.length;

  for (const acao of aExecutar) {
    try {
      await executarFerramentaAdministrador(acao.ferramenta, acao.args, ctx);
      relatorio.executadas++;
      relatorio.acoes.push({ ferramenta: acao.ferramenta, ok: true });
    } catch (err) {
      relatorio.falhas++;
      relatorio.acoes.push({
        ferramenta: acao.ferramenta,
        ok: false,
        erro: (err instanceof Error ? err.message : String(err)).split("\n", 1)[0]!.slice(0, 200),
      });
    }
  }
  return relatorio;
}
