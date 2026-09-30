import { afterEach, describe, expect, it, vi } from "vitest";

import { instagramBaseUrl, resolveInstagramCredentials } from "@/lib/channels/instagram/credentials";
import { graphVersion } from "@/lib/graph-version";

/**
 * Admin falso encadeável: registra cada filtro e devolve `result` no terminal.
 * `rpc` faz o papel de `fn_decrypt_oauth`.
 */
function fakeAdmin(opts: {
  result: { data: unknown; error: { code?: string; message?: string } | null };
  decrypted?: string | null;
}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is"]) {
    chain[m] = (...a: unknown[]) => {
      calls.push([m, ...a]);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(opts.result);
  const rpc = vi.fn(async () => ({ data: opts.decrypted ?? null, error: null }));
  const admin = { from: vi.fn(() => chain), rpc } as never;
  return { admin, calls, rpc };
}

const ROW = { instagram_account_id: "1784", instagram_token_encrypted: "\xabcd" };
const LOOKUP = { organizationId: "org-1", accountId: "1784" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveInstagramCredentials", () => {
  it("devolve as credenciais da sessão quando há linha e token decifrável", async () => {
    const { admin } = fakeAdmin({ result: { data: ROW, error: null }, decrypted: "TOKEN" });
    const c = await resolveInstagramCredentials(admin, LOOKUP);
    expect(c).toEqual({ accountId: "1784", accessToken: "TOKEN", baseUrl: instagramBaseUrl() });
  });

  it("sem linha devolve null", async () => {
    const { admin } = fakeAdmin({ result: { data: null, error: null } });
    expect(await resolveInstagramCredentials(admin, LOOKUP)).toBeNull();
  });

  it("filtra organization_id, instagram_account_id e archived_at", async () => {
    const { admin, calls } = fakeAdmin({ result: { data: ROW, error: null }, decrypted: "T" });
    await resolveInstagramCredentials(admin, LOOKUP);
    expect(calls).toContainEqual(["eq", "organization_id", "org-1"]);
    expect(calls).toContainEqual(["eq", "instagram_account_id", "1784"]);
    expect(calls).toContainEqual(["is", "archived_at", null]);
  });

  it("erro do banco LANÇA, não decifra e NÃO cai em env", async () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "GLOBAL");
    vi.stubEnv("INSTAGRAM_ACCOUNT_ID", "1784");
    const { admin, rpc } = fakeAdmin({
      result: { data: null, error: { code: "PGRST116", message: "duas linhas" } },
    });
    await expect(resolveInstagramCredentials(admin, LOOKUP)).rejects.toThrow(
      /instagram_creds_lookup_failed: PGRST116/,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("canal arquivado: a consulta aplica o recorte e o resultado vazio dá null", async () => {
    const { admin, calls, rpc } = fakeAdmin({ result: { data: null, error: null } });
    expect(await resolveInstagramCredentials(admin, LOOKUP)).toBeNull();
    expect(calls).toContainEqual(["is", "archived_at", null]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("token ausente, decifra que falha ou token vazio dão null", async () => {
    const semToken = fakeAdmin({
      result: { data: { ...ROW, instagram_token_encrypted: null }, error: null },
    });
    expect(await resolveInstagramCredentials(semToken.admin, LOOKUP)).toBeNull();
    const falha = fakeAdmin({ result: { data: ROW, error: null }, decrypted: null });
    expect(await resolveInstagramCredentials(falha.admin, LOOKUP)).toBeNull();
    const vazio = fakeAdmin({ result: { data: ROW, error: null }, decrypted: "   " });
    expect(await resolveInstagramCredentials(vazio.admin, LOOKUP)).toBeNull();
  });

  it("organizationId ou accountId vazio dá null sem consultar", async () => {
    const { admin } = fakeAdmin({ result: { data: ROW, error: null }, decrypted: "T" });
    expect(await resolveInstagramCredentials(admin, { organizationId: "", accountId: "1" })).toBeNull();
    expect(await resolveInstagramCredentials(admin, { organizationId: "o", accountId: "" })).toBeNull();
  });
});

describe("instagramBaseUrl", () => {
  it("por padrão usa graph.facebook.com com a versão única da Graph", () => {
    vi.stubEnv("INSTAGRAM_GRAPH_BASE_URL", "");
    expect(instagramBaseUrl()).toBe(`https://graph.facebook.com/${graphVersion()}`);
  });

  it("override explícito vale, com trim", () => {
    vi.stubEnv("INSTAGRAM_GRAPH_BASE_URL", "  http://localhost:9999/x  ");
    expect(instagramBaseUrl()).toBe("http://localhost:9999/x");
  });

  it("override só com espaço cai no padrão", () => {
    vi.stubEnv("INSTAGRAM_GRAPH_BASE_URL", "   ");
    expect(instagramBaseUrl()).toBe(`https://graph.facebook.com/${graphVersion()}`);
  });
});
