import { beforeEach, describe, expect, it, vi } from "vitest";

/** GET da rota neutra: handshake em texto puro, 404 token desconhecido, 403 token errado. */

let sessao: { provider: string; archived_at?: string | null } | null = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: sessao, error: null }) }) }) }),
  }),
}));

import { GET } from "@/app/api/v1/webhooks/channel/[token]/route";

const TOKEN = "tok-secreto-1234";
const chamar = (token: string, query: string) => {
  const url = new URL(`https://crm.test/api/v1/webhooks/channel/${token}?${query}`);
  const req = { nextUrl: url } as never;
  return GET(req, { params: Promise.resolve({ token }) });
};
const q = (t: string) => `hub.mode=subscribe&hub.verify_token=${t}&hub.challenge=98765`;

beforeEach(() => {
  sessao = { provider: "instagram" };
});

describe("GET /webhooks/channel/[token]", () => {
  it("token certo: 200 text/plain com o challenge cru", async () => {
    const r = await chamar(TOKEN, q(TOKEN));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/plain");
    expect(await r.text()).toBe("98765");
  });
  it("verify_token errado: 403", async () => {
    expect((await chamar(TOKEN, q("outro-token-xx"))).status).toBe(403);
  });
  it("token de path desconhecido: 404", async () => {
    sessao = null;
    expect((await chamar(TOKEN, q(TOKEN))).status).toBe(404);
  });
  it("token curto: 404 sem consultar o banco", async () => {
    expect((await chamar("curto", q("curto"))).status).toBe(404);
  });
  it("canal arquivado: 404, nao responde o handshake", async () => {
    sessao = { provider: "instagram", archived_at: "2026-09-01T00:00:00Z" };
    expect((await chamar(TOKEN, q(TOKEN))).status).toBe(404);
  });
  it("provider que nao faz handshake: 403", async () => {
    sessao = { provider: "zernio" };
    expect((await chamar(TOKEN, q(TOKEN))).status).toBe(403);
  });
});
