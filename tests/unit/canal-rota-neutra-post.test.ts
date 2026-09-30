import { beforeEach, describe, expect, it, vi } from "vitest";

/** POST da rota neutra: corpo limitado antes de gravar, erro interno sem detalhe público. */

const h = vi.hoisted(() => ({
  abrir: vi.fn(async () => ({ id: "arq-1" })),
  fechar: vi.fn(async () => undefined),
  tratar: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const SESSAO = {
  id: "s1", organization_id: "o1", provider: "instagram", display_name: "x", phone_number: null,
  instagram_account_id: "IGACC", webhook_secret_encrypted: null, archived_at: null,
};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: SESSAO, error: null }) }) }) }),
  }),
}));
vi.mock("@/lib/channels/arquivo-de-webhook", () => ({ abrirArquivoDoWebhook: h.abrir, fecharArquivoDoWebhook: h.fechar }));
vi.mock("@/lib/logger", () => ({ logger: { warn: h.warn, error: h.error, info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: vi.fn(async () => null) }));
vi.mock("@/lib/channels/inbound", async (orig) => ({
  ...(await orig<typeof import("@/lib/channels/inbound")>()),
  handleInboundWebhook: h.tratar,
}));

import { POST } from "@/app/api/v1/webhooks/channel/[token]/route";
import { LIMITE_CORPO_WEBHOOK_BYTES } from "@/lib/channels/inbound";

const TOKEN = "tok-secreto-1234";
const chamar = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new Request(`https://crm.test/api/v1/webhooks/channel/${TOKEN}`, { method: "POST", body, headers }) as never,
    { params: Promise.resolve({ token: TOKEN }) },
  );

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockClear());
  h.tratar.mockReset();
  h.tratar.mockResolvedValue({ ok: true, body: { status: "ingested" } });
});

describe("POST /webhooks/channel/[token]", () => {
  it("o limite e 1 MiB", () => expect(LIMITE_CORPO_WEBHOOK_BYTES).toBe(1024 * 1024));

  it("corpo normal segue o fluxo", async () => {
    const r = await chamar('{"a":1}');
    expect(r.status).toBe(200);
    expect(h.abrir).toHaveBeenCalledTimes(1);
  });

  it("content-length acima do limite: 413 sem abrir arquivo nem tratar", async () => {
    const r = await chamar("{}", { "content-length": String(LIMITE_CORPO_WEBHOOK_BYTES + 1) });
    expect(r.status).toBe(413);
    expect((await r.json()).error.code).toBe("payload_too_large");
    expect(h.abrir).not.toHaveBeenCalled();
    expect(h.tratar).not.toHaveBeenCalled();
  });

  it("corpo lido acima do limite (sem header honesto): 413 sem abrir arquivo", async () => {
    const r = await chamar("a".repeat(LIMITE_CORPO_WEBHOOK_BYTES + 1));
    expect(r.status).toBe(413);
    expect(h.abrir).not.toHaveBeenCalled();
    expect(h.tratar).not.toHaveBeenCalled();
  });

  it("corpo exatamente no limite passa", async () => {
    const r = await chamar("a".repeat(LIMITE_CORPO_WEBHOOK_BYTES));
    expect(r.status).toBe(200);
  });

  it("excecao interna: resposta generica, detalhe so no arquivo e no log", async () => {
    h.tratar.mockRejectedValue(new Error("duplicate key value violates unique constraint segredo-interno"));
    const r = await chamar("{}");
    expect(r.status).toBe(500);
    const texto = await r.text();
    expect(texto).not.toContain("segredo-interno");
    expect(texto).toContain("internal_error");
    expect(h.fechar).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ erro: expect.stringContaining("segredo-interno") }));
    expect(JSON.stringify(h.error.mock.calls)).toContain("segredo-interno");
  });
});
