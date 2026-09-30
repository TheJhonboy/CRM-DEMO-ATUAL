/**
 * A rota do administrador nasce DESLIGADA: sem a flag, autentica e não toca em
 * banco. Com a flag, roda por organização lida da tabela, com o teto fixo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const envMock = vi.hoisted(() => ({ INTERNAL_SECRET: "segredo", INTERNAL_CRON_SECRET: "", ADMIN_AGENT_ENABLED: false }));
vi.mock("@/lib/env", () => ({ env: envMock }));
const criarAdmin = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => criarAdmin() }));
const executar = vi.fn();
vi.mock("@/lib/agent-engine/cron/administrador", () => ({
  executarAdministrador: (...a: unknown[]) => executar(...a),
}));

import { GET, LIMITE_POR_ORGANIZACAO } from "./route";

const req = (segredo?: string) =>
  new NextRequest("http://localhost/api/v1/cron/administrador", {
    headers: segredo ? { authorization: `Bearer ${segredo}` } : {},
  });

beforeEach(() => {
  envMock.ADMIN_AGENT_ENABLED = false;
  criarAdmin.mockReset();
  executar.mockReset();
});

describe("/api/v1/cron/administrador", () => {
  it("sem segredo: 403", async () => {
    expect((await GET(req())).status).toBe(403);
  });

  it("desligado por padrão: não lê banco nem executa nada", async () => {
    const res = await GET(req("segredo"));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain("desligado");
    expect(criarAdmin).not.toHaveBeenCalled();
    expect(executar).not.toHaveBeenCalled();
  });

  it("ligado: executa por organização da tabela, com o teto, e segue se uma falhar", async () => {
    envMock.ADMIN_AGENT_ENABLED = true;
    criarAdmin.mockReturnValue({
      from: () => ({ select: () => ({ limit: async () => ({ data: [{ id: "org-1" }, { id: "org-2" }], error: null }) }) }),
    });
    executar
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ executadas: 2, falhas: 0 });
    const res = await GET(req("segredo"));
    expect(res.status).toBe(200);
    expect(executar).toHaveBeenCalledTimes(2);
    expect(executar.mock.calls[1]![1]).toEqual({ organizationId: "org-2", limite: LIMITE_POR_ORGANIZACAO });
  });
});
