import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rota neutra do lado de dentro do seam: assinatura, contrato e handshake.
 * Fail-closed em tudo: sem segredo, assinatura errada ou corpo fora do contrato
 * nada chega ao ingest.
 */

const ing = vi.hoisted(() => ({ ingest: vi.fn(async () => [{ status: "ingested" }]) }));
vi.mock("@/lib/channels/instagram/ingest", () => ({ ingestInstagramInbound: ing.ingest }));

import { acceptsInboundWebhook, handleInboundWebhook, verifyInboundHandshake } from "@/lib/channels/inbound";

const SEGREDO = "a".repeat(32);
const assinar = (corpo: string, segredo = SEGREDO) => "sha256=" + createHmac("sha256", segredo).update(corpo, "utf8").digest("hex");
const corpoValido = JSON.stringify({
  object: "instagram",
  entry: [
    {
      id: "IGACC",
      time: 1,
      messaging: [{ sender: { id: "S1" }, recipient: { id: "IGACC" }, timestamp: 1, message: { mid: "m1", text: "oi" } }],
    },
  ],
});
const sessao = { id: "s1", organization_id: "org-1", provider: "instagram", instagram_account_id: "IGACC" };
const chamar = (rawBody: string, header: string | null, secret: string | null = SEGREDO) =>
  handleInboundWebhook({} as never, {
    session: sessao,
    rawBody,
    headers: new Headers(header ? { "x-hub-signature-256": header } : {}),
    secret,
  });

beforeEach(() => ing.ingest.mockClear());

describe("handleInboundWebhook (instagram)", () => {
  it("o canal aceita webhook", () => {
    expect(acceptsInboundWebhook("instagram")).toBe(true);
    expect(acceptsInboundWebhook("waha")).toBe(false);
  });

  it("assinatura invalida: unauthorized e nada e ingerido", async () => {
    const r = await chamar(corpoValido, assinar(corpoValido, "b".repeat(32)));
    expect(r).toMatchObject({ ok: false, code: "unauthorized" });
    expect(ing.ingest).not.toHaveBeenCalled();
  });

  it("sem header de assinatura: unauthorized", async () => {
    expect(await chamar(corpoValido, null)).toMatchObject({ ok: false, code: "unauthorized" });
  });

  it.each([
    ["ausente", null],
    ["curto", "curto"],
  ])("segredo %s: unauthorized (fail-closed)", async (_n, secret) => {
    const r = await chamar(corpoValido, assinar(corpoValido, secret ?? ""), secret);
    expect(r).toMatchObject({ ok: false, code: "unauthorized" });
    expect(ing.ingest).not.toHaveBeenCalled();
  });

  it("corpo que nao e JSON (mas bem assinado): invalid_json", async () => {
    const c = "{nao";
    expect(await chamar(c, assinar(c))).toMatchObject({ ok: false, code: "invalid_json" });
  });

  it("entry numerico (bem assinado): contrato_violado", async () => {
    const c = JSON.stringify({ object: "instagram", entry: 5 });
    const r = await chamar(c, assinar(c));
    expect(r).toMatchObject({ ok: false, code: "contrato_violado" });
    expect(ing.ingest).not.toHaveBeenCalled();
  });

  it("valido: ok e o ingest recebe organizacao e conta DA SESSAO", async () => {
    const r = await chamar(corpoValido, assinar(corpoValido));
    expect(r.ok).toBe(true);
    expect(ing.ingest).toHaveBeenCalledTimes(1);
    const arg = (ing.ingest.mock.calls[0] as unknown[])[1];
    expect(arg).toMatchObject({ organizationId: "org-1", channelSessionId: "s1", accountId: "IGACC" });
  });

  it("sessao sem instagram_account_id: o ingest recebe conta vazia (ignora tudo)", async () => {
    await handleInboundWebhook({} as never, {
      session: { ...sessao, instagram_account_id: null },
      rawBody: corpoValido,
      headers: new Headers({ "x-hub-signature-256": assinar(corpoValido) }),
      secret: SEGREDO,
    });
    expect((ing.ingest.mock.calls[0] as unknown[])[1]).toMatchObject({ accountId: "" });
  });
});

describe("verifyInboundHandshake", () => {
  const params = (token: string) =>
    new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "12345" });

  it("token certo devolve o challenge", () => {
    expect(verifyInboundHandshake({ provider: "instagram", params: params("tok-secreto-1"), pathToken: "tok-secreto-1" })).toBe("12345");
  });
  it("token errado devolve null", () => {
    expect(verifyInboundHandshake({ provider: "instagram", params: params("errado"), pathToken: "tok-secreto-1" })).toBeNull();
  });
  it("provider diferente devolve null", () => {
    expect(verifyInboundHandshake({ provider: "waha", params: params("tok-secreto-1"), pathToken: "tok-secreto-1" })).toBeNull();
  });
});
