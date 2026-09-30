/**
 * POST /api/v1/webhooks/channel/[token] — entrada por token, para qualquer canal.
 *
 * ─── Por que o caminho NÃO cita o canal ─────────────────────────────────────
 *
 * A família de rotas do canal por QR carrega o nome do provider na URL, e está
 * na lista de dívida do `lint:channels` por isso — sair de lá exigiria mudar
 * uma URL que já está configurada em instalação de gente. Uma rota NOVA não
 * precisa nascer devendo: o token identifica a sessão, a sessão diz qual é o
 * canal, e o caminho fica neutro. Canal seguinte entra sem uma quarta família
 * de URLs.
 *
 * ─── Por que esta rota é tão curta ──────────────────────────────────────────
 *
 * Ela não sabe de quem é o payload. Resolve o token, decifra o segredo e
 * entrega tudo a `handleInboundWebhook` — a verificação de assinatura e a
 * leitura moram lá porque o esquema é do CANAL (header, algoritmo e formato
 * mudam por provider). A primeira versão desta rota fazia isso aqui e o
 * `lint:channels` reprovou, que é a catraca funcionando: uma rota que verifica
 * assinatura precisa perguntar qual provider é.
 *
 * ─── O 200 que evita a tempestade ──────────────────────────────────────────
 *
 * Evento que não interessa (outro tipo, eco do nosso próprio envio, outra
 * plataforma) responde 200, não 4xx: o provider reentrega o que não recebeu
 * 200, e recusar um payload que nunca vai servir faria a reentrega durar para
 * sempre. 500 fica reservado para falha de ESCRITA — aí a reentrega é o que
 * queremos, porque o evento era bom e nós é que não gravamos.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import {
  abrirArquivoDoWebhook,
  fecharArquivoDoWebhook,
} from "@/lib/channels/arquivo-de-webhook";
import {
  acceptsInboundWebhook,
  COLUNAS_DA_SESSAO_DE_ENTRADA,
  handleInboundWebhook,
  LIMITE_CORPO_WEBHOOK_BYTES,
  type InboundWebhookInput,
  verifyInboundHandshake,
} from "@/lib/channels/inbound";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET — handshake de verificação do webhook (Meta). Texto puro, não o JSON de
 * `ok()`: a plataforma espera o `hub.challenge` cru no corpo. 404 para token
 * desconhecido, 403 para verify token errado.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  if (!token || token.length < 8) return new Response("not found", { status: 404 });

  const admin = createAdminClient();
  const { data } = await queryTolerantToMissingArchived(
    () =>
      admin
        .from("channel_sessions")
        .select(`provider, ${ARCHIVED_AT}`)
        .eq("webhook_path_token", token)
        .maybeSingle(),
    () => admin.from("channel_sessions").select("provider").eq("webhook_path_token", token).maybeSingle(),
  );
  // Canal arquivado não responde o handshake (mesma regra do POST).
  if (!data || (data as { archived_at?: string | null }).archived_at) {
    return new Response("not found", { status: 404 });
  }

  const challenge = verifyInboundHandshake({
    provider: (data as { provider: string }).provider,
    params: req.nextUrl.searchParams,
    pathToken: token,
  });
  if (challenge === null) return new Response("forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { token } = await ctx.params;

  // Token curto nunca foi emitido por nós. 404 e não 401: quem varre URLs não
  // precisa saber que a rota existe.
  if (!token || token.length < 8) {
    return fail("not_found", "unknown webhook token", 404, { requestId });
  }

  // Corpo sem autenticação nunca chega ao banco acima do teto: o header barra o
  // óbvio sem ler nada, e o tamanho lido barra quem mente (ou omite) o header.
  const declarado = Number(req.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > LIMITE_CORPO_WEBHOOK_BYTES) {
    return fail("payload_too_large", "payload_too_large", 413, { requestId });
  }
  const rawBody = await req.text();
  if (rawBody.length > LIMITE_CORPO_WEBHOOK_BYTES) {
    return fail("payload_too_large", "payload_too_large", 413, { requestId });
  }
  const admin = createAdminClient();

  const { data } = await queryTolerantToMissingArchived(
    () =>
      admin
        .from("channel_sessions")
        .select(`${COLUNAS_DA_SESSAO_DE_ENTRADA}, ${ARCHIVED_AT}`)
        .eq("webhook_path_token", token)
        .maybeSingle(),
    () =>
      admin
        .from("channel_sessions")
        .select(COLUNAS_DA_SESSAO_DE_ENTRADA)
        .eq("webhook_path_token", token)
        .maybeSingle(),
  );

  const sessao = data as (InboundWebhookInput["session"] & {
    webhook_secret_encrypted: unknown;
    archived_at?: string | null;
  }) | null;

  if (!sessao) return fail("not_found", "unknown webhook token", 404, { requestId });

  // Canal arquivado não ingere: o usuário mandou excluí-lo, e aceitar evento em
  // voo ressuscitaria a conversa no inbox com o operador sem poder responder.
  if (sessao.archived_at) {
    return ok({ status: "ignored", reason: "canal_arquivado" }, { requestId });
  }

  if (!acceptsInboundWebhook(sessao.provider)) {
    return fail("invalid_request", "provider_mismatch", 400, { requestId });
  }

  const cifrado = sessao.webhook_secret_encrypted;
  const secret = cifrado ? await decryptWebhookSecret(admin, cifrado as string) : null;

  // ─── O corpo cru vai para o arquivo ANTES de qualquer processamento ────────
  //
  // Se o processo morrer no meio — exceção, OOM, deploy no instante errado — o
  // payload continua gravado, que é justamente quando alguém vai querer lê-lo.
  // Este caminho não gravava NADA, enquanto a rota do outro canal grava desde
  // sempre: era o único canal sem instrumento para investigar o que chegou.
  const arquivo = await abrirArquivoDoWebhook(admin, {
    organizationId: sessao.organization_id,
    channelSessionId: sessao.id,
    provider: sessao.provider,
    rawBody,
    headers: req.headers,
  });

  try {
    const r = await handleInboundWebhook(admin, {
      session: sessao,
      rawBody,
      headers: req.headers,
      secret,
    });

    if (r.ok) {
      await fecharArquivoDoWebhook(admin, arquivo, {
        status: "processed",
        validSignature: true,
        // O desfecho do seam vai junto: é ele que distingue "ingerido" de
        // "ignorado por falta de identidade" quando alguém for contar depois.
        erro: typeof r.body.reason === "string" ? r.body.reason : null,
      });
      return ok(r.body, { requestId });
    }

    const status = r.code === "unauthorized" ? 401 : 400;
    await fecharArquivoDoWebhook(admin, arquivo, {
      status: "error",
      // `false` SÓ quando a recusa foi por assinatura. Um payload bem assinado
      // que o parser recusou não é problema de segredo, e marcá-lo como se
      // fosse mandaria quem investiga procurar no lugar errado.
      validSignature: r.code === "unauthorized" ? false : null,
      erro: r.message,
    });
    return fail(
      r.code === "unauthorized" ? "unauthorized" : "invalid_request",
      r.message,
      status,
      { requestId },
    );
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : "ingest_failed";
    await fecharArquivoDoWebhook(admin, arquivo, {
      status: "error",
      validSignature: null,
      erro: detalhe,
    });
    // O detalhe fica no arquivo do webhook e no log do servidor; a resposta é estática.
    logger.error("[webhook-channel] falha interna", { requestId, provider: sessao.provider, detail: detalhe.slice(0, 300) });
    return fail("internal_error", "internal_error", 500, { requestId });
  }
}
