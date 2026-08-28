import { describe, expect, it } from "vitest";

import { deveIrParaOWizard, podeAbrirOWizard } from "./quem-passa-pelo-wizard";

/**
 * O caso que motivou a regra: organização entregue configurada, cliente
 * abrindo a Inbox pela primeira vez. Antes ele caía no wizard de 6 passos.
 */
const CLIENTE_EM_ORG_NOVA = { onboardedAt: null, isPlatformAdmin: false };
const INSTALADOR_EM_ORG_NOVA = { onboardedAt: null, isPlatformAdmin: true };
const ORG_JA_CONFIGURADA = "2026-08-28T03:00:00.000Z";

describe("deveIrParaOWizard — o desvio de quem chega pelo /app/*", () => {
  it("NÃO interrompe o cliente numa organização que ainda não passou pelo wizard", () => {
    // A regressão inteira mora nesta linha: era `!onboarded_at` sem mais nada,
    // e o vendedor que queria responder um lead decidia o nicho da empresa.
    expect(deveIrParaOWizard(CLIENTE_EM_ORG_NOVA)).toBe(false);
  });

  it("leva quem instalou ao wizard enquanto a organização não foi configurada", () => {
    expect(deveIrParaOWizard(INSTALADOR_EM_ORG_NOVA)).toBe(true);
  });

  it("não leva ninguém de volta depois que a organização foi configurada", () => {
    // Nem quem instalou: concluído é concluído, e reconfigurar é Configurações.
    expect(
      deveIrParaOWizard({ onboardedAt: ORG_JA_CONFIGURADA, isPlatformAdmin: true }),
    ).toBe(false);
    expect(
      deveIrParaOWizard({ onboardedAt: ORG_JA_CONFIGURADA, isPlatformAdmin: false }),
    ).toBe(false);
  });
});

describe("podeAbrirOWizard — a URL digitada direto em /onboarding", () => {
  it("fecha a porta para o cliente, e não só o desvio", () => {
    // Sem esta, tirar o redirect do `/app/*` deixaria a tela alcançável por
    // quem errasse o caminho — a decisão da empresa inteira a um typo.
    expect(podeAbrirOWizard(CLIENTE_EM_ORG_NOVA)).toBe(false);
  });

  it("deixa quem instalou entrar", () => {
    expect(podeAbrirOWizard(INSTALADOR_EM_ORG_NOVA)).toBe(true);
  });

  it("recusa a volta depois de configurada", () => {
    expect(
      podeAbrirOWizard({ onboardedAt: ORG_JA_CONFIGURADA, isPlatformAdmin: true }),
    ).toBe(false);
  });
});

describe("as duas portas concordam", () => {
  it("quem é desviado para o wizard consegue abri-lo, e vice-versa", () => {
    // Duas portas com regras que divergem é o bug clássico: o desvio manda
    // para uma tela que a própria tela recusa — laço de redirect infinito.
    for (const onboardedAt of [null, ORG_JA_CONFIGURADA]) {
      for (const isPlatformAdmin of [true, false]) {
        const quem = { onboardedAt, isPlatformAdmin };
        expect(podeAbrirOWizard(quem)).toBe(deveIrParaOWizard(quem));
      }
    }
  });
});
