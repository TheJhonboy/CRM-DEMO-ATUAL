/**
 * GET/POST /api/v1/cron/administrador — a rodada do agente administrador.
 *
 * Mantém o CRM organizado com ações seguras (mover etapa, criar tarefa, etiquetar
 * contato, registrar nota). Nunca apaga dado, nunca envia mensagem. Ver
 * `lib/agent-engine/cron/administrador.ts` para as regras.
 *
 * DESLIGADO POR PADRÃO: sem `ADMIN_AGENT_ENABLED=true` a rota autentica, não toca
 * em banco nenhum e responde `{ skipped: "desligado" }`. O scheduler já a chama a
 * cada 15 min (docker/scheduler/entrypoint.sh); ligar é decisão do dono.
 *
 * A organização de cada rodada vem da LINHA de `organizations`, nunca da
 * requisição. O teto de ações por organização por rodada é constante.
 *
 * Auth: mesmo contrato dos demais crons (Bearer INTERNAL_CRON_SECRET|INTERNAL_SECRET).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { executarAdministrador } from "@/lib/agent-engine/cron/administrador";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Ações por organização por rodada. */
export const LIMITE_POR_ORGANIZACAO = 20;
/** Organizações por rodada (safety cap). */
const TETO_DE_ORGANIZACOES = 200;

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  if (!env.ADMIN_AGENT_ENABLED) {
    return ok({ skipped: "desligado" }, { requestId });
  }

  const admin = createAdminClient();
  const { data: orgs, error } = await admin.from("organizations").select("id").limit(TETO_DE_ORGANIZACOES);
  if (error) {
    logger.error("[administrador] organizations query failed", { error: error.message, requestId });
    return fail("internal_error", "Failed to list organizations.", 500, { requestId });
  }

  const relatorios = [];
  for (const org of (orgs ?? []) as Array<{ id: string }>) {
    try {
      relatorios.push(
        await executarAdministrador({ supabase: admin }, { organizationId: org.id, limite: LIMITE_POR_ORGANIZACAO }),
      );
    } catch (err) {
      // Uma organização com problema não pode parar as outras.
      logger.error("[administrador] rodada falhou", {
        organizationId: org.id,
        error: err instanceof Error ? err.message : String(err),
        requestId,
      });
    }
  }

  return ok(
    {
      organizacoes: relatorios.length,
      executadas: relatorios.reduce((n, r) => n + r.executadas, 0),
      falhas: relatorios.reduce((n, r) => n + r.falhas, 0),
    },
    { requestId },
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
