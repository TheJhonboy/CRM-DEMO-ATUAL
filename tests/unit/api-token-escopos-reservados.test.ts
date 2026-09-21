// @vitest-environment node
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { createApiTokenSchema } from "@/lib/schemas/team";

/**
 * ESCOPOS RESERVADOS AO SISTEMA NÃO SAEM DO FORMULÁRIO DE TOKEN DE API
 * (auditoria de 21/09/2026, achado 6).
 *
 * ═══ O defeito ═══
 *
 * `scopes: z.array(z.string()).min(1)` deixava um admin do tenant gravar
 * `actor:ai_agent` ou `agent_run:<uuid>` num token de API. `deriveActor`
 * (`lib/mcp/auth.ts`) LÊ esses dois para decidir quem aparece como autor — e
 * essa decisão vira coluna com FK e vira o que a auditoria mostra. Um token
 * comum se passava por agente de IA, com o `run` que o admin escolhesse. Não
 * escala privilégio nem cruza tenant; envenena a trilha.
 *
 * Quem emite esses escopos é `lib/ai/runtime/mcp_token.ts`, direto no banco, sem
 * passar por este schema.
 *
 * ═══ O que NÃO se faz ═══
 *
 * Não se restringe a um enum: a tela manda `mcp:read`, `mcp:write`,
 * `role:manager`, `contacts:*`, `leads:*`, `messages:*` e `audit:read`, e o
 * schema tem de aceitar qualquer escopo de integração que não seja reservado.
 * O gate é por PREFIXO (`actor:` e `agent_run:`), não por lista de permitidos.
 */

const base = { name: "Integração de teste" };
const analisar = (scopes: unknown) => createApiTokenSchema.safeParse({ ...base, scopes });

const RUN_ID = "11111111-1111-4111-8111-111111111111";

/** Lê os ids de `SCOPES` direto do arquivo da tela — o que a tela PODE mandar. */
function escoposDaTela(): string[] {
  const arquivo = path.resolve(
    __dirname,
    "../../app/app/settings/api-tokens/_components/ApiTokensClient.tsx",
  );
  const fonte = fs.readFileSync(arquivo, "utf8");
  const bloco = /const SCOPES\b[^=]*=\s*\[([\s\S]*?)\n\];/.exec(fonte)?.[1] ?? "";
  return [...bloco.matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((m) => m[1]!);
}

describe("createApiTokenSchema — escopos", () => {
  it("CONTROLE: a leitura da lista de escopos da tela enxerga os escopos que ela oferece", () => {
    // Sem isto, um regex que parasse de casar devolveria lista vazia e o caso
    // "a tela continua passando" abaixo viraria verde por vacuidade.
    const ids = escoposDaTela();
    expect(ids.length, "a lista de escopos da tela não foi lida").toBeGreaterThanOrEqual(10);
    expect(ids).toEqual(expect.arrayContaining(["mcp:read", "mcp:write", "role:manager", "audit:read"]));
  });

  it("todo escopo que a TELA oferece continua sendo aceito, junto e um a um", () => {
    const ids = escoposDaTela();
    expect(analisar(ids).success, `a tela manda ${ids.join(", ")} e o schema recusou`).toBe(true);
    for (const id of ids) {
      expect(analisar([id]).success, `escopo da tela recusado: ${id}`).toBe(true);
    }
  });

  it("não é uma lista de permitidos: escopo de integração que ninguém catalogou passa", () => {
    expect(analisar(["contacts:*", "leads:*", "messages:*"]).success).toBe(true);
    expect(analisar(["crm:relatorio.exportar"]).success).toBe(true);
  });

  it("recusa `actor:ai_agent` sozinho ou misturado com escopos válidos", () => {
    expect(analisar(["actor:ai_agent"]).success, "actor:ai_agent sozinho").toBe(false);
    expect(analisar(["mcp:read", "mcp:write", "actor:ai_agent"]).success, "misturado").toBe(false);
  });

  it("recusa qualquer escopo com o prefixo `actor:`, não só o valor que o código lê hoje", () => {
    expect(analisar(["actor:human"]).success).toBe(false);
    expect(analisar(["actor:"]).success).toBe(false);
  });

  it("recusa `agent_run:<qualquer coisa>`, uuid ou não", () => {
    expect(analisar(["agent_run:x"]).success, "agent_run:x").toBe(false);
    expect(analisar([`agent_run:${RUN_ID}`]).success, "agent_run:<uuid>").toBe(false);
    expect(analisar(["mcp:read", `agent_run:${RUN_ID}`]).success, "misturado").toBe(false);
  });

  it("não deixa passar por caixa ou espaço em volta", () => {
    expect(analisar(["ACTOR:ai_agent"]).success, "maiúsculas").toBe(false);
    expect(analisar([" actor:ai_agent"]).success, "espaço antes").toBe(false);
    expect(analisar(["Agent_Run:x"]).success, "caixa mista").toBe(false);
  });

  it("o gate é por PREFIXO: quem só CONTÉM `actor:` no meio não é recusado", () => {
    // `includes` recusaria estes por engano — e um gate que reprova o valor
    // certo é o que faz alguém trocar o gate por `z.string()` de novo.
    expect(analisar(["transactor:read"]).success, "transactor:read").toBe(true);
    expect(analisar(["reagent_run:x"]).success, "reagent_run:x").toBe(true);
  });

  it("o erro aponta para o campo `scopes`", () => {
    const r = analisar(["mcp:read", "actor:ai_agent"]);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.every((i) => i.path[0] === "scopes")).toBe(true);
      expect(r.error.flatten().fieldErrors.scopes?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("lista vazia e ausência de `scopes` continuam recusadas", () => {
    expect(analisar([]).success, "lista vazia").toBe(false);
    expect(createApiTokenSchema.safeParse(base).success, "sem scopes").toBe(false);
  });
});
