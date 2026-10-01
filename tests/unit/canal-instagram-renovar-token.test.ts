/**
 * POST /api/v1/channels/instagram/renovar-token e o estado derivado do token no GET.
 * Organização vem da sessão autenticada, nunca do corpo; nada de segredo na resposta.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("@/lib/channels/connect", () => ({
  findInstagramSession: vi.fn(),
}));
vi.mock("@/lib/channels/instagram/token", async (orig) => ({
  ...(await orig<typeof import("@/lib/channels/instagram/token")>()),
  renovarTokenDaSessao: vi.fn(),
}));

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { findInstagramSession } from "@/lib/channels/connect";
import { alertaDoToken, renovarTokenDaSessao } from "@/lib/channels/instagram/token";
import { POST } from "@/app/api/v1/channels/instagram/renovar-token/route";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSAO = "ssssssss-ssss-4sss-8sss-ssssssssssss";
const pedido = (corpo: unknown = {}) =>
  new NextRequest("https://crm.exemplo/api/v1/channels/instagram/renovar-token", {
    method: "POST",
    body: JSON.stringify(corpo),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createAdminClient).mockReturnValue({} as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "u1", idioma: "pt-BR" } as never,
    org: { orgId: ORG } as never,
  });
  vi.mocked(findInstagramSession).mockResolvedValue({
    id: SESSAO,
    accountId: "1784",
    displayName: "@x",
    status: "WORKING",
    webhookPathToken: "t",
    hasToken: true,
    archivedAt: null,
    tokenExpiresAt: null,
  });
});

describe("POST renovar-token", () => {
  it("quem não é admin recebe 403 e nada roda", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: new Response("{}", { status: 403 }),
    } as never);
    const r = await POST(pedido());
    expect(r.status).toBe(403);
    expect(renovarTokenDaSessao).not.toHaveBeenCalled();
  });

  it("limita a 6 por minuto por organização", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
    const r = await POST(pedido());
    expect(r.status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledWith(`instagram_renovar_token:${ORG}`, 6, 60);
    expect(renovarTokenDaSessao).not.toHaveBeenCalled();
  });

  it("sem canal conectado: 404", async () => {
    vi.mocked(findInstagramSession).mockResolvedValue(null);
    expect((await POST(pedido())).status).toBe(404);
    expect(renovarTokenDaSessao).not.toHaveBeenCalled();
  });

  it("renovado: usa a org da sessão autenticada (ignora organization_id do corpo) e devolve a validade", async () => {
    vi.mocked(renovarTokenDaSessao).mockResolvedValue({ ok: true, tokenValidoAte: "2026-12-01T00:00:00.000Z" });
    const r = await POST(pedido({ organization_id: "outra-org", sessionId: "outra" }));
    expect(r.status).toBe(200);
    const { data } = await r.json();
    expect(data).toMatchObject({ status: "renovado", tokenValidoAte: "2026-12-01T00:00:00.000Z" });
    expect(renovarTokenDaSessao).toHaveBeenCalledWith(expect.anything(), { organizationId: ORG, sessionId: SESSAO });
  });

  it.each([
    ["token_novo_demais", "novo_demais"],
    ["token_expirado", "expirado"],
    ["rede", "falhou"],
    ["recusado", "falhou"],
    ["resposta_invalida", "falhou"],
    ["cifra", "falhou"],
    ["banco", "falhou"],
    ["mudou_enquanto_isso", "falhou"],
  ] as const)("motivo %s vira status %s, com razão fixa e sem segredo", async (motivo, status) => {
    vi.mocked(renovarTokenDaSessao).mockResolvedValue({ ok: false, motivo });
    const r = await POST(pedido());
    const { data } = await r.json();
    expect(data.status).toBe(status);
    expect(data.tokenValidoAte).toBeNull();
    expect(typeof data.reason).toBe("string");
    expect(data.reason.length).toBeGreaterThan(10);
  });
});

describe("alertaDoToken", () => {
  const agora = Date.parse("2026-10-01T12:00:00Z");
  const em = (dias: number) => new Date(agora + dias * 86_400_000).toISOString();
  it("desconhecido sem validade", () => {
    expect(alertaDoToken(null, agora)).toEqual({ diasRestantes: null, alertaToken: "desconhecido" });
  });
  it("ok com mais de 10 dias", () => {
    expect(alertaDoToken(em(40), agora)).toEqual({ diasRestantes: 40, alertaToken: "ok" });
    expect(alertaDoToken(em(10.5), agora).alertaToken).toBe("ok");
  });
  it("vence em breve com 10 dias ou menos", () => {
    expect(alertaDoToken(em(10), agora)).toEqual({ diasRestantes: 10, alertaToken: "vence_em_breve" });
    expect(alertaDoToken(em(0.2), agora)).toEqual({ diasRestantes: 1, alertaToken: "vence_em_breve" });
  });
  it("expirado no passado", () => {
    expect(alertaDoToken(em(-1), agora)).toEqual({ diasRestantes: 0, alertaToken: "expirado" });
  });
  it("data inválida é desconhecida", () => {
    expect(alertaDoToken("lixo", agora).alertaToken).toBe("desconhecido");
  });
});
