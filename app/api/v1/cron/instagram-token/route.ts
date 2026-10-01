/**
 * GET/POST /api/v1/cron/instagram-token — renova os tokens do Instagram que vencem
 * em até 10 dias (1x por dia no scheduler). Ver lib/channels/instagram/renovar-todos.ts.
 *
 * Sem flag: sem sessão do Instagram a rodada é uma consulta vazia. Auth como os demais
 * crons (`autorizaCron`). A organização de cada renovação vem da linha da sessão.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { renovarTokensDoInstagram } from "@/lib/channels/instagram/renovar-todos";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }
  const inicio = Date.now();
  try {
    const resumo = await renovarTokensDoInstagram(createAdminClient());
    const completo = { ...resumo, duracaoMs: Date.now() - inicio };
    logger.info("[instagram-token] rodada concluída", { ...completo, requestId });
    return ok(completo, { requestId });
  } catch {
    logger.error("[instagram-token] rodada falhou", { requestId });
    return fail("internal_error", "Failed to renew Instagram tokens.", 500, { requestId });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
