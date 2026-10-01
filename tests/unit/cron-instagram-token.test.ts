/**
 * Cron diário de renovação do token do Instagram.
 * Banco falso encadeável + renovarTokenDaSessao mockado (o ciclo da Meta já é
 * coberto em canal-instagram-token.test.ts).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/channels/instagram/token", async (orig) => ({
  ...(await orig<typeof import("@/lib/channels/instagram/token")>()),
  renovarTokenDaSessao: vi.fn(),
}));
vi.mock("@/lib/auth/cron-auth", () => ({ autorizaCron: vi.fn(() => true) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { autorizaCron } from "@/lib/auth/cron-auth";
import { renovarTokenDaSessao } from "@/lib/channels/instagram/token";
import { renovarTokensDoInstagram } from "@/lib/channels/instagram/renovar-todos";
import { createAdminClient } from "@/lib/supabase/admin";
import { GET, POST } from "@/app/api/v1/cron/instagram-token/route";

const req = (m: string) => new NextRequest("https://crm.exemplo/api/v1/cron/instagram-token", { method: m });
const AGORA = Date.parse("2026-10-01T12:00:00Z");
const dias = (n: number) => new Date(AGORA + n * 86_400_000).toISOString();

type Sess = { id: string; organization_id: string; instagram_token_expires_at: string | null };
interface Estado {
  sessoes: Sess[];
  itens: Array<Record<string, unknown>>;
  filtros: Array<[string, ...unknown[]]>;
  erroNaConsulta?: boolean | { code: string; message: string };
  falhaPorId?: Set<string>;
}

function bancoFalso(e: Estado) {
  return {
    from: (tabela: string) => {
      if (tabela === "channel_sessions") {
        let gt = "";
        let limite = 1000;
        const q: Record<string, unknown> = {
          select: () => q,
          eq: (c: string, v: unknown) => (e.filtros.push(["eq", c, v]), q),
          is: (c: string, v: unknown) => (e.filtros.push(["is", c, v]), q),
          not: (c: string, op: string, v: unknown) => (e.filtros.push(["not", c, op, v]), q),
          or: (s: string) => (e.filtros.push(["or", s]), q),
          order: () => q,
          gt: (_c: string, v: string) => ((gt = v), q),
          limit: (n: number) => ((limite = n), q),
          then: (res: (v: unknown) => unknown) =>
            Promise.resolve(
              e.erroNaConsulta
                ? { data: null, error: typeof e.erroNaConsulta === "object" ? e.erroNaConsulta : { message: "boom" } }
                : { data: e.sessoes.filter((s) => s.id > gt).slice(0, limite), error: null },
            ).then(res),
        };
        return q;
      }
      // agent_inbox_items
      const f: Array<(it: Record<string, unknown>) => boolean> = [];
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => (f.push((it) => it[c] === v), q),
        in: (c: string, vs: unknown[]) => (f.push((it) => vs.includes(it[c])), q),
        limit: () => q,
        insert: async (l: Record<string, unknown>) => {
          e.itens.push({ status: "open", ...l });
          return { error: null };
        },
        update: (valores: Record<string, unknown>) => {
          const g: Array<(it: Record<string, unknown>) => boolean> = [];
          const u: Record<string, unknown> = {
            eq: (c: string, v: unknown) => (g.push((it) => it[c] === v), u),
            in: (c: string, vs: unknown[]) => (g.push((it) => vs.includes(it[c])), u),
            then: (res: (v: unknown) => unknown) => {
              for (const it of e.itens) if (g.every((fn) => fn(it))) Object.assign(it, valores);
              return Promise.resolve({ error: null }).then(res);
            },
          };
          return u;
        },
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: e.itens.filter((it) => f.every((fn) => fn(it))), error: null }).then(res),
      };
      return q;
    },
  } as never;
}

let estado: Estado;
beforeEach(() => {
  vi.clearAllMocks();
  estado = { sessoes: [], itens: [], filtros: [] };
  vi.mocked(createAdminClient).mockImplementation(() => bancoFalso(estado));
  vi.mocked(autorizaCron).mockReturnValue(true);
  vi.mocked(renovarTokenDaSessao).mockResolvedValue({ ok: true, tokenValidoAte: dias(60) });
});

describe("renovarTokensDoInstagram", () => {
  it("consulta só instagram ativo na janela de 10 dias (ou sem validade com mais de 1 dia de idade), não vencido", async () => {
    await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA });
    expect(estado.filtros).toContainEqual(["eq", "provider", "instagram"]);
    expect(estado.filtros).toContainEqual(["is", "archived_at", null]);
    expect(estado.filtros).toContainEqual(["not", "instagram_token_encrypted", "is", null]);
    const or = estado.filtros.find((f) => f[0] === "or")![1] as string;
    expect(or).toContain(`instagram_token_expires_at.gt.${dias(0)}`);
    expect(or).toContain(`instagram_token_expires_at.lte.${dias(10)}`);
    expect(or).toContain("instagram_token_expires_at.is.null");
    expect(or).toContain(`created_at.lt.${dias(-1)}`);
  });

  it("renova cada sessão com a organização da LINHA e conta os resultados", async () => {
    estado.sessoes = [
      { id: "s1", organization_id: "o1", instagram_token_expires_at: dias(5) },
      { id: "s2", organization_id: "o2", instagram_token_expires_at: null },
    ];
    const r = await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA });
    expect(renovarTokenDaSessao).toHaveBeenCalledWith(expect.anything(), { organizationId: "o1", sessionId: "s1" });
    expect(renovarTokenDaSessao).toHaveBeenCalledWith(expect.anything(), { organizationId: "o2", sessionId: "s2" });
    expect(r).toMatchObject({ candidatas: 2, renovadas: 2, falhas: 0, avisos: 0, interrompidoPorTempo: false });
  });

  it("uma sessão que lança não para as outras", async () => {
    estado.sessoes = [
      { id: "s1", organization_id: "o1", instagram_token_expires_at: dias(5) },
      { id: "s2", organization_id: "o2", instagram_token_expires_at: dias(5) },
    ];
    vi.mocked(renovarTokenDaSessao)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ok: true, tokenValidoAte: dias(60) });
    const r = await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA });
    expect(r).toMatchObject({ renovadas: 1, falhas: 1 });
  });

  it("falha com 7 dias ou menos abre UM aviso na Central (kind other, ref_kind próprio, org da linha); repetir não duplica", async () => {
    estado.sessoes = [{ id: "s1", organization_id: "o1", instagram_token_expires_at: dias(6) }];
    vi.mocked(renovarTokenDaSessao).mockResolvedValue({ ok: false, motivo: "rede" });
    const r1 = await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA });
    await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA });
    expect(estado.itens).toHaveLength(1);
    expect(estado.itens[0]).toMatchObject({
      organization_id: "o1",
      kind: "other",
      severity: "warn",
      ref_kind: "instagram_token",
      ref_id: "s1",
      status: "open",
    });
    expect(String(estado.itens[0]!.body)).toMatch(/Reconectar|Renovar/);
    expect(r1.avisos).toBe(1);
  });

  it("falha com mais de 7 dias não abre aviso", async () => {
    estado.sessoes = [{ id: "s1", organization_id: "o1", instagram_token_expires_at: dias(9) }];
    vi.mocked(renovarTokenDaSessao).mockResolvedValue({ ok: false, motivo: "rede" });
    await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA });
    expect(estado.itens).toHaveLength(0);
  });

  it("validade desconhecida que falha não abre aviso; token_expirado abre mesmo assim", async () => {
    estado.sessoes = [{ id: "s1", organization_id: "o1", instagram_token_expires_at: null }];
    vi.mocked(renovarTokenDaSessao).mockResolvedValue({ ok: false, motivo: "rede" });
    await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA });
    expect(estado.itens).toHaveLength(0);
    vi.mocked(renovarTokenDaSessao).mockResolvedValue({ ok: false, motivo: "token_expirado" });
    await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA });
    expect(estado.itens).toHaveLength(1);
    expect(estado.itens[0]!.severity).toBe("critical");
  });

  it("aviso aberto OU reconhecido (ack) conta para o dedupe: não abre outro", async () => {
    estado.sessoes = [{ id: "s1", organization_id: "o1", instagram_token_expires_at: dias(2) }];
    estado.itens = [{ organization_id: "o1", kind: "other", ref_kind: "instagram_token", ref_id: "s1", status: "ack", severity: "warn" }];
    vi.mocked(renovarTokenDaSessao).mockResolvedValue({ ok: false, motivo: "rede" });
    await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA });
    expect(estado.itens).toHaveLength(1);
  });

  it("token expirado ESCALA o aviso warn existente para critical, em vez de ser barrado", async () => {
    estado.sessoes = [{ id: "s1", organization_id: "o1", instagram_token_expires_at: dias(2) }];
    estado.itens = [{ organization_id: "o1", kind: "other", ref_kind: "instagram_token", ref_id: "s1", status: "open", severity: "warn", title: "x" }];
    vi.mocked(renovarTokenDaSessao).mockResolvedValue({ ok: false, motivo: "token_expirado" });
    await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA });
    expect(estado.itens).toHaveLength(1);
    expect(estado.itens[0]).toMatchObject({ severity: "critical" });
    expect(String(estado.itens[0]!.title)).toMatch(/expirou/);
  });

  it("validade desconhecida que falha todo dia gera no máximo UM aviso por sessão", async () => {
    estado.sessoes = [{ id: "s1", organization_id: "o1", instagram_token_expires_at: null }];
    vi.mocked(renovarTokenDaSessao).mockResolvedValue({ ok: false, motivo: "token_expirado" });
    for (let i = 0; i < 4; i++) await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA });
    expect(estado.itens).toHaveLength(1);
  });

  it("migration 0277 ausente: resumo vazio com migracaoPendente, sem lançar", async () => {
    estado.erroNaConsulta = { code: "42703", message: "column channel_sessions.instagram_token_expires_at does not exist" };
    const r = await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA });
    expect(r).toEqual({ candidatas: 0, renovadas: 0, falhas: 0, avisos: 0, interrompidoPorTempo: false, migracaoPendente: true });
    const resp = await POST(req("POST"));
    expect(resp.status).toBe(200);
    expect((await resp.json()).data.migracaoPendente).toBe(true);
  });

  it("a margem de segurança é de pelo menos 15 s (pára de iniciar em 75 s)", async () => {
    estado.sessoes = [{ id: "s1", organization_id: "o1", instagram_token_expires_at: dias(2) }];
    const relogio = vi.fn().mockReturnValueOnce(AGORA).mockReturnValue(AGORA + 76_000);
    const r = await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA, relogio });
    expect(r.interrompidoPorTempo).toBe(true);
  });

  it("renovação com sucesso resolve o aviso aberto da sessão", async () => {
    estado.sessoes = [{ id: "s1", organization_id: "o1", instagram_token_expires_at: dias(3) }];
    estado.itens = [{ organization_id: "o1", kind: "other", ref_kind: "instagram_token", ref_id: "s1", status: "open" }];
    await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA });
    expect(estado.itens[0]!.status).toBe("resolved");
    expect(typeof estado.itens[0]!.resolved_at).toBe("string");
  });

  it("pagina por id sem pular linhas e respeita o orçamento de tempo", async () => {
    estado.sessoes = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      organization_id: "o1",
      instagram_token_expires_at: dias(2),
    }));
    const r = await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA, tamanhoDaPagina: 2 });
    expect(r.candidatas).toBe(5);
    expect(renovarTokenDaSessao).toHaveBeenCalledTimes(5);

    vi.mocked(renovarTokenDaSessao).mockClear();
    const relogio = vi.fn().mockReturnValueOnce(AGORA).mockReturnValue(AGORA + 100_000);
    const r2 = await renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA, relogio });
    expect(r2.interrompidoPorTempo).toBe(true);
    expect(renovarTokenDaSessao).not.toHaveBeenCalled();
  });

  it("erro na consulta lança (a rota responde 500)", async () => {
    estado.erroNaConsulta = true;
    await expect(renovarTokensDoInstagram(bancoFalso(estado), { agora: AGORA })).rejects.toThrow(
      /instagram_token_cron_lookup_failed/,
    );
  });
});

describe("rota /api/v1/cron/instagram-token", () => {
  it("sem segredo de cron: 403 e não toca no banco", async () => {
    vi.mocked(autorizaCron).mockReturnValue(false);
    const r = await POST(req("POST"));
    expect(r.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it("sem sessões é inofensiva: 200 com resumo zerado (GET e POST)", async () => {
    for (const m of [GET, POST]) {
      const r = await m(req("GET"));
      expect(r.status).toBe(200);
      const { data } = await r.json();
      expect(data).toMatchObject({ candidatas: 0, renovadas: 0, falhas: 0 });
    }
  });
  it("erro de banco: 500 sem vazar a causa", async () => {
    estado.erroNaConsulta = true;
    const r = await POST(req("POST"));
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("boom");
  });
});
