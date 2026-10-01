import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/channels/instagram — estado da conexão + o que colar na Meta.
 * POST /api/v1/channels/instagram — VALIDA o token na Graph e só então grava.
 *
 * Como a rota do canal por credencial existente, esta não sabe com quem fala:
 * colunas, host da Graph e cifra estão em `lib/channels/connect`. A organização
 * vem da sessão (`requireRole`), NUNCA do corpo — um `organization_id` no JSON é
 * ignorado por construção, porque o schema não o declara.
 *
 * ─── O que NUNCA sai daqui ──────────────────────────────────────────────────
 *
 * O token de acesso e o segredo do app entram pelo POST e não voltam em resposta
 * nenhuma, nem em erro. O `verifyToken` (o `webhook_path_token` da sessão) volta
 * porque o operador precisa colá-lo na Meta, e já é aleatório e secreto por si.
 *
 * Validação de ANTES de gravar, pelo mesmo motivo dos outros canais: gravar
 * primeiro e descobrir depois faz o operador achar que conectou e só entender que
 * não quando a primeira mensagem não chega.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { connectInstagram, estadoDoInstagram } from "@/lib/channels/connect";
import { alertaDoToken } from "@/lib/channels/instagram/token";
import { urlDoWebhookDoCanal } from "@/lib/channels/webhook-url";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Tentativas de conectar por organização por minuto: a rota é um oráculo de token. */
const LIMITE_POR_MINUTO = 10;

const conectarSchema = z.object({
  accountId: z.string().trim().regex(/^\d{5,32}$/),
  accessToken: z.string().trim().min(20).max(600),
  appSecret: z.string().trim().min(16).max(200),
  displayName: z.string().trim().max(80).optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  // Conectar um canal expõe a conta da empresa: é decisão de dono, não de quem atende.
  const authz = await requireRole("admin", { requestId, resource: "channels_instagram" });
  if (!authz.ok) return authz.response;

  const e = await estadoDoInstagram(createAdminClient(), authz.org.orgId);
  const conectado = e.estado !== "nao_conectado" && !!e.webhookPathToken;
  return ok(
    {
      state: e.estado,
      health: e.saude,
      username: e.username,
      webhookUrl: conectado ? urlDoWebhookDoCanal(req, e.webhookPathToken as string) : null,
      verifyToken: conectado ? e.webhookPathToken : null,
      tokenValidoAte: conectado ? e.tokenValidoAte : null,
      ...(conectado
        ? alertaDoToken(e.tokenValidoAte)
        : { diasRestantes: null, alertaToken: "desconhecido" as const }),
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_instagram" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const rl = await checkRateLimit(`channels_connect:${orgId}`, LIMITE_POR_MINUTO, 60);
  if (!rl.allowed) {
    return fail("rate_limited", t("Muitas tentativas. Aguarde um minuto."), 429, {
      requestId,
      headers: { "Retry-After": "60" },
    });
  }

  const parsed = conectarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // Mensagem fixa: nunca ecoa o valor recebido (pode ser o token).
    return fail(
      "invalid_request",
      t("Confira os dados: o ID da conta tem só dígitos, e o token e o segredo do app devem estar completos."),
      422,
      { requestId },
    );
  }

  const admin = createAdminClient();
  const r = await connectInstagram(admin, { organizationId: orgId, ...parsed.data });
  if (!r.ok) {
    const status = r.kind === "indisponivel" ? 502 : r.kind === "banco" ? 500 : 422;
    const code = r.kind === "banco" ? "internal_error" : "invalid_request";
    return fail(code, t(r.reason), status, {
      requestId,
      ...(r.metaStatus ? { details: { meta_status: r.metaStatus } } : {}),
    });
  }

  return ok(
    {
      webhookUrl: urlDoWebhookDoCanal(req, r.webhookPathToken),
      verifyToken: r.webhookPathToken,
      username: r.username,
      status: r.status,
      webhookSubscribed: r.webhookSubscribed,
      tokenValidoAte: r.tokenValidoAte,
      tokenLongo: r.tokenLongo,
    },
    { requestId },
  );
}
