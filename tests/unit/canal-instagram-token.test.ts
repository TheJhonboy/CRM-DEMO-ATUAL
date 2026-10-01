/**
 * Renovação do token do Instagram (long-lived, 60 dias). Fetch e banco falsos.
 * O que importa: o token NUNCA aparece em erro/resultado, o fetch roda com
 * `redirect: "error"` e timeout, e a sessão é buscada por organização.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renovarToken, renovarTokenDaSessao, trocarPorTokenLongo } from "@/lib/channels/instagram/token";

const TOKEN = "IGAAtokenSecretoDeTeste0123456789";
const NOVO = "IGAAtokenNOVOrenovado9876543210";
const SEGREDO = "app_secret_de_teste_0123456789";
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSAO = "ssssssss-ssss-4sss-8sss-ssssssssssss";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const resp = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const nenhumSegredo = (v: unknown) => {
  const s = JSON.stringify(v);
  for (const x of [TOKEN, NOVO, SEGREDO]) expect(s).not.toContain(x);
};

describe("renovarToken", () => {
  it("sucesso: devolve token novo e segundos", async () => {
    fetchMock.mockResolvedValue(resp(200, { access_token: NOVO, token_type: "bearer", expires_in: 5183944 }));
    const r = await renovarToken({ tokenAtual: TOKEN });
    expect(r).toEqual({ ok: true, accessToken: NOVO, expiresInSeconds: 5183944 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("https://graph.instagram.com/refresh_access_token?");
    expect(String(url)).toContain("grant_type=ig_refresh_token");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("token com menos de 24 h: token_novo_demais", async () => {
    fetchMock.mockResolvedValue(
      resp(400, { error: { message: "Cannot refresh a token less than 24 hours old", code: 10, type: "x" } }),
    );
    expect(await renovarToken({ tokenAtual: TOKEN })).toEqual({ ok: false, motivo: "token_novo_demais" });
  });

  it("token expirado/invalido (190): token_expirado", async () => {
    fetchMock.mockResolvedValue(resp(400, { error: { message: `Session expired ${TOKEN}`, code: 190 } }));
    const r = await renovarToken({ tokenAtual: TOKEN });
    expect(r).toEqual({ ok: false, motivo: "token_expirado" });
    nenhumSegredo(r);
  });

  it("outro erro da Meta: recusado", async () => {
    fetchMock.mockResolvedValue(resp(400, { error: { message: "x", code: 999 } }));
    expect(await renovarToken({ tokenAtual: TOKEN })).toEqual({ ok: false, motivo: "recusado" });
  });

  it("rede/timeout/5xx: rede, sem vazar a causa", async () => {
    fetchMock.mockRejectedValue(new Error(`fetch failed https://x?access_token=${TOKEN}`));
    const r = await renovarToken({ tokenAtual: TOKEN });
    expect(r).toEqual({ ok: false, motivo: "rede" });
    nenhumSegredo(r);
    fetchMock.mockResolvedValue(resp(503, "bad gateway"));
    expect(await renovarToken({ tokenAtual: TOKEN })).toEqual({ ok: false, motivo: "rede" });
  });

  it("JSON inválido ou campos faltando: resposta_invalida", async () => {
    fetchMock.mockResolvedValue(resp(200, "<html>"));
    expect(await renovarToken({ tokenAtual: TOKEN })).toEqual({ ok: false, motivo: "resposta_invalida" });
    fetchMock.mockResolvedValue(resp(200, { access_token: NOVO }));
    expect(await renovarToken({ tokenAtual: TOKEN })).toEqual({ ok: false, motivo: "resposta_invalida" });
    fetchMock.mockResolvedValue(resp(200, { access_token: NOVO, expires_in: -5 }));
    expect(await renovarToken({ tokenAtual: TOKEN })).toEqual({ ok: false, motivo: "resposta_invalida" });
  });
});

describe("trocarPorTokenLongo", () => {
  it("troca com ig_exchange_token e segredo na query", async () => {
    fetchMock.mockResolvedValue(resp(200, { access_token: NOVO, token_type: "bearer", expires_in: 5183944 }));
    const r = await trocarPorTokenLongo({ appSecret: SEGREDO, tokenCurto: TOKEN });
    expect(r).toEqual({ ok: true, accessToken: NOVO, expiresInSeconds: 5183944 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("grant_type=ig_exchange_token");
    expect(String(url)).toContain("client_secret=");
    expect(init.redirect).toBe("error");
  });

  it("recusa (token já longo) vira recusado e não vaza segredo", async () => {
    fetchMock.mockResolvedValue(resp(400, { error: { message: `bad ${SEGREDO}`, code: 100 } }));
    const r = await trocarPorTokenLongo({ appSecret: SEGREDO, tokenCurto: TOKEN });
    expect(r).toEqual({ ok: false, motivo: "recusado" });
    nenhumSegredo(r);
  });

  it("rede: rede", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    expect(await trocarPorTokenLongo({ appSecret: SEGREDO, tokenCurto: TOKEN })).toEqual({
      ok: false,
      motivo: "rede",
    });
  });
});

/** Banco falso: registra filtros e o update. */
function banco(
  opts: { linha?: Record<string, unknown> | null; cifraOk?: boolean; decifraOk?: boolean; erroUpdate?: boolean } = {},
) {
  const linha =
    opts.linha === undefined
      ? { id: SESSAO, instagram_token_encrypted: "\\x" + Buffer.from(`ENC:${TOKEN}`).toString("hex") }
      : opts.linha;
  const filtros: Array<[string, unknown]> = [];
  const updates: Array<{ valores: Record<string, unknown>; filtros: Array<[string, unknown]> }> = [];
  const q = (modo: "select" | "update", valores?: Record<string, unknown>) => {
    const f: Array<[string, unknown]> = [];
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (c: string, v: unknown) => (f.push([c, v]), filtros.push([c, v]), api),
      is: (c: string, v: unknown) => (f.push([c, v]), api),
      maybeSingle: async () => ({ data: linha, error: null }),
      then: (res: (v: unknown) => unknown) => {
        if (modo === "update") updates.push({ valores: valores!, filtros: f });
        return Promise.resolve({ error: opts.erroUpdate ? { message: "x" } : null }).then(res);
      },
    };
    return api;
  };
  const admin = {
    from: () => ({ select: () => q("select"), update: (v: Record<string, unknown>) => q("update", v) }),
    rpc: async (nome: string, args: Record<string, string>) => {
      if (nome === "fn_encrypt_oauth")
        return opts.cifraOk === false
          ? { data: null, error: { message: "sem chave" } }
          : { data: `\\x${Buffer.from(`ENC:${args.plaintext}`).toString("hex")}`, error: null };
      return opts.decifraOk === false
        ? { data: null, error: { message: "sem chave" } }
        : {
            data: Buffer.from(args.ciphertext!.replace(/^\\x/, ""), "hex").toString().replace(/^ENC:/, ""),
            error: null,
          };
    },
  };
  return { admin: admin as never, filtros, updates };
}

describe("renovarTokenDaSessao", () => {
  it("renova, cifra o novo e grava token+validade escopados por org e sessão", async () => {
    fetchMock.mockResolvedValue(resp(200, { access_token: NOVO, token_type: "bearer", expires_in: 5183944 }));
    const { admin, filtros, updates } = banco();
    const antes = Date.now();
    const r = await renovarTokenDaSessao(admin, { organizationId: ORG, sessionId: SESSAO });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperava ok");
    expect(Date.parse(r.tokenValidoAte)).toBeGreaterThanOrEqual(antes + 5183944 * 1000 - 50);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(encodeURIComponent(TOKEN));
    expect(filtros).toContainEqual(["organization_id", ORG]);
    expect(filtros).toContainEqual(["id", SESSAO]);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.filtros).toContainEqual(["organization_id", ORG]);
    expect(updates[0]!.filtros).toContainEqual(["id", SESSAO]);
    expect(Object.keys(updates[0]!.valores).sort()).toEqual([
      "instagram_token_encrypted",
      "instagram_token_expires_at",
    ]);
    expect(String(updates[0]!.valores.instagram_token_encrypted)).not.toContain(NOVO);
    nenhumSegredo(r);
  });

  it("token novo demais / expirado / rede propagam o motivo e NÃO gravam", async () => {
    for (const [corpo, motivo] of [
      [{ error: { message: "less than 24 hours", code: 10 } }, "token_novo_demais"],
      [{ error: { code: 190 } }, "token_expirado"],
    ] as const) {
      fetchMock.mockResolvedValue(resp(400, corpo));
      const { admin, updates } = banco();
      const r = await renovarTokenDaSessao(admin, { organizationId: ORG, sessionId: SESSAO });
      expect(r).toEqual({ ok: false, motivo });
      expect(updates).toHaveLength(0);
    }
    fetchMock.mockRejectedValue(new Error(TOKEN));
    const { admin } = banco();
    const r = await renovarTokenDaSessao(admin, { organizationId: ORG, sessionId: SESSAO });
    expect(r).toEqual({ ok: false, motivo: "rede" });
  });

  it("sem sessão, sem credencial ou cifra indisponível: motivo seguro", async () => {
    expect(
      await renovarTokenDaSessao(banco({ linha: null }).admin, { organizationId: ORG, sessionId: SESSAO }),
    ).toEqual({ ok: false, motivo: "sem_sessao" });
    expect(
      await renovarTokenDaSessao(banco({ decifraOk: false }).admin, { organizationId: ORG, sessionId: SESSAO }),
    ).toEqual({ ok: false, motivo: "sem_credencial" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(resp(200, { access_token: NOVO, expires_in: 5000000 }));
    const { admin, updates } = banco({ cifraOk: false });
    expect(await renovarTokenDaSessao(admin, { organizationId: ORG, sessionId: SESSAO })).toEqual({
      ok: false,
      motivo: "cifra",
    });
    expect(updates).toHaveLength(0);
  });

  it("falha ao gravar: banco, sem vazar o token novo", async () => {
    fetchMock.mockResolvedValue(resp(200, { access_token: NOVO, expires_in: 5000000 }));
    const r = await renovarTokenDaSessao(banco({ erroUpdate: true }).admin, {
      organizationId: ORG,
      sessionId: SESSAO,
    });
    expect(r).toEqual({ ok: false, motivo: "banco" });
    nenhumSegredo(r);
  });
});
