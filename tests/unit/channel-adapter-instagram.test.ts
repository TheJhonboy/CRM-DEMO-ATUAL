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
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body)).toEqual({
      recipient: { id: "IGSID_1" },
      message: { text: "oi" },
    });
    expect(JSON.parse(init.body)).not.toHaveProperty("messaging_type");
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

  it("timeout NAO re-tenta (o pedido pode ter chegado): uma chamada, detalhe timeout", async () => {
    const spy = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    vi.stubGlobal("fetch", spy);
    const e = await erroDe(a().send(envio()));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(e.message).toBe("instagram_send_failed: timeout");
    expect(e).toMatchObject({ retryable: false });
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

describe("adapter instagram — texto longo em partes", () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const corpos = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls.map((c) => JSON.parse(c[1].body));

  it("1000 bytes: uma chamada so", async () => {
    const spy = vi.fn().mockResolvedValue(resposta(200, { message_id: "m1" }));
    vi.stubGlobal("fetch", spy);
    await a().send(envio({ body: "a".repeat(1000) }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("1001 bytes: duas chamadas em sequencia; externalId = mid da primeira; sem messaging_type", async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(resposta(200, { message_id: "m1" }))
      .mockResolvedValueOnce(resposta(200, { message_id: "m2" }));
    vi.stubGlobal("fetch", spy);
    const r = await a().send(envio({ body: "a".repeat(1001) }));
    expect(r).toEqual({ externalId: "m1" });
    expect(spy).toHaveBeenCalledTimes(2);
    for (const b of corpos(spy)) {
      expect(b).not.toHaveProperty("messaging_type");
      expect(bytes(b.message.text)).toBeLessThanOrEqual(1000);
    }
  });

  it("paragrafos longos: partes respeitam paragrafo e beforeSend roda uma vez", async () => {
    const p1 = "Primeiro paragrafo. ".repeat(30).trim();
    const p2 = "Segundo paragrafo. ".repeat(30).trim();
    const spy = vi.fn().mockResolvedValue(resposta(200, { message_id: "m" }));
    vi.stubGlobal("fetch", spy);
    const beforeSend = vi.fn();
    await a().send(envio({ body: `${p1}

${p2}`, beforeSend }));
    expect(corpos(spy).map((b) => b.message.text)).toEqual([p1, p2]);
    expect(beforeSend).toHaveBeenCalledTimes(1);
  });

  it("emoji na borda: nenhuma parte quebra o ponto de codigo", async () => {
    const spy = vi.fn().mockResolvedValue(resposta(200, { message_id: "m" }));
    vi.stubGlobal("fetch", spy);
    await a().send(envio({ body: "a".repeat(998) + "😀😀😀" }));
    const textos = corpos(spy).map((b) => b.message.text as string);
    expect(textos.join("")).toBe("a".repeat(998) + "😀😀😀");
    for (const t of textos) expect(t).not.toContain("�");
  });

  it("falha na parte 2: lanca com a parte no detalhe, sem mandar a 3; 4xx nao re-tenta", async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(resposta(200, { message_id: "m1" }))
      .mockResolvedValueOnce(resposta(400, { error: { code: 100 } }));
    vi.stubGlobal("fetch", spy);
    const e = await erroDe(a().send(envio({ body: "a".repeat(2500) })));
    expect(e.message).toBe("instagram_send_failed: http_400 (parte 2/3)");
    expect(spy).toHaveBeenCalledTimes(2);
    expect((e as unknown as { externalIdsEnviados: string[] }).externalIdsEnviados).toEqual(["m1"]);
  });

  it("5xx na parte 2 NAO e retentavel (re-enviar duplicaria a parte 1); na parte 1 segue retentavel", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(resposta(200, { message_id: "m1" }))
        .mockResolvedValue(resposta(503, {})),
    );
    const e2 = await erroDe(a().send(envio({ body: "a".repeat(1500) })));
    expect((e2 as unknown as { retryable: boolean }).retryable).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resposta(503, {})));
    const e1 = await erroDe(a().send(envio({ body: "a".repeat(1500) })));
    expect((e1 as unknown as { retryable: boolean }).retryable).toBe(true);
  });

  it("parte 1 falha num texto longo: detalhe com parte 1/2", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resposta(400, { error: { code: 100 } })));
    const e = await erroDe(a().send(envio({ body: "a".repeat(1500) })));
    expect(e.message).toBe("instagram_send_failed: http_400 (parte 1/2)");
  });
});

describe("adapter instagram — checkHealth", () => {
  const saude = () => a().checkHealth!({ organizationId: ORG, sessionRef: "IGACC" });

  it("200: WORKING, GET /me?fields=user_id,username com Bearer", async () => {
    const spy = vi.fn().mockResolvedValue(resposta(200, { username: "loja" }));
    vi.stubGlobal("fetch", spy);
    expect(await saude()).toEqual({ reachable: true, status: "WORKING", detail: null });
    expect(spy.mock.calls[0]![0]).toBe(`${BASE}/me?fields=user_id,username`);
    expect(spy.mock.calls[0]![1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(spy.mock.calls[0]![1].redirect).toBe("error");
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
