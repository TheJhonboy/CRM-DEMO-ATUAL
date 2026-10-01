/**
 * POST /api/v1/channels/instagram/renovar-token — renova AGORA o token do Instagram.
 *
 * Mesmo guarda da rota de conectar (admin da organização, suporte só leitura,
 * rate limit por organização). Sem corpo: organização e sessão vêm da sessão
 * autenticada, nunca do JSON. O token novo nunca sai daqui; só a validade.
 *
 * Resposta 200 com `status`:
 *  - `renovado`   — token renovado, `tokenValidoAte` novo;
 *  - `novo_demais`— a Meta só renova com 24 h de idade; tente amanhã;
 *  - `expirado`   — passou dos 60 dias: gere um token NOVO na Meta e use "Reconectar";
 *  - `falhou`     — Meta fora do ar/recusou/erro nosso; tente de novo.
 * `reason` é texto fixo e traduzível (nunca texto da Meta).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { findInstagramSession } from "@/lib/channels/connect";
import { renovarTokenDaSessao } from "@/lib/channels/instagram/token";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMITE_POR_MINUTO = 6;

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_instagram" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const rl = await checkRateLimit(`instagram_renovar_token:${orgId}`, LIMITE_POR_MINUTO, 60);
  if (!rl.allowed) {
    return fail("rate_limited", t("Muitas tentativas. Aguarde um minuto."), 429, {
      requestId,
      headers: { "Retry-After": "60" },
    });
  }

  const admin = createAdminClient();
  let sessao;
  try {
    sessao = await findInstagramSession(admin, orgId);
  } catch {
    return fail("internal_error", t("Não foi possível consultar a conexão. Tente de novo."), 500, { requestId });
  }
  if (!sessao || sessao.archivedAt || !sessao.hasToken) {
    return fail("not_found", t("O Instagram não está conectado nesta organização."), 404, { requestId });
  }

  const r = await renovarTokenDaSessao(admin, { organizationId: orgId, sessionId: sessao.id });
  if (r.ok) {
    return ok(
      { status: "renovado", tokenValidoAte: r.tokenValidoAte, reason: t("Token renovado por mais 60 dias.") },
      { requestId },
    );
  }
  if (r.motivo === "token_novo_demais") {
    return ok(
      {
        status: "novo_demais",
        tokenValidoAte: null,
        reason: t("O token tem menos de 24 horas e a Meta ainda não permite renovar. Tente de novo amanhã."),
      },
      { requestId },
    );
  }
  if (r.motivo === "token_expirado") {
    return ok(
      {
        status: "expirado",
        tokenValidoAte: null,
        reason: t(
          "O token expirou e não pode mais ser renovado. Gere um token NOVO no painel da Meta e cole em Reconectar.",
        ),
      },
      { requestId },
    );
  }
  return ok(
    {
      status: "falhou",
      tokenValidoAte: null,
      reason: t("Não foi possível renovar o token agora. Tente de novo em instantes."),
    },
    { requestId },
  );
}
