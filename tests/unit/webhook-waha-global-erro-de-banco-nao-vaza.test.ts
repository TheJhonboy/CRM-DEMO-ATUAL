// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O WEBHOOK GLOBAL DO WAHA NÃO DEVOLVE O TEXTO DO POSTGRES A QUEM NÃO SE AUTENTICOU
 * (auditoria de 21/09/2026, achado 7 — só este ponto).
 *
 * ═══ O defeito ═══
 *
 * `POST /api/v1/webhooks/waha` resolve a sessão pelo campo `session` do corpo ANTES
 * de checar qualquer assinatura — é a única forma de descobrir de quem é o segredo.
 * Se essa consulta falhava, a rota respondia `fail("internal_error", sessErr.message,
 * 500)`: o texto cru do erro do Postgres (nome de tabela, coluna, constraint,
 * SQLSTATE) ia para quem quer que tivesse feito o POST, sem login nem HMAC.
 *
 * ═══ O que fica ═══
 *
 * - O status (500) e o código de máquina (`internal_error`) seguem iguais: o
 *   provider continua retentando como antes.
 * - A mensagem é um rótulo genérico e estável (`session_lookup_failed`).
 * - O detalhe vai para o log estruturado (`logger.error`), com o MESMO `request_id`
 *   que a resposta leva em `X-Request-Id` — é assim que o operador liga um ao outro.
 *
 * Só este ponto. Os outros lugares que devolvem `error.message` estão adiados de
 * propósito (ver `RELATORIO-SEGURANCA.md`, achado 7).
 */

const h = vi.hoisted(() => ({
  logError: vi.fn(),
  detalheDoBanco: 'relation "public.channel_sessions" does not exist (SQLSTATE 42P01) at character 15',
  // Mutável: cada caso decide o que a consulta da sessão devolve.
  resposta: { data: null as unknown, error: null as unknown },
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/channels/archived", () => ({
  ARCHIVED_AT: "archived_at",
  queryTolerantToMissingArchived: async () => h.resposta,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/waha/ingest", () => ({ dispatchWahaEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/waha/webhook-auth", () => ({
  authenticateWahaWebhook: () => ({ ok: true, signatureVerified: true }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: h.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST } from "@/app/api/v1/webhooks/waha/route";

const pedido = () =>
  ({
    text: async () =>
      JSON.stringify({
        event: "message.any",
        session: "org_ab12cd34",
        payload: { id: "false_5511999990000@c.us_ABC123" },
      }),
    headers: new Headers(),
  }) as never;

/** Pedaços que só existem no texto do banco — qualquer um deles no corpo é vazamento. */
const PEDACOS_DO_BANCO = [
  "channel_sessions",
  "42P01",
  "SQLSTATE",
  "does not exist",
  "tabela interna",
  "public.",
];

beforeEach(() => {
  h.logError.mockReset();
  h.resposta = { data: null, error: null };
});

describe("webhook global do WAHA — falha da consulta da sessão, antes de qualquer autenticação", () => {
  it("CONTROLE: sessão que não existe segue respondendo 200 com o motivo de máquina", async () => {
    // Sem isto, um mock que quebrasse a rota inteira faria os casos abaixo
    // "passarem" por outro motivo (a sonda morta que devolve zero).
    h.resposta = { data: null, error: null };
    const res = await POST(pedido());
    expect(res.status).toBe(200);
    const body = await res.json();
    // `ok()` envelopa o corpo em `{ data }`.
    expect(body).toMatchObject({ data: { accepted: false, reason: "session_not_registered" } });
  });

  it("responde 500 com o MESMO código de máquina, e uma mensagem genérica sem o texto do banco", async () => {
    h.resposta = {
      data: null,
      error: { message: h.detalheDoBanco, code: "42P01", details: "tabela interna", hint: null },
    };
    const res = await POST(pedido());
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).toBe("session_lookup_failed");

    const corpoInteiro = JSON.stringify(body);
    for (const pedaco of PEDACOS_DO_BANCO) {
      expect(corpoInteiro, `o corpo da resposta carrega "${pedaco}", que é do Postgres`).not.toContain(pedaco);
    }
    expect(body.error.details, "não pode ir `details` com o erro do banco").toBeUndefined();
  });

  it("o detalhe do banco vai para o log estruturado, ligado pelo request_id da resposta", async () => {
    h.resposta = {
      data: null,
      error: { message: h.detalheDoBanco, code: "42P01", details: null, hint: null },
    };
    const res = await POST(pedido());
    const requestId = res.headers.get("X-Request-Id");
    expect(requestId, "a resposta precisa levar X-Request-Id").toBeTruthy();

    expect(h.logError).toHaveBeenCalledTimes(1);
    const [msg, ctx] = h.logError.mock.calls[0]!;
    expect(msg).toContain("[waha.webhook]");
    expect(ctx).toMatchObject({
      request_id: requestId,
      detalhe: h.detalheDoBanco,
      codigo: "42P01",
    });
  });
});
