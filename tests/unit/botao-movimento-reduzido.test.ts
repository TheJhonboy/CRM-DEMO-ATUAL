// @vitest-environment node
import path from "node:path";

import tailwindcss from "@tailwindcss/postcss";
import postcss, { type AtRule, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

import { buttonVariants } from "@/components/ui/button";

/**
 * O botão levanta 1px no hover — e quem pediu menos movimento não recebe isso.
 *
 * `hover:-translate-y-px` estava no `buttonVariants` sem guarda: todo botão do produto
 * se mexia sob o cursor com `prefers-reduced-motion: reduce` ligado. Conferir que a
 * classe `motion-reduce:` está na string não prova nada — o que importa é o CSS que o
 * Tailwind EMITE e qual declaração vence na cascata. Então este caso compila as
 * classes reais do botão com o Tailwind 4 do repo e resolve a cascata em miniatura:
 * dado um contexto de mídia, qual `--tw-translate-y` a regra `:hover` vencedora deixa?
 *
 * Todas as regras aqui são `.classe:hover` de mesma especificidade, então a última em
 * ordem de documento vence — que é exatamente a propriedade que o `motion-reduce:`
 * precisa ter (emitido depois do `hover:`) para neutralizar o levante.
 *
 * O CSS compilado é mínimo (só as classes do botão, sem o `@theme` do produto), então
 * o zero sai como `0px`; no CSS inteiro do produto ele sai como `var(--space-0)`, que
 * é `0px`. A ORDEM e as mídias — o que se prova aqui — são as mesmas: conferido no
 * `app/globals.css` completo, com o levante antes da regra `motion-reduce`.
 */

const RAIZ = process.cwd();

async function compilar(classes: readonly string[]): Promise<string> {
  // `source(none)`: nada do repo é varrido; só entram as classes passadas via `@source inline`.
  const entrada = [
    '@import "tailwindcss" source(none);',
    ...classes.map((c) => `@source inline("${c}");`),
  ].join("\n");
  const { css } = await postcss([tailwindcss({ base: RAIZ })]).process(entrada, {
    from: path.join(RAIZ, "entrada-minima.css"),
  });
  return css;
}

/** Os `@media` que envolvem a regra, de dentro para fora. */
function midiasDe(regra: Rule): string[] {
  const params: string[] = [];
  for (let pai = regra.parent; pai && pai.type !== "root"; pai = pai.parent) {
    if (pai.type === "atrule" && (pai as AtRule).name === "media")
      params.push((pai as AtRule).params);
  }
  return params;
}

/** O `--tw-translate-y` que sobra no `:hover` quando exatamente `contexto` é verdadeiro; `null` se nenhuma regra vale. */
function translateYNoHover(
  css: string,
  contexto: readonly string[],
): { valor: string | null; regras: number } {
  let valor: string | null = null;
  let regras = 0;
  postcss.parse(css).walkRules((regra) => {
    if (!regra.selector.endsWith(":hover")) return;
    if (!midiasDe(regra).every((m) => contexto.includes(m))) return;
    regra.walkDecls("--tw-translate-y", (d) => {
      valor = d.value;
      regras += 1;
    });
  });
  return { valor, regras };
}

const COM_MOUSE = "(hover: hover)";
const MOVIMENTO_REDUZIDO = "(prefers-reduced-motion: reduce)";
const SEM_PREFERENCIA = "(prefers-reduced-motion: no-preference)";

describe("botão · movimento reduzido", () => {
  const classesDeTranslate = buttonVariants({ variant: "primary" })
    .split(/\s+/)
    .filter((c) => c.includes("translate"));

  it("o botão declara o levante de hover que o teste vai medir", () => {
    // Vacuidade: se o levante sumir do botão, os dois casos abaixo compilariam zero
    // regras e o segundo daria `null` — isto diz que o problema é o botão ter mudado.
    expect(classesDeTranslate.some((c) => c.endsWith("hover:-translate-y-px"))).toBe(true);
  });

  it("com `prefers-reduced-motion: reduce`, o hover não desloca o botão", async () => {
    const css = await compilar(classesDeTranslate);
    const { valor, regras } = translateYNoHover(css, [COM_MOUSE, MOVIMENTO_REDUZIDO]);
    expect(regras).toBeGreaterThan(0);
    expect(
      Number.parseFloat(valor ?? "NaN"),
      `--tw-translate-y vencedor sob reduce = ${valor}`,
    ).toBe(0);
  });

  it("sem preferência de movimento, o hover continua levantando 1px", async () => {
    // O contraponto: sem ele, "neutralizar sempre" passaria no caso anterior e mataria
    // o feedback de hover de quem não pediu nada.
    const css = await compilar(classesDeTranslate);
    const { valor } = translateYNoHover(css, [COM_MOUSE, SEM_PREFERENCIA]);
    expect(valor).toBe("-1px");
  });
});
