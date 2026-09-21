import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PALETTES } from "@/app/design/lib/tokens";
import { razaoDeContraste } from "@/lib/branding/contraste";
import { REGUA_DO_PRODUTO } from "@/lib/branding/regua-do-produto";

describe("tema escuro profissional do Calixto", () => {
  it("separa fundo, estrutura e cartões com neutros azulados", () => {
    expect(PALETTES.sage.surfaces.dark).toEqual({
      bg: "#0b1115",
      surface: "#10171c",
      surfaceElevated: "#202a31",
      text: "#f4f7f8",
      textMuted: "#b7c1c8",
      border: "#34414a",
    });

    expect(REGUA_DO_PRODUTO.escuro.base).toEqual([
      { chave: "--color-bg", hex: "#0b1115" },
      { chave: "--color-surface", hex: "#10171c" },
      { chave: "--color-surface-elevated", hex: "#202a31" },
    ]);
  });

  it("usa menta legível para ações sem branco sobre fundo claro", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    const blocoEscuro = css.match(/\[data-theme="dark"\] \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(blocoEscuro).toContain("--color-accent-200: #bdf5ce");
    expect(blocoEscuro).toContain("--color-accent-300: #83e6a3");
    expect(REGUA_DO_PRODUTO.escuro.indices).toMatchObject({ accent: 3, hover: 2 });
    expect(razaoDeContraste("#07110b", "#83e6a3")).toBeGreaterThanOrEqual(4.5);
    expect(razaoDeContraste("#f4f7f8", "#0b1115")).toBeGreaterThanOrEqual(7);
  });

  it("mantém estados distinguíveis e contidos no tema escuro", () => {
    expect(PALETTES.sage.states.dark).toEqual({
      success: "#83e6a3",
      warning: "#e0aa62",
      error: "#e78378",
      info: "#72aee6",
    });
  });

  it("oferece a camada de superfície suave usada pelo Kanban", () => {
    // Escrito contra `tailwind.config.ts` (`colors.surface.muted`), que a
    // v1.34.0 apagou: o Tailwind 4 pôs a config dentro do CSS. O contrato é o
    // mesmo — `bg-surface-muted` tem de ser a mesma camada de
    // `bg-surface-elevated` —, só mudou onde ele mora, e agora mora no
    // `@theme inline` de `app/globals.css`.
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    const blocoTema = css.match(/@theme inline \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(blocoTema).toContain("--color-surface-muted: var(--color-surface-elevated);");
  });
});
