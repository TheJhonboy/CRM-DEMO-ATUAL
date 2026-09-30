import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { failJob } from "@/lib/agent-engine/queue/queue";

/**
 * ENVIO DO AGENTE QUE FALHA NÃO SOME EM SILÊNCIO — já era assim; este arquivo prende.
 *
 * ─── A pergunta (carry-over da revisão do adapter do Instagram) ─────────────
 *
 * Uma falha TRANSITÓRIA na leitura da credencial (`credenciais_indisponiveis`)
 * faz o handler compartilhado (app/api/v1/messages/_handler.ts) marcar a mensagem
 * como `failed`, sem retry próprio. Para as AUTOMAÇÕES, `desfecho-do-envio.ts`
 * abre aviso ao operador. E para o envio DIRETO do agente?
 *
 * ─── O que a investigação achou: não há buraco ──────────────────────────────
 *
 * 1. `sendTurnMessage` devolve o desfecho `failed` ao runtime (edge/crm/send-message.ts).
 * 2. O turno (inbound-turn.ts) LANÇA quando algum envio do turno saiu `failed`
 *    ("envio marcado como failed pelo CRM — run re-tentado pela fila"); o
 *    follow-up determinístico (followup-turn.ts) idem. Não é engolido.
 * 3. A fila re-tenta o run com backoff (o ledger rotaciona a chave do envio falho,
 *    F2-06), e ao esgotar `max_attempts` o `failJob` marca o job `dead` e abre, no
 *    MESMO statement, um aviso CRÍTICO `job_dead` na Central com o erro junto.
 *
 * Então a falha é re-tentada (o que a falha transitória pede) E, se persistir,
 * fica visível ao operador — além da bolha `failed` que a conversa já mostra.
 * Nenhuma mudança de produção foi feita para este item.
 *
 * Custo conhecido, não corrigido aqui: cada tentativa que falha deixa a SUA linha
 * `failed` na conversa (a chave rotaciona), então uma credencial fora por minutos
 * pode mostrar mais de uma bolha falha antes da que sai.
 */

const INBOUND = readFileSync(join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"), "utf8");
const FOLLOWUP = readFileSync(join(process.cwd(), "lib/agent-engine/agent/followup-turn.ts"), "utf8");

describe("o desfecho failed do envio do agente sobe como erro do run", () => {
  it("turno de resposta: lança quando algum envio saiu failed", () => {
    expect(INBOUND).toMatch(
      /if \(outcomes\.some\(\(o\) => o\.kind === 'failed'\)\) \{[\s\S]{0,300}throw new Error\(/,
    );
  });

  it("follow-up determinístico: failed também lança (não conclui o passo)", () => {
    expect(FOLLOWUP).toMatch(/case 'failed':\s*\n\s*throw new Error\(/);
  });
});

describe("esgotadas as tentativas, a Central recebe o aviso", () => {
  it("failJob marca dead e abre job_dead crítico no mesmo statement, com o motivo", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: "job-1", status: "dead" }] }));
    await failJob({ query } as never, "job-1", "w1", new Error("envio marcado como failed pelo CRM"));
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/when attempts >= max_attempts then 'dead'/);
    expect(sql).toMatch(/insert into agent_inbox_items[\s\S]*'job_dead', 'critical'/);
    expect(sql).toMatch(/where status = 'dead'/);
    // O erro vai junto no corpo do aviso (last_error = $3).
    expect(sql).toMatch(/last_error = \$3/);
    expect(String(params[2])).toMatch(/failed pelo CRM/);
  });
});
