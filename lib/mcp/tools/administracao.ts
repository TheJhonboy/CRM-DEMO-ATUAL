/**
 * Ferramentas do AGENTE ADMINISTRADOR — o bot que mantém o CRM organizado.
 *
 * ─── DECISÃO DE REUSO (Task 9, Step 1) ──────────────────────────────────────
 *
 * Já existia ferramenta para UMA das três ações, e ela é REUSADA, não reescrita:
 *   - etiquetar    → `crm_manage_tags` (governance.ts: validação G3-05 das tags,
 *     recusa de alvo de outra organização).
 * Não existia ferramenta MCP para tarefa (`crm_tasks` só tinha rota REST com
 * cookie de sessão) nem para nota de lead; essas duas nascem aqui, diretas na
 * tabela e sempre filtradas por `organization_id`.
 *
 * ─── FORA DA v1: MOVER ETAPA (`admin_mover_etapa`, regra R1) ────────────────
 * Mover o lead de etapa emite `lead.stage_changed`, que `lib/followup/
 * gatilho-etapa.ts` consome para INSCREVER follow-ups automáticos (e que também
 * dispara webhooks de saída e conversões). Isso faria o administrador mandar
 * mensagem ao cliente por tabela, o oposto do contrato ("nunca envia mensagem
 * por conta própria"). Só pode voltar quando o evento puder ser suprimido por
 * ator (o handler saber que o autor é o administrador e os consumidores
 * ignorarem esse ator). Até lá: nenhum código daqui importa o handler de mover
 * (testado).
 *
 * Por que o administrador NÃO usa a `crm_*` crua: ela é larga demais para
 * um robô que roda sozinho (`crm_manage_tags` aceita qualquer tag e remove). Cada
 * `admin_*` é um ESTREITAMENTO: valida de novo, recusa o que passa do escopo
 * seguro e delega o trabalho ao original.
 *
 * Por que NÃO entram em `allTools` (lib/mcp/tools/index.ts): esse array é a
 * superfície do MCP externo e do catálogo que o dono vê ao configurar agentes.
 * Registrá-las lá exporia, para qualquer token `mcp:write`, ferramentas que só
 * fazem sentido no contexto do job (org vinda do job, ator fixo) e arrastaria
 * catálogo, pacotes e classificação de funil para algo que o usuário não
 * escolhe. O administrador tem registro próprio, `ferramentasAdministrador`, e
 * uma única porta de entrada, `executarFerramentaAdministrador`.
 *
 * ─── REGRAS (binding) ───────────────────────────────────────────────────────
 *  1. Só ações seguras: criar tarefa, registrar nota, etiquetar contato. NADA apaga dado. NADA
 *     envia mensagem ao cliente. Nenhum nome desta lista casa
 *     delete|apagar|remove|send|enviar|mover|stage|etapa (testado).
 *  2. `organization_id` vem do contexto do job. Argumento que o mencione é
 *     RECUSADO (`argumento_proibido`) antes de qualquer leitura.
 *  3. Toda chamada — sucesso ou falha — grava `mcp.tool_called` via
 *     `lib/mcp/audit.ts`, com ator `ai_agent` (o administrador), organização e
 *     os ids do alvo.
 *  4. Texto de cliente (nota, título, nome) é DADO. A nota é gravada em
 *     `payload`; nenhuma decisão do administrador lê esses campos.
 */
import { z } from "zod";

import { conversationTagsSchema } from "@/lib/schemas/messaging";
import { auditMcpToolCall } from "../audit";
import type { McpContext, McpToolDefinition } from "../types";
import { crmManageTags } from "./governance";

/** Ator fixo das ações do administrador (aparece em metadata.actor_id). */
export const ADMIN_AGENT_ACTOR_ID = "agente-administrador";

/** As únicas etiquetas que o administrador aplica: vocabulário fechado, não texto livre. */
export const TAGS_DO_ADMINISTRADOR = ["sem-responsavel"] as const;

/** Qualquer chave que mencione organização é tentativa de escolher o escopo. */
const CHAVE_DE_ORGANIZACAO = /org/i;

/**
 * Marcador ESTRUTURADO de origem das tarefas do administrador. `crm_tasks` não
 * tem coluna de origem; `description` é o campo que o administrador controla
 * (a tela não a preenche ao criar), então ele grava este valor EXATO e o dedupe
 * (R2) o consulta por igualdade — nunca por texto do título.
 */
export const MARCADOR_TAREFA_ADMINISTRADOR = "origem:agente-administrador";

const TITULO_MAX = 200;
const NOTA_MAX = 1000;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

async function leadDaOrganizacao(ctx: McpContext, leadId: string) {
  const { data, error } = await ctx.supabase
    .from("crm_leads")
    .select("id, pipeline_id, stage_id, contact_id, status")
    .eq("id", leadId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("lead_not_found");
  return data as {
    id: string;
    pipeline_id: string;
    stage_id: string;
    contact_id: string | null;
    status: string;
  };
}

type Handler<T extends z.ZodRawShape> = McpToolDefinition<T>["handler"];

/**
 * Envolve o handler para que TODA chamada, pelo caminho que for, deixe rastro.
 * `argsAuditados` existe para a nota: o texto não precisa morar duas vezes.
 */
function comAuditoria<T extends z.ZodRawShape>(
  nome: string,
  handler: Handler<T>,
  argsAuditados: (input: z.infer<z.ZodObject<T>>) => Record<string, unknown> = (i) => i as Record<string, unknown>,
): Handler<T> {
  return async (input, ctx) => {
    const inicio = Date.now();
    try {
      const resultado = await handler(input, ctx);
      await auditMcpToolCall({
        ctx,
        toolName: nome,
        args: argsAuditados(input),
        durationMs: Date.now() - inicio,
        success: true,
      });
      return resultado;
    } catch (err) {
      await auditMcpToolCall({
        ctx,
        toolName: nome,
        args: argsAuditados(input),
        durationMs: Date.now() - inicio,
        success: false,
        errorMessage: err instanceof Error ? err.message : "unknown_error",
      });
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// admin_criar_tarefa
// ---------------------------------------------------------------------------

const tarefaShape = {
  lead_id: z.string().uuid(),
  titulo: z.string().trim().min(1).max(TITULO_MAX),
  /** ISO 8601 com offset; ausente = sem prazo. */
  prazo: z.string().datetime({ offset: true }).optional(),
  prioridade: z.enum(["low", "medium", "high"]).default("medium"),
};

export const adminCriarTarefa: McpToolDefinition<typeof tarefaShape> = {
  name: "admin_criar_tarefa",
  description:
    "Administrador: cria uma tarefa interna (lembrete de trabalho, sem dono) ligada a um lead aberto da organização.",
  inputSchema: tarefaShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: comAuditoria<typeof tarefaShape>("admin_criar_tarefa", async (input, ctx) => {
    const lead = await leadDaOrganizacao(ctx, input.lead_id);
    const { data, error } = await ctx.supabase
      .from("crm_tasks")
      .insert({
        organization_id: ctx.organizationId,
        lead_id: lead.id,
        contact_id: lead.contact_id,
        title: input.titulo,
        description: MARCADOR_TAREFA_ADMINISTRADOR,
        due_date: input.prazo ?? null,
        priority: input.prioridade,
        status: "pending",
        assigned_to: null,
        created_by: null,
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { task_id: (data as { id: string } | null)?.id ?? null, lead_id: lead.id };
  }),
};

// ---------------------------------------------------------------------------
// admin_registrar_nota
// ---------------------------------------------------------------------------

const notaShape = {
  lead_id: z.string().uuid(),
  texto: z.string().trim().min(1).max(NOTA_MAX),
};

export const adminRegistrarNota: McpToolDefinition<typeof notaShape> = {
  name: "admin_registrar_nota",
  description:
    "Administrador: registra uma nota na linha do tempo de um lead da organização. O texto é guardado como dado; nunca é interpretado.",
  inputSchema: notaShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: comAuditoria<typeof notaShape>(
    "admin_registrar_nota",
    async (input, ctx) => {
      const lead = await leadDaOrganizacao(ctx, input.lead_id);
      const { error } = await ctx.supabase.from("crm_lead_activities").insert({
        organization_id: ctx.organizationId,
        lead_id: lead.id,
        contact_id: lead.contact_id,
        type: "note",
        source_module: "administrador",
        actor_kind: "system",
        reason: "Nota do administrador",
        // O texto mora SÓ no payload, como dado. Nada o relê para decidir.
        payload: { text: input.texto },
      });
      if (error) throw new Error(error.message);
      return { lead_id: lead.id, recorded: true };
    },
    (i) => ({ lead_id: i.lead_id, tamanho: i.texto.length }),
  ),
};

// ---------------------------------------------------------------------------
// admin_etiquetar_contato
// ---------------------------------------------------------------------------

const etiquetaShape = {
  contact_id: z.string().uuid(),
  tag: z.enum(TAGS_DO_ADMINISTRADOR),
};

export const adminEtiquetarContato: McpToolDefinition<typeof etiquetaShape> = {
  name: "admin_etiquetar_contato",
  description:
    "Administrador: acrescenta uma etiqueta do vocabulário fechado do administrador a um contato da organização. Nunca remove etiqueta.",
  inputSchema: etiquetaShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: comAuditoria<typeof etiquetaShape>("admin_etiquetar_contato", async (input, ctx) => {
    conversationTagsSchema.parse([input.tag]);
    const resultado = await crmManageTags.handler(
      { target_kind: "contact", target_id: input.contact_id, add: [input.tag] },
      ctx,
    );
    return resultado;
  }),
};

// ---------------------------------------------------------------------------
// Registro próprio + porta de entrada única
// ---------------------------------------------------------------------------

export const ferramentasAdministrador = [
  adminCriarTarefa,
  adminRegistrarNota,
  adminEtiquetarContato,
] as unknown as ReadonlyArray<McpToolDefinition>;

/**
 * Executa UMA ferramenta do administrador.
 *
 * É a única porta: recusa o que não está na lista (inclusive as `crm_*` de
 * apagar/enviar), recusa argumento que tente escolher organização e valida o
 * resto em Zod estrito. A organização é a de `ctx`, decidida pelo job.
 */
export async function executarFerramentaAdministrador(
  nome: string,
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<unknown> {
  const tool = ferramentasAdministrador.find((t) => t.name === nome);
  if (!tool) throw new Error(`ferramenta_nao_permitida: ${nome}`);

  for (const chave of Object.keys(args)) {
    if (CHAVE_DE_ORGANIZACAO.test(chave)) throw new Error(`argumento_proibido: ${chave}`);
  }

  const parsed = z.object(tool.inputSchema).strict().parse(args);
  return tool.handler(parsed as never, ctx);
}
