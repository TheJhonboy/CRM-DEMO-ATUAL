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
 *     organização que o JOB informou), decide, e executa pelas ferramentas
 *     seguras de `lib/mcp/tools/administracao.ts` (que auditam cada uma).
 *     Devolve um relatório.
 *
 * ─── AS REGRAS (pequenas, de propósito) ─────────────────────────────────────
 *  R2  Lead aberto sem atividade há 7+ dias, sem tarefa em aberto e sem tarefa
 *      do próprio administrador nos últimos 7 dias (qualquer status)
 *                                              → cria tarefa de retomada.
 *  R3  Conversa aberta/pendente, sem responsável,
 *      com a última mensagem do cliente há 24h+ → etiqueta o contato com
 *      `sem-responsavel` (uma vez por contato, e não repete se já tem).
 *
 *  (R1, "mover lead de etapa arquivada", saiu da v1: mover etapa emite
 *  `lead.stage_changed`, que inscreve follow-ups automáticos. Ver o cabeçalho de
 *  lib/mcp/tools/administracao.ts.)
 *
 * Idempotência: depois da tarefa, o lead tem `temTarefaAberta` e, mesmo que a
 * tarefa seja fechada, `tarefaRecenteDoAdministrador` por 7 dias; depois da
 * etiqueta, `tagsDoContato`. Rodar duas vezes seguidas (inclusive rodadas
 * sobrepostas) não repete nada.
 *
 * LIMITES: o teto `limite` conta só AÇÕES BEM-SUCEDIDAS. As tentativas têm teto
 * próprio (3x o limite) e as regras se revezam, para que um alvo que sempre falha
 * numa regra não consuma o orçamento nem faça a outra regra passar fome.
 *
 * Desligado por padrão: quem chama (a rota de cron) só roda com
 * `ADMIN_AGENT_ENABLED=true` E com a organização habilitada.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { McpContext } from "@/lib/mcp/types";
import {
  ADMIN_AGENT_ACTOR_ID,
  MARCADOR_TAREFA_ADMINISTRADOR,
  executarFerramentaAdministrador,
} from "@/lib/mcp/tools/administracao";

export const DIAS_PARA_LEAD_PARADO = 7;
/** Janela em que uma tarefa do administrador (aberta ou fechada) impede outra igual. */
export const DIAS_DE_DEDUPE_DA_TAREFA = 7;
export const HORAS_PARA_CONVERSA_SEM_RESPONSAVEL = 24;
/** Teto do que uma rodada LÊ de conversas — o limite de AÇÕES é outro. */
const TETO_DE_LEITURA = 500;
const TETO_DO_LIMITE = 100;
/** Candidatos de lead por página (keyset por id) e quantas páginas no máximo. */
const PAGINA_DE_LEADS = 100;
const MAX_PAGINAS_DE_LEADS = 10;
/** Tentativas por rodada = este fator x o limite de sucessos. */
export const FATOR_DE_TENTATIVAS = 3;

const DIA_MS = 86_400_000;
const HORA_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Retrato estruturado (nenhum campo de texto livre do cliente)
// ---------------------------------------------------------------------------

export interface LeadParaAvaliar {
  id: string;
  contactId: string | null;
  ultimaAtividadeEm: string | null;
  criadoEm: string;
  temTarefaAberta: boolean;
  /** Há tarefa criada pelo administrador para o lead nos últimos 7 dias, aberta ou fechada. */
  tarefaRecenteDoAdministrador: boolean;
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
    if (lead.temTarefaAberta || lead.tarefaRecenteDoAdministrador) continue;
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

/**
 * Intercala as ações por regra (uma de cada, em rodízio), preservando a ordem
 * dentro da regra. Uma regra com muita fila não atropela a outra.
 */
export function intercalarPorRegra(acoes: AcaoDoAdministrador[]): AcaoDoAdministrador[] {
  const filas = new Map<string, AcaoDoAdministrador[]>();
  for (const a of acoes) {
    const f = filas.get(a.ferramenta) ?? [];
    f.push(a);
    filas.set(a.ferramenta, f);
  }
  const listas = [...filas.values()];
  const saida: AcaoDoAdministrador[] = [];
  for (let i = 0; saida.length < acoes.length; i++) {
    for (const l of listas) if (i < l.length) saida.push(l[i]!);
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Carregamento do retrato — SEMPRE escopado pela organização do job
// ---------------------------------------------------------------------------

type Leitura = PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function ler<T>(q: Leitura): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

interface LinhaLead {
  id: string;
  contact_id: string | null;
  last_activity_at: string | null;
  created_at: string;
}

/**
 * Leads candidatos a R2. O predicado "parado há 7+ dias" vai para o SQL
 * (limite + ordem por id, paginação por cursor), e o dedupe olha SÓ os ids do
 * lote. Pára quando já reuniu candidatos acionáveis o bastante ou acabaram os
 * leads parados.
 */
async function carregarLeads(
  sb: SupabaseClient,
  organizationId: string,
  agora: Date,
  alvoDeAcionaveis: number,
): Promise<LeadParaAvaliar[]> {
  const corte = new Date(agora.getTime() - DIAS_PARA_LEAD_PARADO * DIA_MS).toISOString();
  const corteDoDedupe = new Date(agora.getTime() - DIAS_DE_DEDUPE_DA_TAREFA * DIA_MS).toISOString();
  const resultado: LeadParaAvaliar[] = [];
  let acionaveis = 0;
  let cursor: string | null = null;

  for (let pagina = 0; pagina < MAX_PAGINAS_DE_LEADS && acionaveis < alvoDeAcionaveis; pagina++) {
    let q = sb
      .from("crm_leads")
      .select("id, contact_id, last_activity_at, created_at")
      .eq("organization_id", organizationId)
      .eq("status", "open")
      .or(`last_activity_at.lt.${corte},and(last_activity_at.is.null,created_at.lt.${corte})`)
      .order("id", { ascending: true })
      .limit(PAGINA_DE_LEADS);
    if (cursor) q = q.gt("id", cursor);
    const lote = await ler<LinhaLead>(q);
    if (lote.length === 0) break;
    cursor = lote[lote.length - 1]!.id;
    const ids = lote.map((l) => l.id);

    const abertas = await ler<{ lead_id: string }>(
      sb
        .from("crm_tasks")
        .select("lead_id")
        .eq("organization_id", organizationId)
        .in("lead_id", ids)
        .in("status", ["pending", "in_progress"]),
    );
    const recentes = await ler<{ lead_id: string }>(
      sb
        .from("crm_tasks")
        .select("lead_id")
        .eq("organization_id", organizationId)
        .in("lead_id", ids)
        .eq("description", MARCADOR_TAREFA_ADMINISTRADOR)
        .gte("created_at", corteDoDedupe),
    );
    const comAberta = new Set(abertas.map((t) => t.lead_id));
    const comRecente = new Set(recentes.map((t) => t.lead_id));

    for (const l of lote) {
      const leadParaAvaliar: LeadParaAvaliar = {
        id: l.id,
        contactId: l.contact_id,
        ultimaAtividadeEm: l.last_activity_at,
        criadoEm: l.created_at,
        temTarefaAberta: comAberta.has(l.id),
        tarefaRecenteDoAdministrador: comRecente.has(l.id),
      };
      if (!leadParaAvaliar.temTarefaAberta && !leadParaAvaliar.tarefaRecenteDoAdministrador) acionaveis++;
      resultado.push(leadParaAvaliar);
    }
    if (lote.length < PAGINA_DE_LEADS) break;
  }
  return resultado;
}

async function carregarRetrato(
  sb: SupabaseClient,
  organizationId: string,
  agora: Date,
  alvoDeAcionaveis: number,
): Promise<RetratoDaOrganizacao> {
  const leads = await carregarLeads(sb, organizationId, agora, alvoDeAcionaveis);

  const corteDaConversa = new Date(agora.getTime() - HORAS_PARA_CONVERSA_SEM_RESPONSAVEL * HORA_MS).toISOString();
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
      .lte("last_inbound_at", corteDaConversa)
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
    leads,
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
  /** Ações bem-sucedidas (o limite conta estas). */
  executadas: number;
  falhas: number;
  /** Ações decididas que não chegaram a ser tentadas (limite ou teto de tentativas). */
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
  const tetoDeTentativas = limite * FATOR_DE_TENTATIVAS;
  const retrato = await carregarRetrato(admin.supabase, organizationId, agora, tetoDeTentativas);
  const decididas = intercalarPorRegra(decidirAcoes(retrato, agora));
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

  let tentativas = 0;
  for (const acao of decididas) {
    if (relatorio.executadas >= limite || tentativas >= tetoDeTentativas) break;
    tentativas++;
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
  relatorio.adiadasPeloLimite = decididas.length - tentativas;
  return relatorio;
}
