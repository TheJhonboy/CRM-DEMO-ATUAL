/**
 * GET/POST /api/v1/cron/administrador — a rodada do agente administrador.
 *
 * Mantém o CRM organizado com ações seguras (criar tarefa de retomada, etiquetar
 * contato, registrar nota). Nunca apaga dado, nunca envia mensagem, nunca move
 * lead de etapa (ver lib/agent-engine/cron/administrador.ts para as regras).
 *
 * DESLIGADO POR PADRÃO, em duas chaves:
 *  1. `ADMIN_AGENT_ENABLED` (env) é a chave MESTRA: sem `true`, a rota autentica,
 *     não toca em banco e responde `{ skipped: "desligado" }`. O scheduler já a
 *     chama a cada 15 min (docker/scheduler/entrypoint.sh).
 *  2. Cada organização precisa ter OPTADO: `organizations.settings.administrador_ativo
 *     = true` (mesmo jsonb `settings` que outras features leem; nenhuma
 *     organização existente tem essa chave, então todas começam desligadas).
 *     Só entram organizações `status = 'active'`, sem `suspended_at` e sem
 *     `redacted_at`.
 *
 * COBERTURA: a lista elegível é ordenada por id e percorrida em páginas de 200,
 * dentro de um orçamento de 90 s (pára de iniciar organização ao passar de
 * 80 s e registra as contagens). A página inicial gira a cada 15 min
 * (`floor(agora / 15 min) % páginas`), então as organizações do fim da fila não
 * passam fome quando o orçamento acaba antes do fim.
 *
 * A organização de cada rodada vem da LINHA de `organizations`, nunca da
 * requisição. O teto de ações por organização por rodada é constante.
 *
 * SOBREPOSIÇÃO: rodadas podem se sobrepor (o scheduler dispara a cada 15 min e
 * uma rodada pode durar até ~90 s; uma execução lenta ou uma reentrega também
 * sobrepõem). Não há lock: quem protege contra duplicata é o dedupe por
 * estado em `lib/agent-engine/cron/administrador.ts` (tarefa do administrador
 * nos últimos 7 dias em qualquer status; etiqueta só se o contato ainda não a
 * tem). Duas rodadas simultâneas no mesmo lead podem, no pior caso, criar duas
 * tarefas na mesma janela de milissegundos; aceito na v1 (tarefa interna, sem
 * efeito externo). Isso é RISCO RESIDUAL conhecido: o dedupe de 7 dias o torna
 * autolimitado (a duplicata não se repete), e NÃO há advisory lock porque o
 * supabase-js não consegue manter uma transação/sessão aberta entre chamadas
 * (adiado; exigiria RPC/SQL dedicado).
 *
 * Auth: mesmo contrato dos demais crons (`autorizaCron`: Bearer ou x-cron-secret,
 * comparação em tempo constante com INTERNAL_CRON_SECRET|INTERNAL_SECRET).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { executarAdministrador } from "@/lib/agent-engine/cron/administrador";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Ações BEM-SUCEDIDAS por organização por rodada. */
export const LIMITE_POR_ORGANIZACAO = 20;
export const TAMANHO_DA_PAGINA = 200;
/** Orçamento total da rodada e margem: não inicia organização depois de ORCAMENTO - MARGEM. */
export const ORCAMENTO_MS = 90_000;
const MARGEM_MS = 10_000;
/** Intervalo do scheduler: define o "slot" que gira a página inicial. */
export const SLOT_MS = 15 * 60_000;

type ClienteAdmin = ReturnType<typeof createAdminClient>;

/** Filtro único de elegibilidade, compartilhado pela contagem e pela página. */
interface Filtravel {
  eq(c: string, v: string): Filtravel;
  is(c: string, v: null): Filtravel;
}

function elegiveis<T>(q: T): T {
  return (q as unknown as Filtravel)
    .eq("status", "active")
    .is("suspended_at", null)
    .is("redacted_at", null)
    .eq("settings->>administrador_ativo", "true") as unknown as T;
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  if (!env.ADMIN_AGENT_ENABLED) {
    return ok({ skipped: "desligado" }, { requestId });
  }

  const inicio = Date.now();
  const admin: ClienteAdmin = createAdminClient();

  const contagem = await elegiveis(admin.from("organizations").select("id", { count: "exact", head: true }));
  if (contagem.error) {
    logger.error("[administrador] organizations count failed", { error: contagem.error.message, requestId });
    return fail("internal_error", "Failed to list organizations.", 500, { requestId });
  }
  const total = contagem.count ?? 0;
  const paginas = Math.max(1, Math.ceil(total / TAMANHO_DA_PAGINA));
  const paginaInicial = Math.floor(inicio / SLOT_MS) % paginas;

  let processadas = 0;
  let executadas = 0;
  let falhas = 0;
  let paginasVisitadas = 0;
  let interrompidoPorTempo = false;

  const esgotado = () => Date.now() - inicio >= ORCAMENTO_MS - MARGEM_MS;

  rodada: for (let i = 0; i < paginas && total > 0; i++) {
    if (esgotado()) {
      interrompidoPorTempo = true;
      break;
    }
    const pagina = (paginaInicial + i) % paginas;
    const de = pagina * TAMANHO_DA_PAGINA;
    const { data: orgs, error } = await elegiveis(admin.from("organizations").select("id"))
      .order("id", { ascending: true })
      .range(de, de + TAMANHO_DA_PAGINA - 1);
    if (error) {
      logger.error("[administrador] organizations query failed", { error: error.message, pagina, requestId });
      return fail("internal_error", "Failed to list organizations.", 500, { requestId });
    }
    paginasVisitadas++;

    for (const org of (orgs ?? []) as Array<{ id: string }>) {
      if (esgotado()) {
        interrompidoPorTempo = true;
        break rodada;
      }
      try {
        const r = await executarAdministrador({ supabase: admin }, {
          organizationId: org.id,
          limite: LIMITE_POR_ORGANIZACAO,
          prazo: inicio + ORCAMENTO_MS - MARGEM_MS,
        });
        processadas++;
        executadas += r.executadas;
        falhas += r.falhas;
        if (r.interrompidoPorTempo) {
          interrompidoPorTempo = true;
          break rodada;
        }
      } catch (err) {
        processadas++;
        // Uma organização com problema não pode parar as outras.
        logger.error("[administrador] rodada falhou", {
          organizationId: org.id,
          error: err instanceof Error ? err.message : String(err),
          requestId,
        });
      }
    }
  }

  const resumo = {
    elegiveis: total,
    organizacoes: processadas,
    paginas,
    paginasVisitadas,
    paginaInicial,
    executadas,
    falhas,
    interrompidoPorTempo,
    duracaoMs: Date.now() - inicio,
  };
  logger.info("[administrador] rodada concluída", { ...resumo, requestId });
  return ok(resumo, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
