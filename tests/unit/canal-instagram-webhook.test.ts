import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  instagramChallenge, lerEnvelopeInstagram, parseInstagramInbound, verifyInstagramSignature,
} from "@/lib/channels/instagram/webhook";

const SECRET = "app-secret-de-teste-0123456789";
const sign = (body: string) => "sha256=" + createHmac("sha256", SECRET).update(body, "utf8").digest("hex");

const msg = (over: Record<string, unknown> = {}) => JSON.stringify({
  object: "instagram",
  entry: [{ id: "IGACC", time: 1, messaging: [{
    sender: { id: "IGSID1" }, recipient: { id: "IGACC" }, timestamp: 1700000000000,
    message: { mid: "m_1", text: "oi, tem orçamento?", ...over },
  }] }],
});

describe("assinatura", () => {
  it("aceita assinatura válida", () => expect(verifyInstagramSignature(msg(), sign(msg()), SECRET)).toBe(true));
  it("recusa corpo adulterado", () => expect(verifyInstagramSignature(msg() + " ", sign(msg()), SECRET)).toBe(false));
  it("recusa sem header e sem segredo", () => {
    expect(verifyInstagramSignature(msg(), null, SECRET)).toBe(false);
    expect(verifyInstagramSignature(msg(), sign(msg()), "")).toBe(false);
  });
  it("recusa prefixo errado e hex de tamanho errado sem lançar", () => {
    expect(verifyInstagramSignature(msg(), "sha1=abc", SECRET)).toBe(false);
    expect(verifyInstagramSignature(msg(), "sha256=abc", SECRET)).toBe(false);
  });
  it("recusa hex de tamanho certo mas não hexadecimal, sem lançar", () => {
    expect(verifyInstagramSignature(msg(), "sha256=" + "z".repeat(64), SECRET)).toBe(false);
  });
});

describe("handshake", () => {
  const p = (o: Record<string, string>) => new URLSearchParams(o);
  it("devolve o challenge com token certo", () =>
    expect(instagramChallenge(p({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "123" }), "tok")).toBe("123"));
  it("null com token errado, modo errado ou esperado vazio", () => {
    expect(instagramChallenge(p({ "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "1" }), "tok")).toBeNull();
    expect(instagramChallenge(p({ "hub.mode": "unsubscribe", "hub.verify_token": "tok", "hub.challenge": "1" }), "tok")).toBeNull();
    expect(instagramChallenge(p({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }), "")).toBeNull();
  });
});

describe("envelope e parse", () => {
  it("lê mensagem de texto", () => {
    const r = lerEnvelopeInstagram(msg());
    if (!r.ok) throw new Error("esperava ok");
    expect(parseInstagramInbound(r.envelope)).toEqual([{
      kind: "message", externalId: "m_1", accountId: "IGACC", senderId: "IGSID1",
      text: "oi, tem orçamento?", attachments: [], timestamp: 1700000000000, isEcho: false,
    }]);
  });
  it("marca eco", () => {
    const r = lerEnvelopeInstagram(msg({ is_echo: true }));
    if (!r.ok) throw new Error();
    expect(parseInstagramInbound(r.envelope)[0]).toMatchObject({ kind: "message", isEcho: true });
  });
  it("aceita só anexo, sem texto", () => {
    const r = lerEnvelopeInstagram(msg({ text: undefined, attachments: [{ type: "image", payload: { url: "https://cdn.exemplo/x.jpg" } }] }));
    if (!r.ok) throw new Error();
    expect(parseInstagramInbound(r.envelope)[0]).toMatchObject({ text: null, attachments: [{ type: "image", url: "https://cdn.exemplo/x.jpg" }] });
  });
  it("json inválido", () => expect(lerEnvelopeInstagram("{nao")).toEqual({ ok: false, motivo: "json_invalido" }));
  it("contrato violado: entry numérico e mid numérico", () => {
    expect(lerEnvelopeInstagram(JSON.stringify({ object: "instagram", entry: 7 }))).toMatchObject({ ok: false, motivo: "contrato_violado" });
    expect(lerEnvelopeInstagram(msg({ mid: 5 }))).toMatchObject({ ok: false, motivo: "contrato_violado" });
  });
  it("contrato violado nomeia campos, nunca valores", () => {
    const r = lerEnvelopeInstagram(msg({ mid: 987654321 }));
    if (r.ok || r.motivo !== "contrato_violado") throw new Error();
    expect(r.campos).toEqual(["entry.0.messaging.0.message.mid"]);
    expect(JSON.stringify(r)).not.toContain("987654321");
  });
  it("ignora object diferente de instagram", () => {
    const r = lerEnvelopeInstagram(JSON.stringify({ object: "page", entry: [] }));
    if (!r.ok) throw new Error();
    expect(parseInstagramInbound(r.envelope)).toEqual([]);
  });
  it("anexo malformado é ignorado sem descartar a mensagem nem lançar", () => {
    const r = lerEnvelopeInstagram(msg({ attachments: [{ type: 3 }, null, { type: "audio" }] }));
    if (!r.ok) throw new Error();
    expect(parseInstagramInbound(r.envelope)[0]).toMatchObject({ attachments: [{ type: "audio", url: null }] });
  });
  it("read vira evento read", () => {
    const body = JSON.stringify({ object: "instagram", entry: [{ id: "IGACC", time: 1, messaging: [{ sender: { id: "IGSID1" }, recipient: { id: "IGACC" }, timestamp: 5, read: { mid: "m_9" } }] }] });
    const r = lerEnvelopeInstagram(body);
    if (!r.ok) throw new Error();
    expect(parseInstagramInbound(r.envelope)).toEqual([{ kind: "read", accountId: "IGACC", senderId: "IGSID1", timestamp: 5 }]);
  });
});
