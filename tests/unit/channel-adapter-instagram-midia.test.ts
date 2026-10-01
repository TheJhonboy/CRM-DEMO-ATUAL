import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mídia que o cliente manda no Instagram: o adapter baixa a URL assinada do CDN.
 * Sem `fetchInboundMedia` toda imagem/áudio recebido virava anexo vazio.
 */

const h = vi.hoisted(() => ({
  upload: vi.fn(),
  patches: [] as Record<string, unknown>[],
  rpc: vi.fn(),
}));

const msg = {
  id: "msg1",
  organization_id: "org1",
  conversation_id: "conv1",
  channel_session_id: "sess1",
  media_url: "https://scontent.cdninstagram.com/v/t51/abc.jpg?sig=1",
  media_mime: "image/jpeg",
  media_storage_path: null as string | null,
  metadata: {},
};
const sessao = { provider: "instagram", instagram_account_id: "IGACC" };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => ({
      select: () => {
        const r = { maybeSingle: async () => ({ data: tabela === "channel_sessions" ? sessao : msg, error: null }) };
        return { eq: () => ({ ...r, eq: () => r }) };
      },
      update: (p: Record<string, unknown>) => {
        h.patches.push(p);
        return { eq: () => ({ eq: async () => ({ error: null }) }) };
      },
    }),
    storage: { from: () => ({ upload: h.upload }) },
    rpc: h.rpc,
  }),
}));

import { getAdapter } from "@/lib/channels";
import { MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";
import { persistMessageMedia } from "@/workers/media-persist-worker";

const URL_OK = "https://scontent-gru1-1.cdninstagram.com/v/t51/abc.jpg?sig=1";
const entrada = (over: Record<string, unknown> = {}) => ({
  organizationId: "org1",
  sessionRef: "IGACC",
  url: URL_OK,
  hintMime: "image/jpeg",
  ...over,
});
const baixar = (over: Record<string, unknown> = {}) => getAdapter("instagram").fetchInboundMedia!(entrada(over));

function resp(body: Uint8Array | string, headers: Record<string, string> = { "content-type": "image/jpeg" }, status = 200) {
  return new Response(typeof body === "string" ? body : (body as BodyInit), { status, headers });
}

beforeEach(() => {
  h.upload.mockReset().mockResolvedValue({ error: null });
  h.patches.length = 0;
  h.rpc.mockReset().mockResolvedValue({ error: null });
  msg.media_storage_path = null;
});
afterEach(() => vi.unstubAllGlobals());

describe("adapter instagram — fetchInboundMedia", () => {
  it("existe (sem ele o worker pula e o anexo fica vazio)", () => {
    expect(getAdapter("instagram").fetchInboundMedia).toBeTypeOf("function");
  });

  it("caminho feliz: baixa SEM Authorization, redirect manual, timeout 15 s; mime do content-type", async () => {
    const spy = vi.fn().mockResolvedValue(resp(new Uint8Array([1, 2, 3]), { "content-type": "image/png; charset=x" }));
    vi.stubGlobal("fetch", spy);
    const r = await baixar();
    expect(r.mime).toBe("image/png");
    expect([...r.buffer]).toEqual([1, 2, 3]);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe(URL_OK);
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization/i);
  });

  it("sem content-type: usa a dica do webhook", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resp(new Uint8Array([1]), {})));
    expect((await baixar({ hintMime: "video/mp4" })).mime).toBe("video/mp4");
  });

  it("octet-stream com dica de mídia: usa a dica", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resp(new Uint8Array([1]), { "content-type": "application/octet-stream" })));
    expect((await baixar({ hintMime: "audio/mp4" })).mime).toBe("audio/mp4");
  });

  it.each([
    "http://scontent.cdninstagram.com/a.jpg",
    "https://evil.example/a.jpg",
    "https://cdninstagram.com.evil.example/a.jpg",
    "https://user:pw@scontent.cdninstagram.com/a.jpg",
    "https://scontent.cdninstagram.com:8443/a.jpg",
    "https://169.254.169.254/latest",
    "nao e url",
  ])("URL fora da allowlist (%s): recusa sem ir à rede", async (url) => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(baixar({ url })).rejects.toThrow(/instagram_media/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("erro de rede/fetch: falha sem resultado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(baixar()).rejects.toThrow(/instagram_media_failed/);
  });

  describe("redirects (lookaside.fbsbx.com -> CDN)", () => {
    const redir = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });
    const CDN = "https://scontent-gru2-1.cdninstagram.com/v/t51/final.jpg?sig=2";

    it("cadeia ok: segue ate o CDN, revalida cada Location, nunca manda Authorization", async () => {
      const spy = vi
        .fn()
        .mockResolvedValueOnce(redir(CDN))
        .mockResolvedValueOnce(resp(new Uint8Array([5]), { "content-type": "image/jpeg" }));
      vi.stubGlobal("fetch", spy);
      const r = await baixar({ url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" });
      expect([...r.buffer]).toEqual([5]);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[1]![0]).toBe(CDN);
      for (const [, init] of spy.mock.calls) {
        expect(init.redirect).toBe("manual");
        expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization/i);
      }
    });

    it("Location relativa e resolvida contra a URL atual (e revalidada)", async () => {
      const spy = vi
        .fn()
        .mockResolvedValueOnce(redir("/outro/caminho.jpg"))
        .mockResolvedValueOnce(resp(new Uint8Array([1])));
      vi.stubGlobal("fetch", spy);
      await baixar();
      expect(spy.mock.calls[1]![0]).toBe("https://scontent-gru1-1.cdninstagram.com/outro/caminho.jpg");
    });

    it.each([
      "https://evil.example/x.jpg",
      "http://scontent.cdninstagram.com/x.jpg",
      "https://user:pw@scontent.cdninstagram.com/x.jpg",
      "https://scontent.cdninstagram.com:444/x.jpg",
      "https://169.254.169.254/latest/meta-data",
    ])("salto para %s: recusado, sem segunda chamada", async (to) => {
      const spy = vi.fn().mockResolvedValue(redir(to));
      vi.stubGlobal("fetch", spy);
      await expect(baixar()).rejects.toThrow(/instagram_media_url_nao_permitida/);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("mais de 3 saltos: recusado", async () => {
      const spy = vi.fn().mockImplementation(async () => redir(CDN));
      vi.stubGlobal("fetch", spy);
      await expect(baixar()).rejects.toThrow(/instagram_media_redirects/);
      expect(spy).toHaveBeenCalledTimes(4); // inicial + 3 saltos seguidos; o 4o redirect e recusado
    });

    it("exatamente 3 saltos ainda passa", async () => {
      const spy = vi
        .fn()
        .mockResolvedValueOnce(redir(CDN))
        .mockResolvedValueOnce(redir(CDN))
        .mockResolvedValueOnce(redir(CDN))
        .mockResolvedValueOnce(resp(new Uint8Array([7])));
      vi.stubGlobal("fetch", spy);
      expect([...(await baixar()).buffer]).toEqual([7]);
    });

    it("redirect sem Location: erro", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 302 })));
      await expect(baixar()).rejects.toThrow(/instagram_media_redirects/);
    });
  });

  it("resposta sem corpo (body null) NAO vira buffer vazio de sucesso", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { "content-type": "image/jpeg" } })));
    await expect(baixar()).rejects.toThrow(/instagram_media_sem_corpo/);
  });

  it("resposta não-2xx: erro com o status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resp("x", {}, 403)));
    await expect(baixar()).rejects.toThrow(/403/);
  });

  it("content-length acima do teto: recusa antes de ler", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(resp(new Uint8Array([1]), { "content-type": "image/jpeg", "content-length": String(MAX_MEDIA_BYTES + 1) })),
    );
    await expect(baixar()).rejects.toThrow(/too_large|too large|exceeds/i);
  });

  it("corpo em stream acima do teto (sem content-length honesto): aborta durante a leitura", async () => {
    const pedaco = new Uint8Array(8 * 1024 * 1024).fill(1);
    let lidos = 0;
    let cancelado = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        lidos++;
        c.enqueue(pedaco);
        if (lidos > 20) c.close();
      },
      cancel() {
        cancelado = true;
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { headers: { "content-type": "video/mp4" } })));
    await expect(baixar()).rejects.toThrow(/too_large|too large|exceeds/i);
    expect(cancelado).toBe(true);
    expect(lidos).toBeLessThan(10);
  });

  it.each(["text/html; charset=utf-8", "application/json", "text/plain"])("content-type %s: não é mídia, recusa", async (ct) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resp("<html>login</html>", { "content-type": ct })));
    await expect(baixar()).rejects.toThrow(/instagram_media_not_media/);
  });

  it("html sem content-type e dica de imagem: ainda assim só aceita o que a dica/ct declara como mídia (dica image/* vale)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resp("<html>", {})));
    // sem content-type a dica decide; aqui a dica é texto -> recusa
    await expect(baixar({ hintMime: "text/html" })).rejects.toThrow(/instagram_media_not_media/);
  });

  it("timeout: erro, sem resultado parcial", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("t", "TimeoutError")));
    await expect(baixar()).rejects.toThrow(/instagram_media_failed/);
  });

  it("o erro não carrega a URL assinada", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`boom ${URL_OK}`)));
    const e = (await baixar().catch((x) => x)) as Error;
    expect(e.message).not.toContain("sig=1");
  });
});

describe("persistência ponta a ponta (worker + adapter do Instagram)", () => {
  const evento = {
    id: "ev1",
    organization_id: "org1",
    event_type: "media.persist_requested",
    entity_kind: "message",
    entity_id: "msg1",
    payload: { message_id: "msg1" },
    metadata: {},
    consumed_by: [],
    attempts: 0,
  };

  it("imagem do CDN vira bytes no storage e a mensagem recebe o caminho", async () => {
    const spy = vi.fn().mockResolvedValue(resp(new Uint8Array([9, 8, 7]), { "content-type": "image/jpeg" }));
    vi.stubGlobal("fetch", spy);
    const r = await persistMessageMedia(evento);
    expect(r.status).toBe("ok");
    expect(spy.mock.calls[0]![0]).toBe(msg.media_url);
    expect(h.upload).toHaveBeenCalledWith("org1/conv1/msg1.jpg", expect.any(Buffer), expect.objectContaining({ contentType: "image/jpeg" }));
    expect(h.patches.some((p) => p.media_storage_path === "org1/conv1/msg1.jpg")).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith("emit_event", expect.objectContaining({ p_event_type: "media.derive_requested" }));
  });

  it("URL fora da allowlist na linha: o worker NÃO pula como 'canal sem mídia' e nada vai ao storage", async () => {
    const original = msg.media_url;
    msg.media_url = "https://evil.example/x.jpg";
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await persistMessageMedia(evento);
    msg.media_url = original;
    expect(r.status).toBe("error");
    expect(spy).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });
});
