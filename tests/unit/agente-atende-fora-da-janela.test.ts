import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  messagingWindowGate,
  runBeforeSend,
  type GateContext,
} from "@/lib/agent-engine/guardrails/before-send";
import type { Logger } from "@/lib/agent-engine/obs/logger";
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { SPINNING_DEFAULTS } from "@/lib/agent-engine/spinning/defaults";
import {
  CHANNEL_PROVIDER_INSTAGRAM,
  CHANNEL_PROVIDER_META,
  capabilitiesOf,
} from "@/lib/channels/capabilities";

/**
 * JANELA FECHADA NUM CANAL QUE NÃO TEM TEMPLATE.
 *
 * ─── Achados da investigação (Task 8, Step 1) ───────────────────────────────
 *
 * (b) A janela de 24h do agente é aplicada em UM lugar: o gate `messaging_window`
 *     da cadeia `before_send` (lib/agent-engine/guardrails/before-send.ts). Ele lê
 *     `conversations.last_inbound_at` sob o lock e pergunta `capabilitiesOf` —
 *     nunca o nome do provider. A tela usa a mesma conta em `lib/channels/janela.ts`.
 *
 * (c) Caso novo: `freeformOutsideWindow: false` E `requiresTemplates: false`. O gate
 *     vetava certo, mas a `reason` (que volta ao modelo como erro instrutivo) mandava
 *     "use um template aprovado (ferramenta send_template)" — e o turno APAGA essa
 *     ferramenta quando o canal não exige template (inbound-turn.ts, `delete
 *     rawTools.send_template`). Instrução impossível de seguir: o modelo tentava de
 *     novo, levava o mesmo veto e o turno morria sem ninguém saber.
 *
 * O que muda: a `reason` depende de `requiresTemplates`, e — no canal sem template —
 * a própria cadeia registra a escalada na Central (agent_inbox_items, no molde do
 * `escalateLgpdVeto`: kind='other' + ref_kind próprio, dedupe por episódio aberto —
 * não kind='handoff', cujo dedupe engoliria um handoff real posterior). É na
 * cadeia e não na ferramenta de handoff porque (1) a ferramenta pode estar
 * desligada na tela, (2) o follow-up determinístico não tem modelo para chamá-la, e
 * (3) a escalada não pode depender de o modelo LEMBRAR. Não seta `force_human`: o
 * cliente que voltar a escrever reabre a janela e deve ser atendido normalmente.
 * A tag HUMAN_AGENT (7 dias) não é modelada, de propósito (ver capabilities.ts).
 */

const AGORA = new Date("2026-07-28T13:00:00Z"); // 10h BRT, terça — dentro do horário
const horasAtras = (n: number) => new Date(AGORA.getTime() - n * 3_600_000);

function baseCtx(over: Partial<GateContext> = {}): GateContext {
  return {
    now: AGORA,
    body: "oi",
    optedOut: false,
    provider: CHANNEL_PROVIDER_INSTAGRAM,
    pacing: {
      knobs: PACING_DEFAULTS,
      state: { lastSentAt: null, sentToday: 0, numberActivatedAt: null },
      crmDailyLimit: null,
      rng: () => 0,
    },
    spinning: { knobs: SPINNING_DEFAULTS, window: [] },
    lgpd: null,
    promise: { table: null },
    semanticPromise: null,
    ...over,
  } as GateContext;
}

describe("a matriz sustenta o caso novo", () => {
  it("o canal restringe a janela e NÃO tem template", () => {
    const caps = capabilitiesOf(CHANNEL_PROVIDER_INSTAGRAM);
    expect(caps.freeformOutsideWindow).toBe(false);
    expect(caps.requiresTemplates).toBe(false);
  });
});

describe("gate messaging_window — a saída depende de requiresTemplates", () => {
  it("SEM template: veta, e a razão NÃO manda usar uma ferramenta que não existe", () => {
    const v = messagingWindowGate.evaluate(
      baseCtx({ messagingWindow: { lastInboundAt: horasAtras(30) } }),
    );
    expect(v.pass).toBe(false);
    if (v.pass) throw new Error("inalcançável");
    expect(v.code).toBe("messaging_window_closed");
    expect(v.reason).not.toMatch(/send_template/);
    expect(v.reason).not.toMatch(/template aprovado/i);
    // A saída que existe: não mandar texto livre e deixar com uma pessoa.
    expect(v.reason).toMatch(/não envie/i);
    expect(v.reason).toMatch(/humano|atendente|pessoa/i);
  });

  it("COM template (canal oficial): a razão continua apontando o send_template", () => {
    const v = messagingWindowGate.evaluate(
      baseCtx({ provider: CHANNEL_PROVIDER_META, messagingWindow: { lastInboundAt: horasAtras(30) } }),
    );
    if (v.pass) throw new Error("inalcançável");
    expect(v.reason).toMatch(/send_template/);
  });

  it("SEM template e janela ABERTA: passa, sem skipped", () => {
    const v = messagingWindowGate.evaluate(
      baseCtx({ messagingWindow: { lastInboundAt: horasAtras(2) } }),
    );
    expect(v.pass).toBe(true);
    if (!v.pass) throw new Error("inalcançável");
    expect(v.skipped).toBeUndefined();
  });

  it("SEM template, 'isTemplate' não abre a porta — não há template legítimo neste canal", () => {
    // No canal oficial a flag é a saída legítima. Aqui ela não pode virar bypass:
    // nenhum chamador deste canal manda template, e aceitar a flag deixaria um texto
    // livre sair fora da janela só por vir marcado.
    const v = messagingWindowGate.evaluate(
      baseCtx({ messagingWindow: { lastInboundAt: horasAtras(30), isTemplate: true } }),
    );
    expect(v.pass).toBe(false);
  });
});

/**
 * A cadeia REAL (sem `gates:` injetado), com pool/cliente falsos no molde de
 * `gate-vazamento-interno.test.ts`: o cliente responde o provider e o
 * `last_inbound_at`, o pool captura as escritas autônomas (trace, escalada).
 */
function cadeiaReal(provider: string, lastInboundAt: Date | null) {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (/select provider from channel_sessions/.test(sql)) return { rows: [{ provider }] };
      if (/select last_inbound_at from conversations/.test(sql)) {
        return { rows: [{ last_inbound_at: lastInboundAt }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const poolQuery = vi.fn(async () => ({ rows: [{ id: "trace-1" }] }));
  const pool = { connect: vi.fn(async () => client), query: poolQuery } as unknown as pg.Pool;
  const send = vi.fn(async () => ({ kind: "sent" as const, idempotencyKey: "k", messageId: "m" }));
  const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const run = runBeforeSend({
    pool,
    log,
    tenantId: "00000000-0000-4000-8000-000000000001",
    leadId: "00000000-0000-4000-8000-000000000002",
    jobId: "00000000-0000-4000-8000-000000000003",
    channelSessionId: "00000000-0000-4000-8000-000000000004",
    body: "Oi! Voltando ao seu pedido de ontem.",
    optedOutThisTurn: false,
    crmDailyLimit: null,
    now: AGORA,
    rng: () => 0,
    sleep: async () => {},
    send,
  });
  const escaladas = () =>
    poolQuery.mock.calls.filter((c) => {
      const sql = String((c as unknown[])[0] ?? "");
      return /insert into agent_inbox_items/.test(sql) && /'janela_fechada_sem_modelo'/.test(sql);
    });
  return { run, send, escaladas, poolQuery };
}

describe("cadeia real — janela fechada no canal sem template", () => {
  it("NÃO chama o canal e REGISTRA a escalada para humano", async () => {
    const { run, send, escaladas } = cadeiaReal(CHANNEL_PROVIDER_INSTAGRAM, horasAtras(30));
    const r = await run;
    expect(r.status).toBe("vetoed");
    if (r.status !== "vetoed") throw new Error("inalcançável");
    expect(r.code).toBe("messaging_window_closed");
    expect(send).not.toHaveBeenCalled();
    expect(escaladas()).toHaveLength(1);
    // Dedupe por episódio aberto: dois vetos seguidos não viram dois avisos.
    const sql = String((escaladas()[0] as unknown[])[0]);
    expect(sql).toMatch(/where not exists/);
    // O CHECK de severity só aceita info/warn/critical — 'warning' falharia no banco
    // e o catch fire-and-forget engoliria a escalada em silêncio.
    expect(sql).toMatch(/'other',\s*'(info|warn|critical)'/);
    // Não colide com o dedupe do handoff humano (kind='handoff' + contato).
    expect(sql).not.toMatch(/'handoff'/);
    // Escopo de fonte confiável: org e contato vêm do job, não do corpo.
    const params = (escaladas()[0] as unknown[])[1] as unknown[];
    expect(params).toContain("00000000-0000-4000-8000-000000000001");
    expect(params).toContain("00000000-0000-4000-8000-000000000002");
  });

  it("contato que NUNCA escreveu (sem last_inbound_at): mesmo desfecho — fail-closed", async () => {
    const { run, send, escaladas } = cadeiaReal(CHANNEL_PROVIDER_INSTAGRAM, null);
    expect((await run).status).toBe("vetoed");
    expect(send).not.toHaveBeenCalled();
    expect(escaladas()).toHaveLength(1);
  });

  it("canal COM template: veta sem escalar — a saída lá é o template, não a pessoa", async () => {
    const { run, send, escaladas } = cadeiaReal(CHANNEL_PROVIDER_META, horasAtras(30));
    expect((await run).status).toBe("vetoed");
    expect(send).not.toHaveBeenCalled();
    expect(escaladas()).toHaveLength(0);
  });

  it("janela ABERTA no canal sem template: envia e não escala", async () => {
    const { run, send, escaladas } = cadeiaReal(CHANNEL_PROVIDER_INSTAGRAM, horasAtras(1));
    expect((await run).status).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(escaladas()).toHaveLength(0);
  });
});
