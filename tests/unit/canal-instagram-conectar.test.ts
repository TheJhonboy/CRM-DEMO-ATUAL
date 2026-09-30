/**
 * CONECTAR O INSTAGRAM — validar na Graph ANTES de gravar, e nunca devolver segredo.
 *
 * ─── O que estes casos existem para impedir ─────────────────────────────────
 *
 * 1. Canal "conectado" que nunca recebe: a ingestão descarta (em silêncio) o evento
 *    cuja `entry.id` difere da conta gravada. Por isso a rota grava o id que a GRAPH
 *    devolve e recusa o digitado que não bate.
 * 2. Segredo em resposta: o token e o segredo do app entram pelo corpo e NUNCA voltam
 *    — a asserção é sobre a STRING inteira da resposta, não sobre campos escolhidos.
 * 3. Gravar primeiro, descobrir depois: token recusado ⇒ nenhuma linha escrita.
 * 4. Vazamento entre organizações: o escopo vem da sessão, nunca do corpo.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://crm.exemplo" } }));

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { connectInstagram, estadoDoInstagram } from "@/lib/channels/connect";
import { GET, POST } from "@/app/api/v1/channels/instagram/route";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONTA = "17841400000000001";
const TOKEN = "EAAB_token_secreto_de_teste_0123456789";
const SEGREDO = "segredo_do_app_meta_0123456789";

type Linha = Record<string, unknown>;
let linhas: Linha[] = [];
let escritas = 0;
let seq = 0;

/** Banco em memória: só o que a conexão usa, com `organization_id` de verdade no filtro. */
function bancoFalso(
  opts: { cifraOk?: boolean; erroNaConsulta?: boolean; decifraFalha?: boolean } = {},
) {
  const cifraOk = opts.cifraOk ?? true;
  const builder = (filtros: Array<[string, unknown]> = []) => {
    const api = {
      eq: (c: string, v: unknown) => builder([...filtros, [c, v]]),
      is: (c: string, v: unknown) => builder([...filtros, [c, v]]),
      maybeSingle: async () => {
        const achadas = linhas.filter((l) =>
          filtros.every(([c, v]) => (v === null ? l[c] == null : l[c] === v)),
        );
        if (opts.erroNaConsulta) {
          return { data: null, error: { code: "57014", message: "statement timeout" } };
        }
        return { data: achadas[0] ?? null, error: null };
      },
    };
    return api;
  };
  return {
    rpc: async (nome: string, args: Record<string, string>) => {
      if (nome === "fn_encrypt_oauth") {
        return cifraOk
          ? { data: `\\x${Buffer.from(`ENC:${args.plaintext}`).toString("hex")}`, error: null }
          : { data: null, error: { message: "sem chave" } };
      }
      if (nome === "fn_decrypt_oauth") {
        if (opts.decifraFalha) return { data: null, error: { message: "sem chave" } };
        const hex = args.ciphertext!.replace(/^\\x/, "");
        return { data: Buffer.from(hex, "hex").toString().replace(/^ENC:/, ""), error: null };
      }
      return { data: null, error: { message: "rpc desconhecida" } };
    },
    from: (tabela: string) => {
      expect(tabela).toBe("channel_sessions");
      return {
        select: () => builder(),
        insert: async (l: Linha) => {
          escritas++;
          linhas.push({ id: `sess-${++seq}`, ...l });
          return { error: null };
        },
        update: (l: Linha) => ({
          eq: async (_c: string, id: string) => {
            escritas++;
            const alvo = linhas.find((x) => x.id === id);
            if (alvo) Object.assign(alvo, l);
            return { error: null };
          },
        }),
      };
    },
  };
}

/** A Graph de mentira: responde por token. */
function graphFalsa(
  resposta: (token: string, url: string) => { status?: number; body: unknown } | "rede",
): ReturnType<typeof vi.fn> {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
    const r = resposta(auth.replace("Bearer ", ""), String(url));
    if (r === "rede") throw new Error("ECONNRESET");
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const graphBoa = () =>
  graphFalsa((_t, url) =>
    url.includes("/subscribed_apps")
      ? { body: { success: true } }
      : { body: { user_id: CONTA, username: "loja_da_ana" } },
  );

function pedido(corpo: unknown, metodo = "POST"): NextRequest {
  return new NextRequest("https://crm.exemplo/api/v1/channels/instagram", {
    method: metodo,
    ...(metodo === "GET" ? {} : { body: JSON.stringify(corpo) }),
  });
}

const corpoValido = { accountId: CONTA, accessToken: TOKEN, appSecret: SEGREDO };

function comoOrg(orgId: string | "negado") {
  if (orgId === "negado") {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: "forbidden" } }), { status: 403 }),
    } as never);
    return;
  }
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "u1", idioma: "pt-BR" } as never,
    org: { orgId } as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  linhas = [];
  escritas = 0;
  seq = 0;
  vi.mocked(createAdminClient).mockImplementation(() => bancoFalso() as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  comoOrg(ORG_A);
});
afterEach(() => vi.unstubAllGlobals());

describe("POST — autorização e corpo", () => {
  it("quem não pode configurar canal recebe 403 e nada é chamado nem gravado", async () => {
    comoOrg("negado");
    const f = graphBoa();
    const r = await POST(pedido(corpoValido));
    expect(r.status).toBe(403);
    expect(f).not.toHaveBeenCalled();
    expect(escritas).toBe(0);
  });

  it.each([
    ["accountId com letras", { ...corpoValido, accountId: "abc12345" }],
    ["accountId curto demais", { ...corpoValido, accountId: "1234" }],
    ["accountId longo demais", { ...corpoValido, accountId: "1".repeat(33) }],
    ["token curto demais", { ...corpoValido, accessToken: "curto" }],
    ["token longo demais", { ...corpoValido, accessToken: "x".repeat(601) }],
    ["segredo curto demais", { ...corpoValido, appSecret: "curto" }],
    ["segredo longo demais", { ...corpoValido, appSecret: "x".repeat(201) }],
    ["nome longo demais", { ...corpoValido, displayName: "n".repeat(81) }],
    ["sem segredo", { accountId: CONTA, accessToken: TOKEN }],
  ])("Zod recusa: %s — 422, sem ida à Graph, sem gravar", async (_nome, corpo) => {
    const f = graphBoa();
    const r = await POST(pedido(corpo));
    expect(r.status).toBe(422);
    expect(f).not.toHaveBeenCalled();
    expect(escritas).toBe(0);
  });

  it("corpo que não é JSON vira 422, não 500", async () => {
    const req = new NextRequest("https://crm.exemplo/api/v1/channels/instagram", {
      method: "POST",
      body: "isto não é json",
    });
    expect((await POST(req)).status).toBe(422);
  });

  it("a organização vem da sessão: um organization_id no corpo é ignorado", async () => {
    graphBoa();
    const r = await POST(pedido({ ...corpoValido, organization_id: ORG_B }));
    expect(r.status).toBe(200);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.organization_id).toBe(ORG_A);
  });

  it("estourou o limite de tentativas: 429 e nada é chamado", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
    const f = graphBoa();
    const r = await POST(pedido(corpoValido));
    expect(r.status).toBe(429);
    expect(f).not.toHaveBeenCalled();
    expect(escritas).toBe(0);
  });
});

describe("POST — validação na Graph antes de gravar", () => {
  it("token recusado (190) ⇒ 422 e NENHUMA linha escrita", async () => {
    graphFalsa(() => ({ status: 400, body: { error: { code: 190, message: "Invalid OAuth" } } }));
    const r = await POST(pedido(corpoValido));
    expect(r.status).toBe(422);
    expect(escritas).toBe(0);
    expect(linhas).toHaveLength(0);
    // Erro não ecoa segredo.
    const texto = await r.text();
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain(SEGREDO);
  });

  it("id digitado diferente do que a Meta devolve ⇒ 422 claro e nada gravado", async () => {
    graphFalsa(() => ({ body: { user_id: "17841499999999999", username: "outra" } }));
    const r = await POST(pedido(corpoValido));
    expect(r.status).toBe(422);
    expect(escritas).toBe(0);
    expect(JSON.stringify(await r.json())).toMatch(/ID informado/);
  });

  it("Meta fora do ar ⇒ 502, nada gravado (não é 'token inválido')", async () => {
    graphFalsa(() => ({ status: 503, body: {} }));
    const r = await POST(pedido(corpoValido));
    expect(r.status).toBe(502);
    expect(escritas).toBe(0);
  });

  it("rede caída ⇒ 502, nada gravado", async () => {
    graphFalsa(() => "rede");
    const r = await POST(pedido(corpoValido));
    expect(r.status).toBe(502);
    expect(escritas).toBe(0);
  });

  it("cifra indisponível ⇒ 422 e nada gravado em claro", async () => {
    graphBoa();
    vi.mocked(createAdminClient).mockImplementation(
      () => bancoFalso({ cifraOk: false }) as never,
    );
    const r = await POST(pedido(corpoValido));
    expect(r.status).toBe(422);
    expect(escritas).toBe(0);
  });
});

describe("POST — validação: id do /me e mensagens fixas", () => {
  const corpoMe = (url: string, me: Record<string, unknown>) =>
    url.includes("subscribed_apps") ? { body: { success: true } } : { body: me };

  it("a Graph devolve `id` em vez de `user_id`: usa o id (compatibilidade)", async () => {
    graphFalsa((_t, url) => corpoMe(url, { id: CONTA, username: "x" }));
    expect((await POST(pedido(corpoValido))).status).toBe(200);
    expect(linhas[0]!.instagram_account_id).toBe(CONTA);
  });

  it("user_id numerico tambem serve (String)", async () => {
    graphFalsa((_t, url) => corpoMe(url, { user_id: Number(CONTA), username: "x" }));
    const r = await connectInstagram(bancoFalso() as never, {
      organizationId: ORG_A,
      ...corpoValido,
      accountId: "17841400000000001",
    });
    // 17841400000000001 perde precisao como number: o id nao bate e nada e gravado
    expect(r.ok).toBe(false);
    graphFalsa((_t, url) => corpoMe(url, { user_id: 1784140000, username: "x" }));
    const ok = await connectInstagram(bancoFalso() as never, {
      organizationId: ORG_A,
      ...corpoValido,
      accountId: "1784140000",
    });
    expect(ok.ok).toBe(true);
  });

  it("user_id vence id quando a Graph manda os dois", async () => {
    graphFalsa((_t, url) => corpoMe(url, { id: "999999999", user_id: CONTA }));
    expect((await POST(pedido(corpoValido))).status).toBe(200);
    expect(linhas[0]!.instagram_account_id).toBe(CONTA);
  });

  it("Meta 5xx: razao FIXA (sem o status interpolado), status em campo separado", async () => {
    graphFalsa(() => ({ status: 503, body: {} }));
    const r = await POST(pedido(corpoValido));
    const j = await r.json();
    expect(r.status).toBe(502);
    expect(j.error.message).not.toMatch(/503/);
    expect(j.error.details).toEqual({ meta_status: 503 });
  });

  it("falha na consulta da sessao existente: kind banco, nada gravado (nao insere linha duplicada)", async () => {
    graphBoa();
    const r = await connectInstagram(bancoFalso({ erroNaConsulta: true }) as never, {
      organizationId: ORG_A,
      ...corpoValido,
    });
    expect(r).toMatchObject({ ok: false, kind: "banco" });
    expect(escritas).toBe(0);
  });
});

describe("POST — assinatura do webhook (best-effort)", () => {
  it("assina messages e messaging_seen em /me/subscribed_apps, com o token no cabecalho", async () => {
    const f = graphBoa();
    const r = await POST(pedido(corpoValido));
    const { data } = await r.json();
    expect(data.webhookSubscribed).toBe(true);
    const [url, init] = f.mock.calls[1]! as [string, RequestInit];
    expect(url).toContain("/me/subscribed_apps?subscribed_fields=messages,messaging_seen");
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("so roda depois da validacao: token recusado nao assina", async () => {
    const f = graphFalsa(() => ({ status: 400, body: { error: { code: 190 } } }));
    await POST(pedido(corpoValido));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a Meta recusa", (u: string) => (u.includes("subscribed_apps") ? { status: 400, body: { error: { code: 100 } } } : null)],
    ["success false", (u: string) => (u.includes("subscribed_apps") ? { body: { success: false } } : null)],
    ["a rede cai", (u: string) => (u.includes("subscribed_apps") ? ("rede" as const) : null)],
  ])("%s: conecta mesmo assim, webhookSubscribed=false, linha gravada", async (_n, falha) => {
    graphFalsa((_t, url) => falha(url) ?? { body: { user_id: CONTA, username: "loja" } });
    const r = await POST(pedido(corpoValido));
    expect(r.status).toBe(200);
    expect((await r.json()).data.webhookSubscribed).toBe(false);
    expect(linhas).toHaveLength(1);
  });

  it("a assinatura que trava tem teto de 5 s e nao impede a conexao", async () => {
    vi.useFakeTimers();
    const f = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("subscribed_apps")) {
        return new Promise((_ok, ko) => {
          init?.signal?.addEventListener("abort", () => ko(new DOMException("t", "TimeoutError")));
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ user_id: CONTA, username: "l" }), { status: 200 }));
    });
    vi.stubGlobal("fetch", f);
    const p = connectInstagram(bancoFalso() as never, { organizationId: ORG_A, ...corpoValido });
    await vi.advanceTimersByTimeAsync(5_100);
    const r = await p;
    vi.useRealTimers();
    expect(r).toMatchObject({ ok: true, webhookSubscribed: false });
  });
});

describe("POST — sucesso", () => {
  it("grava token e segredo CIFRADOS, com o id que a Graph devolveu", async () => {
    const f = graphBoa();
    const r = await POST(pedido(corpoValido));
    expect(r.status).toBe(200);

    // Uma ida à Graph, no endpoint certo, com o token no cabeçalho (nunca na URL).
    expect(f).toHaveBeenCalledTimes(2); // /me e subscribed_apps
    const url = String(f.mock.calls[0]![0]);
    expect(url).toContain("/me?fields=user_id,username");
    expect(url).not.toContain(TOKEN);

    expect(linhas).toHaveLength(1);
    const l = linhas[0]!;
    expect(l.provider).toBe("instagram");
    expect(l.instagram_account_id).toBe(CONTA);
    expect(l.organization_id).toBe(ORG_A);
    expect(l.instagram_token_encrypted).toBeTruthy();
    expect(l.webhook_secret_encrypted).toBeTruthy();
    // Cifrado de verdade: o valor gravado não contém o texto em claro.
    expect(String(l.instagram_token_encrypted)).not.toContain(TOKEN);
    expect(JSON.stringify(l)).not.toContain(SEGREDO);
    expect(l.archived_at).toBeNull();
  });

  it("a resposta NÃO contém o token nem o segredo (asserção sobre a string inteira)", async () => {
    graphBoa();
    const r = await POST(pedido(corpoValido));
    const texto = await r.text();
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain(SEGREDO);
    expect(texto).not.toMatch(/access_?token|app_?secret/i);
  });

  it("devolve webhookUrl, verifyToken, username e status", async () => {
    graphBoa();
    const r = await POST(pedido(corpoValido));
    const { data } = await r.json();
    expect(Object.keys(data).sort()).toEqual(["status", "username", "verifyToken", "webhookSubscribed", "webhookUrl"]);
    expect(data.username).toBe("loja_da_ana");
    expect(data.status).toBe("WORKING");
    expect(data.verifyToken).toBe(linhas[0]!.webhook_path_token);
    expect(data.webhookUrl).toBe(`https://crm.exemplo/api/v1/webhooks/channel/${data.verifyToken}`);
  });

  it("reconectar preserva o token do webhook (já colado na Meta) e não duplica a linha", async () => {
    graphBoa();
    const primeira = await (await POST(pedido(corpoValido))).json();
    const segunda = await (await POST(pedido(corpoValido))).json();
    expect(linhas).toHaveLength(1);
    expect(segunda.data.verifyToken).toBe(primeira.data.verifyToken);
  });
});

describe("duas organizações não se enxergam", () => {
  it("cada uma grava a SUA linha, com token de webhook próprio, e o GET de uma não vê a outra", async () => {
    graphBoa();
    comoOrg(ORG_A);
    const a = await (await POST(pedido(corpoValido))).json();

    // A organização B ainda não conectou: não herda nada da A, mesmo com a mesma conta.
    comoOrg(ORG_B);
    const antes = await (await GET(pedido(null, "GET"))).json();
    expect(antes.data.state).toBe("nao_conectado");
    expect(JSON.stringify(antes)).not.toContain(a.data.verifyToken);

    const b = await (await POST(pedido(corpoValido))).json();
    expect(linhas).toHaveLength(2);
    expect(b.data.verifyToken).not.toBe(a.data.verifyToken);
    expect(linhas.map((l) => l.organization_id).sort()).toEqual([ORG_A, ORG_B]);

    comoOrg(ORG_A);
    const deA = await (await GET(pedido(null, "GET"))).json();
    expect(deA.data.verifyToken).toBe(a.data.verifyToken);
    expect(JSON.stringify(deA)).not.toContain(b.data.verifyToken);
  });
});

describe("GET — estado", () => {
  it("sem conexão: nao_conectado, sem ir à Graph, sem URL inventada", async () => {
    const f = graphBoa();
    const r = await GET(pedido(null, "GET"));
    const { data } = await r.json();
    expect(data.state).toBe("nao_conectado");
    expect(data.webhookUrl).toBeNull();
    expect(data.verifyToken).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("conectado e com a Meta respondendo bem: conectado + URL + verify token; sem segredo", async () => {
    graphBoa();
    await POST(pedido(corpoValido));
    const r = await GET(pedido(null, "GET"));
    const texto = await r.text();
    const { data } = JSON.parse(texto);
    expect(data.state).toBe("conectado");
    expect(data.health).toBe("ok");
    expect(data.webhookUrl).toContain("/api/v1/webhooks/channel/");
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain(SEGREDO);
  });

  it("token revogado depois de conectar: token_invalido (não finge saúde)", async () => {
    graphBoa();
    await POST(pedido(corpoValido));
    graphFalsa(() => ({ status: 400, body: { error: { code: 190 } } }));
    const { data } = await (await GET(pedido(null, "GET"))).json();
    expect(data.state).toBe("token_invalido");
  });

  it("quem não pode configurar canal recebe 403", async () => {
    comoOrg("negado");
    expect((await GET(pedido(null, "GET"))).status).toBe(403);
  });

  it("credencial que nao decifra (sem_credencial_para_a_sessao): token_invalido, nao 'Meta nao respondeu'", async () => {
    graphBoa();
    await POST(pedido(corpoValido));
    vi.mocked(createAdminClient).mockImplementation(() => bancoFalso({ decifraFalha: true }) as never);
    const { data } = await (await GET(pedido(null, "GET"))).json();
    expect(data.state).toBe("token_invalido");
  });

  it("banco falhando ao ler a credencial (credenciais_indisponiveis): saude propria, nao 'Meta nao respondeu'", async () => {
    graphBoa();
    const admin = bancoFalso() as never;
    await connectInstagram(admin, { organizationId: ORG_A, ...corpoValido });
    // o adapter abre o seu proprio cliente: e esse que falha
    vi.mocked(createAdminClient).mockImplementation(() => bancoFalso({ erroNaConsulta: true }) as never);
    const r = await estadoDoInstagram(admin, ORG_A);
    expect(r.estado).toBe("conectado");
    expect(r.saude).toBe("credencial_indisponivel");
  });

  it("consulta da sessao falha: o estado lanca (nao finge 'nao conectado')", async () => {
    await expect(estadoDoInstagram(bancoFalso({ erroNaConsulta: true }) as never, ORG_A)).rejects.toThrow();
  });
});

describe("connectInstagram / estadoDoInstagram (a camada de baixo)", () => {
  it("a Graph que não responde em 5 s não trava a tela: conectado com saúde 'sem_resposta'", async () => {
    graphBoa();
    const admin = bancoFalso() as never;
    await connectInstagram(admin, { organizationId: ORG_A, ...corpoValido });
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    const p = estadoDoInstagram(admin, ORG_A);
    await vi.advanceTimersByTimeAsync(5_001);
    const r = await p;
    vi.useRealTimers();
    expect(r.estado).toBe("conectado");
    expect(r.saude).toBe("sem_resposta");
  });

  it("linha arquivada conta como não conectado", async () => {
    graphBoa();
    const admin = bancoFalso() as never;
    await connectInstagram(admin, { organizationId: ORG_A, ...corpoValido });
    linhas[0]!.archived_at = "2026-01-01T00:00:00Z";
    expect((await estadoDoInstagram(admin, ORG_A)).estado).toBe("nao_conectado");
  });
});
