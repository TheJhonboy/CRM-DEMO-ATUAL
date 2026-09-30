import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ingestão do Instagram: evento verificado → contato, conversa, mensagem.
 *
 * O dublê é um banco em memória com as constraints que importam (unique de
 * `external_id` por org, unique de `instagram_scoped_id` por org, coluna gerada).
 * Um dublê que só registra chamadas deixaria passar exatamente o que aqui vale:
 * o que FICOU gravado, e em qual organização.
 */

const pos = vi.hoisted(() => ({ entrada: vi.fn(async () => undefined), pausa: vi.fn(async () => true) }));
const log = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: log }));
vi.mock("@/lib/channels/pos-entrada", () => ({ aplicarEfeitosPosEntrada: pos.entrada }));
vi.mock("@/lib/escalacao/atendimento-manual", () => ({ pausarIaPorAtendimentoManual: pos.pausa }));

type Row = Record<string, unknown>;
const db = { contacts: [] as Row[], conversations: [] as Row[], messages: [] as Row[] };
const tabelaDe = (t: string): Row[] => (db as Record<string, Row[]>)[t] ?? [];
const rpcs: { nome: string; args: Record<string, unknown> }[] = [];
let seq = 0;

function gerada(tabela: string, row: Row): Row {
  if (tabela === "contacts") {
    const md = (row.source_metadata ?? {}) as Record<string, unknown>;
    row.instagram_scoped_id = typeof md.instagram_igsid === "string" ? md.instagram_igsid : null;
  }
  return row;
}

function violaUnico(tabela: string, row: Row): boolean {
  if (tabela === "contacts" && row.instagram_scoped_id != null)
    return db.contacts.some((c) => c.organization_id === row.organization_id && c.instagram_scoped_id === row.instagram_scoped_id);
  if (tabela === "messages" && row.external_id != null)
    return db.messages.some((m) => m.organization_id === row.organization_id && m.external_id === row.external_id);
  return false;
}

function builder(tabela: string) {
  let op: "select" | "insert" | "update" = "select";
  let payload: Row = {};
  const filtros: ((r: Row) => boolean)[] = [];
  let ord: { c: string; asc: boolean } | null = null;
  const b: Record<string, unknown> = {};
  const exec = async (): Promise<{ data: unknown; error: { code?: string; message: string } | null }> => {
    await Promise.resolve(); // cede a vez: permite a corrida entre dois webhooks
    if (op === "insert") {
      const row = gerada(tabela, { id: `${tabela}-${++seq}`, ...payload });
      if (violaUnico(tabela, row)) return { data: null, error: { code: "23505", message: "duplicate key" } };
      tabelaDe(tabela).push(row);
      return { data: [row], error: null };
    }
    const alvo = tabelaDe(tabela).filter((r) => filtros.every((f) => f(r)));
    if (ord) alvo.sort((x, y) => (String(x[ord!.c]) < String(y[ord!.c]) ? -1 : 1) * (ord!.asc ? 1 : -1));
    if (op === "update") {
      alvo.forEach((r) => Object.assign(r, payload));
      return { data: alvo.map((r) => ({ id: r.id })), error: null };
    }
    return { data: alvo, error: null };
  };
  Object.assign(b, {
    select: () => b,
    insert: (p: Row) => ((op = "insert"), (payload = p), b),
    update: (p: Row) => ((op = "update"), (payload = p), b),
    eq: (c: string, v: unknown) => (filtros.push((r) => r[c] === v), b),
    is: (c: string, v: unknown) => (filtros.push((r) => (r[c] ?? null) === v), b),
    not: (c: string, _o: string, v: string) => {
      const lista = v.replace(/[()]/g, "").split(",");
      filtros.push((r) => !lista.includes(String(r[c])));
      return b;
    },
    in: (c: string, vs: unknown[]) => (filtros.push((r) => vs.includes(r[c])), b),
    gte: (c: string, v: string) => (filtros.push((r) => String(r[c]) >= v), b),
    order: (c: string, o?: { ascending?: boolean }) => ((ord = { c, asc: o?.ascending !== false }), b),
    limit: () => b,
    maybeSingle: async () => {
      const r = await exec();
      const d = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
      return { data: d, error: r.error };
    },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => exec().then(ok, ko),
  });
  return b;
}

const admin = {
  from: (t: string) => builder(t),
  rpc: async (nome: string, args: Record<string, unknown>) => {
    rpcs.push({ nome, args });
    if (nome === "fn_upsert_wa_conversation") {
      const ja = db.conversations.find(
        (c) => c.organization_id === args.p_org && c.contact_id === args.p_contact && c.channel_session_id === args.p_session,
      );
      if (ja) return { data: ja.id, error: null };
      const row = {
        id: `conversations-${++seq}`,
        organization_id: args.p_org,
        contact_id: args.p_contact,
        channel_session_id: args.p_session,
        provider_conversation_id: null,
      };
      db.conversations.push(row);
      return { data: row.id, error: null };
    }
    return { data: null, error: null };
  },
} as never;

import { CHANNEL_PROVIDER_INSTAGRAM } from "@/lib/channels/capabilities";
import { ingestInstagramInbound } from "@/lib/channels/instagram/ingest";
import type { InstagramEvent, InstagramMessage } from "@/lib/channels/instagram/webhook";

const ORG_A = "org-a";
const ORG_B = "org-b";
const SESSAO_A = { organizationId: ORG_A, channelSessionId: "sess-a", accountId: "IGACC_A" };

const msg = (over: Partial<InstagramMessage> = {}): InstagramMessage => ({
  kind: "message",
  externalId: "mid.1",
  accountId: "IGACC_A",
  senderId: "IGSID_123456",
  recipientId: "IGACC_A",
  text: "oi, tem orcamento?",
  attachments: [],
  timestamp: 1700000000000,
  isEcho: false,
  ...over,
});

const ingerir = (events: InstagramEvent[], base = SESSAO_A) => ingestInstagramInbound(admin, { ...base, events });
const um = async (events: InstagramEvent[], base = SESSAO_A) => {
  const [r] = await ingerir(events, base);
  if (!r) throw new Error("sem resultado");
  return r;
};

beforeEach(() => {
  db.contacts.length = 0;
  db.conversations.length = 0;
  db.messages.length = 0;
  rpcs.length = 0;
  pos.entrada.mockClear();
  pos.pausa.mockClear();
  log.warn.mockClear();
});

describe("ingestInstagramInbound", () => {
  it("texto novo cria contato (sem telefone), conversa com thread = IGSID e mensagem, e chama os efeitos", async () => {
    const r = await um([msg()]);
    expect(r.status).toBe("ingested");
    expect(db.contacts).toHaveLength(1);
    expect(db.contacts[0]!).toMatchObject({
      organization_id: ORG_A,
      source_metadata: { instagram_igsid: "IGSID_123456" },
      display_name: "Instagram 3456",
    });
    expect(db.contacts[0]!.phone_number).toBeUndefined();
    expect(db.conversations[0]!).toMatchObject({ provider_conversation_id: "IGSID_123456", channel_session_id: "sess-a" });
    expect(db.messages[0]!).toMatchObject({ external_id: "mid.1", direction: "inbound", body: "oi, tem orcamento?", type: "text" });
    expect(rpcs.some((x) => x.nome === "fn_mark_conversation_message")).toBe(true);
    expect(pos.entrada).toHaveBeenCalledTimes(1);
    expect(pos.entrada.mock.calls[0]).toMatchObject([
      expect.anything(),
      { organizationId: ORG_A, channelSessionId: "sess-a", texto: "oi, tem orcamento?" },
    ]);
  });

  it("o mesmo mid duas vezes: a segunda e duplicate e nao repete efeitos", async () => {
    await ingerir([msg()]);
    const r = await um([msg()]);
    expect(r.status).toBe("duplicate");
    expect(db.messages).toHaveLength(1);
    expect(pos.entrada).toHaveBeenCalledTimes(1);
  });

  it("dois eventos do mesmo IGSID ao mesmo tempo resultam em UM contato", async () => {
    const rs = await Promise.all([ingerir([msg({ externalId: "mid.a" })]), ingerir([msg({ externalId: "mid.b" })])]);
    expect(db.contacts).toHaveLength(1);
    expect(db.messages).toHaveLength(2);
    expect(rs.flat().every((r) => r.status === "ingested")).toBe(true);
  });

  it("accountId de outra sessao e ignorado com conta_de_outra_sessao", async () => {
    const r = await um([msg({ accountId: "IGACC_OUTRA" })]);
    expect(r).toMatchObject({ status: "ignored", reason: "conta_de_outra_sessao" });
    expect(db.contacts).toHaveLength(0);
  });

  it("DUAS ORGANIZACOES: payload da conta da org B postado no token da org A nao escreve nada", async () => {
    // A org B tem sua propria sessao/conta. O payload traz a conta de B, mas o
    // token resolvido foi o de A: a organizacao vem da sessao, nunca do payload.
    const r = await um([msg({ accountId: "IGACC_B" })], SESSAO_A);
    expect(r.status).toBe("ignored");
    expect(db.contacts).toHaveLength(0);
    expect(db.conversations).toHaveLength(0);
    expect(db.messages).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
    expect(pos.entrada).not.toHaveBeenCalled();
    // E o caminho certo grava na org de quem e a sessao, e so nela.
    await ingerir([msg({ accountId: "IGACC_B" })], { organizationId: ORG_B, channelSessionId: "sess-b", accountId: "IGACC_B" });
    expect(db.contacts.map((c) => c.organization_id)).toEqual([ORG_B]);
    expect(db.messages.map((m) => m.organization_id)).toEqual([ORG_B]);
  });

  it("sessao sem instagram_account_id nao ingere nada", async () => {
    const r = await um([msg()], { ...SESSAO_A, accountId: "" });
    expect(r).toMatchObject({ status: "ignored", reason: "conta_de_outra_sessao" });
    expect(db.messages).toHaveLength(0);
  });

  it("sem texto e sem anexo: mensagem_vazia", async () => {
    const r = await um([msg({ text: null, attachments: [] })]);
    expect(r).toMatchObject({ status: "ignored", reason: "mensagem_vazia" });
    expect(db.messages).toHaveLength(0);
  });

  it("so anexo: ingerido com media", async () => {
    const r = await um([msg({ text: null, attachments: [{ type: "image", url: "https://scontent.cdninstagram.com/x.jpg" }] })]);
    expect(r.status).toBe("ingested");
    expect(db.messages[0]!).toMatchObject({ type: "image", media_url: "https://scontent.cdninstagram.com/x.jpg", body: null });
    expect(rpcs.filter((x) => x.nome === "emit_event").map((x) => x.args.p_event_type)).toContain("media.persist_requested");
  });

  describe("seguranca dos anexos", () => {
    it.each([
      ["http simples", "http://scontent.cdninstagram.com/x.jpg"],
      ["javascript:", "javascript:alert(1)"],
      ["data:", "data:image/png;base64,AAAA"],
      ["relativa", "/etc/passwd"],
      ["longa demais", "https://scontent.cdninstagram.com/" + "a".repeat(2050)],
    ])("url %s: guarda so o tipo, sem url e sem pedir persistencia", async (_n, url) => {
      const r = await um([msg({ text: "veja", attachments: [{ type: "image", url }] })]);
      expect(r.status).toBe("ingested");
      const m = db.messages[0]!;
      expect(m.media_url).toBeUndefined();
      expect(m.metadata).toEqual({ provider_attachments: [{ type: "image" }] });
      expect(JSON.stringify(rpcs)).not.toContain("media.persist_requested");
    });

    it("url https dentro do limite de 2048 e mantida", async () => {
      const base = "https://scontent.cdninstagram.com/";
      const url = base + "a".repeat(2048 - base.length);
      expect(url.length).toBe(2048);
      await ingerir([msg({ attachments: [{ type: "image", url }] })]);
      expect(db.messages[0]!.media_url).toBe(url);
    });

    it.each([
      "https://scontent.cdninstagram.com/v/x.jpg",
      "https://lookaside.fbsbx.com/ig/x",
      "https://scontent-gru1-1.xx.fbcdn.net/v/x.jpg",
      "https://fbcdn.net/x.jpg",
    ])("host permitido %s: url mantida", async (url) => {
      await ingerir([msg({ attachments: [{ type: "image", url }] })]);
      expect(db.messages[0]!.media_url).toBe(url);
    });

    it.each([
      ["sufixo colado", "https://evilfbcdn.net/x.jpg"],
      ["apex como subdominio do atacante", "https://fbcdn.net.evil.com/x.jpg"],
      ["userinfo disfarcando host", "https://cdninstagram.com@evil.com/x.jpg"],
      ["userinfo com host permitido", "https://user:pw@scontent.cdninstagram.com/x.jpg"],
      ["porta nao padrao", "https://scontent.cdninstagram.com:8443/x.jpg"],
      ["http em host permitido", "http://scontent.cdninstagram.com/x.jpg"],
      ["url invalida", "https://"],
    ])("host/forma invalida (%s): so o tipo, sem pedir persistencia", async (_n, url) => {
      await um([msg({ text: "veja", attachments: [{ type: "image", url }] })]);
      const m = db.messages[0]!;
      expect(m.media_url).toBeUndefined();
      expect(m.metadata).toEqual({ provider_attachments: [{ type: "image" }] });
      expect(JSON.stringify(rpcs)).not.toContain("media.persist_requested");
    });

    it("no maximo 10 anexos por mensagem", async () => {
      const anexos = Array.from({ length: 14 }, (_, i) => ({ type: "image", url: `https://scontent.cdninstagram.com/${i}.jpg` }));
      await ingerir([msg({ attachments: anexos })]);
      const guardados = (db.messages[0]!.metadata as { provider_attachments: unknown[] }).provider_attachments;
      expect(guardados).toHaveLength(10);
    });
  });

  it("processa no maximo 100 eventos por requisicao e avisa sem texto do cliente", async () => {
    const eventos = Array.from({ length: 130 }, (_, i) => msg({ externalId: `mid.lote.${i}`, text: `segredo-do-cliente-${i}` }));
    const rs = await ingerir(eventos);
    expect(rs).toHaveLength(100);
    expect(db.messages).toHaveLength(100);
    const avisos = JSON.stringify(log.warn.mock.calls);
    expect(avisos).toContain("instagram");
    expect(avisos).not.toContain("segredo-do-cliente");
  });

  describe("eco (is_echo)", () => {
    const eco = (over: Partial<InstagramMessage> = {}) =>
      msg({ isEcho: true, senderId: "IGACC_A", recipientId: "IGSID_123456", externalId: "mid.eco", text: "respondi pelo celular", ...over });

    it("mid que ja existe (nosso proprio envio): duplicate, sem efeitos", async () => {
      await ingerir([msg({ externalId: "mid.eco" })]);
      pos.entrada.mockClear();
      const r = await um([eco()]);
      expect(r.status).toBe("duplicate");
      expect(db.messages).toHaveLength(1);
      expect(pos.pausa).not.toHaveBeenCalled();
      expect(pos.entrada).not.toHaveBeenCalled();
    });

    it("mid novo: resposta humana fora do CRM, gravada como saida, pausa a IA e nunca acorda o agente", async () => {
      const r = await um([eco()]);
      expect(r.status).toBe("ingested");
      expect(db.messages[0]!).toMatchObject({ direction: "outbound", external_id: "mid.eco", sent_via: "external_device" });
      // o cliente e o DESTINATARIO do eco, nao o remetente (que e a nossa conta)
      expect(db.contacts[0]!.source_metadata).toEqual({ instagram_igsid: "IGSID_123456" });
      expect(db.conversations[0]!.provider_conversation_id).toBe("IGSID_123456");
      expect(pos.pausa).toHaveBeenCalledTimes(1);
      expect(pos.pausa.mock.calls[0]).toMatchObject([expect.anything(), { organizationId: ORG_A, canal: CHANNEL_PROVIDER_INSTAGRAM }]);
      expect(pos.entrada).not.toHaveBeenCalled();
      expect(rpcs.some((x) => x.nome === "emit_event" && x.args.p_event_type === "ai_agent.dispatch_requested")).toBe(false);
    });

    describe("corrida: eco antes de o sender gravar o mid", () => {
      const agora = () => new Date().toISOString();
      /** Conversa ja existente com uma saida nossa em voo (queued, sem external_id). */
      async function comEnvioEmVoo(over: Row = {}) {
        await ingerir([msg({ externalId: "mid.cli" })]); // cria contato e conversa
        pos.entrada.mockClear();
        const conv = db.conversations[0]!.id;
        const row: Row = {
          id: "saida-1", organization_id: ORG_A, conversation_id: conv, direction: "outbound",
          status: "queued", external_id: null, body: "resposta do bot", sent_via: "ai", created_at: agora(), ...over,
        };
        db.messages.push(row);
        return row;
      }
      const eco = (over: Partial<InstagramMessage> = {}) =>
        msg({ isEcho: true, senderId: "IGACC_A", recipientId: "IGSID_123456", externalId: "mid.bot", text: "resposta do bot", ...over });

      it("adota o mid na linha queued: sem nova linha, sem pausar a IA, sem efeitos", async () => {
        const row = await comEnvioEmVoo();
        const r = await um([eco()]);
        expect(r.status).toBe("duplicate");
        expect(row.external_id).toBe("mid.bot");
        expect(db.messages).toHaveLength(2); // a do cliente + a nossa, nenhuma nova
        expect(pos.pausa).not.toHaveBeenCalled();
        expect(pos.entrada).not.toHaveBeenCalled();
        expect(rpcs.some((x) => x.nome === "fn_mark_conversation_message" && x.args.p_direction === "outbound")).toBe(false);
      });

      it("adotar promove o status para sent junto com o external_id", async () => {
        const row = await comEnvioEmVoo();
        await um([eco()]);
        expect(row.status).toBe("sent");
        const r2 = await comEnvioEmVoo({ id: "saida-2", status: "sending", body: "outra" });
        await um([eco({ externalId: "mid.outra", text: "outra" })]);
        expect(r2.status).toBe("sent");
      });

      it("status sending tambem e adotavel", async () => {
        const row = await comEnvioEmVoo({ status: "sending" });
        expect((await um([eco()])).status).toBe("duplicate");
        expect(row.external_id).toBe("mid.bot");
      });

      it("depois de adotado, a reentrega do mesmo eco segue duplicate (mid conhecido)", async () => {
        await comEnvioEmVoo();
        await ingerir([eco()]);
        expect((await um([eco()])).status).toBe("duplicate");
        expect(pos.pausa).not.toHaveBeenCalled();
      });

      it("sem linha pendente: e resposta humana — grava, pausa a IA", async () => {
        await ingerir([msg({ externalId: "mid.cli" })]);
        const r = await um([eco({ externalId: "mid.humano", text: "digitei no celular" })]);
        expect(r.status).toBe("ingested");
        expect(pos.pausa).toHaveBeenCalledTimes(1);
        expect(db.messages.find((m) => m.external_id === "mid.humano")).toMatchObject({ sent_via: "external_device" });
      });

      it("linha pendente com mais de 60 s: nao adota — humano", async () => {
        const row = await comEnvioEmVoo({ created_at: new Date(Date.now() - 61_000).toISOString() });
        const r = await um([eco()]);
        expect(r.status).toBe("ingested");
        expect(row.external_id).toBeNull();
        expect(pos.pausa).toHaveBeenCalledTimes(1);
      });

      it("linha ja enviada/falhada nao e pendente: humano", async () => {
        await comEnvioEmVoo({ status: "failed" });
        expect((await um([eco()])).status).toBe("ingested");
        expect(pos.pausa).toHaveBeenCalledTimes(1);
      });

      it("escopo: linha pendente de OUTRA organizacao ou de OUTRA conversa nao e adotada", async () => {
        const row = await comEnvioEmVoo({ organization_id: ORG_B });
        const outra = await comEnvioEmVoo({ id: "saida-2", conversation_id: "conversa-de-outro-cliente" });
        const r = await um([eco()]);
        expect(r.status).toBe("ingested");
        expect(row.external_id).toBeNull();
        expect(outra.external_id).toBeNull();
        expect(pos.pausa).toHaveBeenCalledTimes(1);
      });

      it("duas pendentes: adota a de corpo igual, nao a primeira da fila", async () => {
        const errada = await comEnvioEmVoo({ id: "saida-x", body: "outra coisa" });
        const certa = await comEnvioEmVoo({ id: "saida-y" });
        await um([eco()]);
        expect(certa.external_id).toBe("mid.bot");
        expect(errada.external_id).toBeNull();
      });

      it("corpo so difere em espacos: adotada (normalizado)", async () => {
        const row = await comEnvioEmVoo({ body: "  resposta   do bot " });
        expect((await um([eco()])).status).toBe("duplicate");
        expect(row.external_id).toBe("mid.bot");
      });

      it("corpo diferente (humano digitou com envio em voo): nao adota, grava e pausa a IA", async () => {
        const row = await comEnvioEmVoo();
        const r = await um([eco({ externalId: "mid.humano", text: "digitei no celular" })]);
        expect(r.status).toBe("ingested");
        expect(row.external_id).toBeNull();
        expect(db.messages.find((m) => m.external_id === "mid.humano")).toMatchObject({ sent_via: "external_device" });
        expect(pos.pausa).toHaveBeenCalledTimes(1);
      });

      it("duas candidatas de corpo identico: adota a mais antiga", async () => {
        const nova = await comEnvioEmVoo({ id: "saida-nova", created_at: new Date(Date.now() - 1_000).toISOString() });
        const velha = await comEnvioEmVoo({ id: "saida-velha", created_at: new Date(Date.now() - 20_000).toISOString() });
        await um([eco()]);
        expect(velha.external_id).toBe("mid.bot");
        expect(nova.external_id).toBeNull();
      });

      it("so anexo, uma candidata: adotada", async () => {
        const row = await comEnvioEmVoo({ body: null });
        const r = await um([eco({ text: null, attachments: [{ type: "image", url: "https://scontent.cdninstagram.com/x.jpg" }] })]);
        expect(r.status).toBe("duplicate");
        expect(row.external_id).toBe("mid.bot");
        expect(pos.pausa).not.toHaveBeenCalled();
      });

      it("so anexo, duas candidatas: nao adota (humano)", async () => {
        const a1 = await comEnvioEmVoo({ id: "s1", body: null });
        const a2 = await comEnvioEmVoo({ id: "s2", body: null });
        const r = await um([eco({ text: null, attachments: [{ type: "image", url: "https://scontent.cdninstagram.com/x.jpg" }] })]);
        expect(r.status).toBe("ingested");
        expect(a1.external_id).toBeNull();
        expect(a2.external_id).toBeNull();
        expect(pos.pausa).toHaveBeenCalledTimes(1);
      });
    });

    it("eco sem destinatario e ignorado", async () => {
      const r = await um([eco({ recipientId: null })]);
      expect(r.status).toBe("ignored");
      expect(db.messages).toHaveLength(0);
    });
  });

  describe("evento read", () => {
    it("marca como read as mensagens enviadas ao contato, sem rebaixar e sem tocar em outra org", async () => {
      await ingerir([msg()]);
      const conv = db.conversations[0]!.id;
      db.messages.push(
        { id: "o1", organization_id: ORG_A, conversation_id: conv, direction: "outbound", status: "sent" },
        { id: "o2", organization_id: ORG_A, conversation_id: conv, direction: "outbound", status: "read" },
        { id: "x1", organization_id: ORG_B, conversation_id: conv, direction: "outbound", status: "sent" },
      );
      const r = await um([{ kind: "read", accountId: "IGACC_A", senderId: "IGSID_123456", timestamp: 1 }]);
      expect(r.status).toBe("ingested");
      expect(db.messages.find((m) => m.id === "o1")?.status).toBe("read");
      expect(db.messages.find((m) => m.id === "x1")?.status).toBe("sent");
    });

    it("read de contato desconhecido: ignored", async () => {
      const r = await um([{ kind: "read", accountId: "IGACC_A", senderId: "NINGUEM", timestamp: 1 }]);
      expect(r.status).toBe("ignored");
    });
  });
});
