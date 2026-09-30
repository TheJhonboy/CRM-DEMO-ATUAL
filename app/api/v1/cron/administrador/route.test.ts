/**
 * A rota do administrador nasce DESLIGADA e só processa organização que optou:
 * sem a flag mestra, autentica e não toca em banco; com a flag, percorre TODAS as
 * organizações elegíveis (ativas + opt-in), em páginas de 200, dentro do
 * orçamento de tempo, começando por uma página que gira a cada 15 min.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const envMock = vi.hoisted(() => ({ INTERNAL_SECRET: "segredo", INTERNAL_CRON_SECRET: "", ADMIN_AGENT_ENABLED: false }));
vi.mock("@/lib/env", () => ({ env: envMock }));
const criarAdmin = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => criarAdmin() }));
const executar = vi.fn();
vi.mock("@/lib/agent-engine/cron/administrador", () => ({
  executarAdministrador: (...a: unknown[]) => executar(...a),
}));
const logInfo = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", () => ({ logger: { info: logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { GET, LIMITE_POR_ORGANIZACAO, ORCAMENTO_MS, TAMANHO_DA_PAGINA, SLOT_MS } from "./route";

const req = (segredo?: string) =>
  new NextRequest("http://localhost/api/v1/cron/administrador", {
    headers: segredo ? { authorization: `Bearer ${segredo}` } : {},
  });

type Org = {
  id: string;
  status: string;
  suspended_at: string | null;
  redacted_at: string | null;
  settings: Record<string, unknown>;
};
const org = (n: number, o: Partial<Org> = {}): Org => ({
  id: `org-${String(n).padStart(5, "0")}`,
  status: "active",
  suspended_at: null,
  redacted_at: null,
  settings: { administrador_ativo: true },
  ...o,
});

/** Dublê de `organizations`: aplica eq/is/order/range como o PostgREST, e registra as consultas. */
function bancoDeOrganizacoes(linhas: Org[]) {
  const consultas: Array<{ filtros: Array<[string, string, unknown]>; range?: [number, number]; order?: string; count?: boolean }> = [];
  const from = (tabela: string) => {
    expect(tabela).toBe("organizations");
    const registro: (typeof consultas)[number] = { filtros: [] };
    consultas.push(registro);
    const fs: Array<(o: Org) => boolean> = [];
    let head = false;
    const b: Record<string, unknown> = {
      select: (_c: string, opts?: { count?: string; head?: boolean }) => {
        head = !!opts?.head;
        registro.count = !!opts?.count;
        return b;
      },
      eq: (c: string, v: unknown) => {
        registro.filtros.push(["eq", c, v]);
        fs.push((o) =>
          c === "settings->>administrador_ativo"
            ? String(o.settings.administrador_ativo) === v
            : (o as Record<string, unknown>)[c] === v,
        );
        return b;
      },
      is: (c: string, v: unknown) => {
        registro.filtros.push(["is", c, v]);
        fs.push((o) => ((o as Record<string, unknown>)[c] ?? null) === v);
        return b;
      },
      order: (c: string) => ((registro.order = c), b),
      range: (de: number, ate: number) => ((registro.range = [de, ate]), b),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        const alvo = linhas.filter((o) => fs.every((f) => f(o))).sort((x, y) => x.id.localeCompare(y.id));
        const r = head
          ? { data: null, count: alvo.length, error: null }
          : { data: (registro.range ? alvo.slice(registro.range[0], registro.range[1] + 1) : alvo).map((o) => ({ id: o.id })), error: null };
        return Promise.resolve(r).then(res, rej);
      },
    };
    return b;
  };
  return { client: { from }, consultas };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
  envMock.ADMIN_AGENT_ENABLED = false;
  criarAdmin.mockReset();
  executar.mockReset();
  logInfo.mockReset();
  executar.mockResolvedValue({ executadas: 1, falhas: 0 });
});
afterEach(() => vi.useRealTimers());

describe("/api/v1/cron/administrador", () => {
  it("sem segredo ou com segredo errado (mesmo tamanho): 403", async () => {
    expect((await GET(req())).status).toBe(403);
    expect((await GET(req("segredx"))).status).toBe(403);
  });

  it("desligado por padrão: não lê banco nem executa nada", async () => {
    const res = await GET(req("segredo"));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain("desligado");
    expect(criarAdmin).not.toHaveBeenCalled();
    expect(executar).not.toHaveBeenCalled();
  });

  it("ligado: só organização ativa, não suspensa, não redigida e com opt-in; o filtro vai no SQL", async () => {
    envMock.ADMIN_AGENT_ENABLED = true;
    const db = bancoDeOrganizacoes([
      org(1),
      org(2, { settings: {} }), // nunca optou
      org(3, { settings: { administrador_ativo: false } }),
      org(4, { suspended_at: "2026-09-01T00:00:00Z" }),
      org(5, { redacted_at: "2026-09-01T00:00:00Z" }),
      org(6, { status: "suspended" }),
      org(7, { status: "archived" }),
      org(8),
    ]);
    criarAdmin.mockReturnValue(db.client);
    const res = await GET(req("segredo"));
    expect(res.status).toBe(200);
    expect(executar.mock.calls.map((c) => (c[1] as { organizationId: string }).organizationId)).toEqual(["org-00001", "org-00008"]);
    expect(executar.mock.calls[0]![1]).toMatchObject({ organizationId: "org-00001", limite: LIMITE_POR_ORGANIZACAO });
    const pagina = db.consultas.find((c) => c.range)!;
    expect(pagina.order).toBe("id");
    expect(pagina.filtros).toEqual(
      expect.arrayContaining([
        ["eq", "status", "active"],
        ["is", "suspended_at", null],
        ["is", "redacted_at", null],
        ["eq", "settings->>administrador_ativo", "true"],
      ]),
    );
  });

  it("uma organização que falha não para as outras", async () => {
    envMock.ADMIN_AGENT_ENABLED = true;
    criarAdmin.mockReturnValue(bancoDeOrganizacoes([org(1), org(2)]).client);
    executar.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ executadas: 2, falhas: 0 });
    const res = await GET(req("segredo"));
    expect(res.status).toBe(200);
    expect(executar).toHaveBeenCalledTimes(2);
  });

  it("percorre TODAS as elegíveis em páginas de 200 (450 organizações)", async () => {
    envMock.ADMIN_AGENT_ENABLED = true;
    const db = bancoDeOrganizacoes(Array.from({ length: 450 }, (_, i) => org(i + 1)));
    criarAdmin.mockReturnValue(db.client);
    const res = await GET(req("segredo"));
    const corpo = (await res.json()) as { data: { organizacoes: number; paginas: number } };
    expect(TAMANHO_DA_PAGINA).toBe(200);
    expect(executar).toHaveBeenCalledTimes(450);
    expect(new Set(executar.mock.calls.map((c) => (c[1] as { organizationId: string }).organizationId)).size).toBe(450);
    expect(corpo.data.organizacoes).toBe(450);
    expect(corpo.data.paginas).toBe(3);
  });

  it("a página inicial gira com o intervalo de 15 min (slot % páginas)", async () => {
    envMock.ADMIN_AGENT_ENABLED = true;
    const linhas = Array.from({ length: 450 }, (_, i) => org(i + 1));
    const primeiras: string[] = [];
    for (const slot of [0, 1, 2, 3]) {
      vi.setSystemTime(new Date(slot * SLOT_MS));
      executar.mockReset();
      executar.mockResolvedValue({ executadas: 0, falhas: 0 });
      criarAdmin.mockReturnValue(bancoDeOrganizacoes(linhas).client);
      await GET(req("segredo"));
      primeiras.push((executar.mock.calls[0]![1] as { organizationId: string }).organizationId);
    }
    // 3 páginas: slot 0 -> página 0 (org 1), slot 1 -> 200 (org 201), slot 2 -> 400 (org 401), slot 3 -> volta
    expect(primeiras).toEqual(["org-00001", "org-00201", "org-00401", "org-00001"]);
  });

  it("orçamento quase esgotado: pára limpo, registra contagens e deixa o resto para a próxima rodada", async () => {
    envMock.ADMIN_AGENT_ENABLED = true;
    criarAdmin.mockReturnValue(bancoDeOrganizacoes(Array.from({ length: 450 }, (_, i) => org(i + 1))).client);
    // cada organização "gasta" 1 s => passa do orçamento antes de terminar
    executar.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 1000);
      return { executadas: 1, falhas: 0 };
    });
    const res = await GET(req("segredo"));
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { data: { organizacoes: number; interrompidoPorTempo: boolean; elegiveis: number } };
    expect(corpo.data.interrompidoPorTempo).toBe(true);
    expect(corpo.data.elegiveis).toBe(450);
    expect(corpo.data.organizacoes).toBeLessThan(450);
    expect(corpo.data.organizacoes * 1000).toBeLessThanOrEqual(ORCAMENTO_MS);
    expect(logInfo).toHaveBeenCalledWith(
      expect.stringContaining("administrador"),
      expect.objectContaining({ interrompidoPorTempo: true, elegiveis: 450 }),
    );
  });
  it("A4: passa o prazo da rodada ao administrador e pára de avançar quando ele avisa que estourou", async () => {
    envMock.ADMIN_AGENT_ENABLED = true;
    criarAdmin.mockReturnValue(bancoDeOrganizacoes([org(1), org(2), org(3)]).client);
    const inicio = Date.now();
    executar.mockResolvedValueOnce({ executadas: 1, falhas: 0 }).mockResolvedValueOnce({ executadas: 0, falhas: 0, interrompidoPorTempo: true });
    const res = await GET(req("segredo"));
    const corpo = (await res.json()) as { data: { interrompidoPorTempo: boolean; organizacoes: number } };
    expect(executar).toHaveBeenCalledTimes(2);
    expect((executar.mock.calls[0]![1] as { prazo: number }).prazo).toBe(inicio + ORCAMENTO_MS - 10_000);
    expect(corpo.data.interrompidoPorTempo).toBe(true);
    expect(corpo.data.organizacoes).toBe(2);
  });
});
