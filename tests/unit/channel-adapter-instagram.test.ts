import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const creds = vi.hoisted(() => ({
  resolve: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/channels/instagram/credentials", () => ({
  resolveInstagramCredentials: creds.resolve,
}));

import { getAdapter } from "@/lib/channels";

const ORG = "org-1";
const TOKEN = "IGQW-SEGREDO-NAO-VAZAR-123";
const BASE = "https://graph.exemplo.test/vX";
const a = () => getAdapter("instagram");

const envio = (over: Record<string, unknown> = {}) =>
  ({
    organizationId: ORG,
    sessionRef: "IGACC",
    to: "x",
    kind: "text",
    body: "oi",
    providerConversationId: "IGSID_1",
    ...over,
  }) as Parameters<ReturnType<typeof a>["send"]>[0];

function resposta(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  creds.resolve.mockReset();
  creds.resolve.mockResolvedValue({ accountId: "IGACC", accessToken: TOKEN, baseUrl: BASE });
});
afterEach(() => vi.unstubAllGlobals());

const erroDe = async (p: Promise<unknown>): Promise<Error> => {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("nao lancou");
};

describe("adapter instagram", () => {
  it("contrato: provider, codes, sem endereco pelo contato, isConfigured sincrono", () => {
    expect(a().provider).toBe("instagram");
    expect(a().codes).toEqual({
      notConfigured: "instagram_not_configured",
      sendFailed: "instagram_send_failed",
      unknownError: "instagram_unknown_error",
    });
    expect(a().resolveRecipient({ isGroup: false, groupChatId: null, phoneNumber: "+5511", waIdentity: null })).toBeNull();
    expect(a().isConfigured()).toBe(true);
    expect(a().echoExternalIds).toBeUndefined();
  });

  it("texto: POST {base}/{conta}/messages com Bearer e corpo certo; devolve message_id", async () => {
    const spy = vi.fn().mockResolvedValue(resposta(200, { message_id: "mid.ok" }));
    vi.stubGlobal("fetch", spy);
    const r = await a().send(envio());
    expect(r).toEqual({ externalId: "mid.ok" });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe(`${BASE}/IGACC/messages`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      recipient: { id: "IGSID_1" },
      message: { text: "oi" },
      messaging_type: "RESPONSE",
    });
  });

  it.each([
    ["image", "image"],
    ["video", "video"],
    ["audio", "audio"],
    ["document", "file"],
  ])("midia %s vai como attachment por URL (%s)", async (kind, tipo) => {
    const spy = vi.fn().mockResolvedValue(resposta(200, { message_id: "m" }));
    vi.stubGlobal("fetch", spy);
    await a().send(envio({ kind, media: { url: "https://x/y", mime: "a/b" } }));
    expect(JSON.parse(spy.mock.calls[0]![1].body).message).toEqual({
      attachment: { type: tipo, payload: { url: "https://x/y" } },
    });
  });

  it.each(["sticker", "location", "contact", "template"])("kind %s: kind_nao_suportado, sem rede", async (kind) => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const e = await erroDe(a().send(envio({ kind, media: { url: "https://x/y", mime: "a/b" } })));
    expect(e.message).toBe("instagram_send_failed: kind_nao_suportado");
    expect(spy).not.toHaveBeenCalled();
  });

  it("midia sem url: kind_nao_suportado", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const e = await erroDe(a().send(envio({ kind: "image" })));
    expect(e.message).toContain("kind_nao_suportado");
  });

  it("sem thread: lanca sem_thread_do_instagram e nao vai a rede", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const e = await erroDe(a().send(envio({ providerConversationId: null })));
    expect(e.message).toBe("instagram_send_failed: sem_thread_do_instagram");
    expect(spy).not.toHaveBeenCalled();
  });

  it("400 nao re-tenta", async () => {
    const spy = vi.fn().mockResolvedValue(resposta(400, { error: { code: 100 } }));
    vi.stubGlobal("fetch", spy);
    const e = await erroDe(a().send(envio()));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(e.message).toBe("instagram_send_failed: http_400");
  });

  it("500 re-tenta uma vez e pode recuperar", async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(resposta(500, {}))
      .mockResolvedValueOnce(resposta(200, { message_id: "mid.2" }));
    vi.stubGlobal("fetch", spy);
    expect(await a().send(envio())).toEqual({ externalId: "mid.2" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("500 duas vezes: para em 2 chamadas e falha retentavel", async () => {
    const spy = vi.fn().mockResolvedValue(resposta(503, {}));
    vi.stubGlobal("fetch", spy);
    const e = await erroDe(a().send(envio()));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(e).toMatchObject({ retryable: true });
  });

  it("erro de rede re-tenta uma vez", async () => {
    const spy = vi
      .fn()
      .mockRejectedValueOnce(new TypeError(`fetch failed Bearer ${TOKEN}`))
      .mockResolvedValueOnce(resposta(200, { message_id: "mid.3" }));
    vi.stubGlobal("fetch", spy);
    expect(await a().send(envio())).toEqual({ externalId: "mid.3" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("rede caindo duas vezes: rede_indisponivel, sem vazar a mensagem original", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError(`boom ${TOKEN}`)));
    const e = await erroDe(a().send(envio()));
    expect(e.message).toBe("instagram_send_failed: rede_indisponivel");
    expect(e).toMatchObject({ retryable: true });
  });

  it.each([
    [190, "token_expirado"],
    [10, "fora_da_janela"],
    [551, "fora_da_janela"],
    [4, "limite_de_taxa"],
    [17, "limite_de_taxa"],
    [32, "limite_de_taxa"],
    [613, "limite_de_taxa"],
  ])("erro Meta %i vira %s, sem re-tentar, e o token nunca aparece", async (code, detalhe) => {
    const spy = vi
      .fn()
      .mockResolvedValue(resposta(400, { error: { code, message: `token ${TOKEN} invalido` } }));
    vi.stubGlobal("fetch", spy);
    const e = await erroDe(a().send(envio()));
    expect(e.message).toBe(`instagram_send_failed: ${detalhe}`);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(e)).not.toContain(TOKEN);
    expect(String(e.stack)).not.toContain(TOKEN);
    expect(e.message).not.toContain(TOKEN);
  });

  it("credencial ausente: instagram_not_configured, sem rede", async () => {
    creds.resolve.mockResolvedValue(null);
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const e = await erroDe(a().send(envio()));
    expect(e.message).toMatch(/^instagram_not_configured/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("consulta de credencial falhou: credenciais_indisponiveis RETENTAVEL, distinto de not_configured", async () => {
    creds.resolve.mockRejectedValue(new Error(`instagram_creds_lookup_failed: 57P01 ${TOKEN}`));
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const e = await erroDe(a().send(envio()));
    expect(e.message).toBe("instagram_send_failed: credenciais_indisponiveis");
    expect(e.message).not.toMatch(/not_configured/);
    expect(e).toMatchObject({ retryable: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it("beforeSend roda antes do fetch", async () => {
    const ordem: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (ordem.push("fetch"), resposta(200, { message_id: "m" }))),
    );
    await a().send(envio({ beforeSend: async () => void ordem.push("before") }));
    expect(ordem).toEqual(["before", "fetch"]);
  });

  it("beforeSend que veta impede a rede", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(
      a().send(envio({ beforeSend: async () => { throw new Error("veto"); } })),
    ).rejects.toThrow("veto");
    expect(spy).not.toHaveBeenCalled();
  });

  it("a busca de credencial leva organizacao e conta da sessao", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resposta(200, { message_id: "m" })));
    await a().send(envio());
    expect(creds.resolve).toHaveBeenCalledWith(expect.anything(), { organizationId: ORG, accountId: "IGACC" });
  });
});

describe("adapter instagram — checkHealth", () => {
  const saude = () => a().checkHealth!({ organizationId: ORG, sessionRef: "IGACC" });

  it("200: WORKING, GET /{conta}?fields=username com Bearer", async () => {
    const spy = vi.fn().mockResolvedValue(resposta(200, { username: "loja" }));
    vi.stubGlobal("fetch", spy);
    expect(await saude()).toEqual({ reachable: true, status: "WORKING", detail: null });
    expect(spy.mock.calls[0]![0]).toBe(`${BASE}/IGACC?fields=username`);
    expect(spy.mock.calls[0]![1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("190: token_expirado, alcancavel", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resposta(400, { error: { code: 190 } })));
    const r = await saude();
    expect(r).toMatchObject({ reachable: true, status: "token_expirado" });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it("5xx e rede: reachable false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resposta(502, {})));
    expect(await saude()).toMatchObject({ reachable: false, status: null });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(TOKEN)));
    const r = await saude();
    expect(r).toMatchObject({ reachable: false, status: null });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it("sem credencial ou consulta falhando: reachable false sem rede", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    creds.resolve.mockResolvedValue(null);
    expect(await saude()).toMatchObject({ reachable: false });
    creds.resolve.mockRejectedValue(new Error("x"));
    expect(await saude()).toMatchObject({ reachable: false, detail: "credenciais_indisponiveis" });
    expect(spy).not.toHaveBeenCalled();
  });
});
