import { describe, expect, it } from "vitest";

import { PALETTES } from "@/app/design/lib/tokens";
import { razaoDeContraste } from "@/lib/branding/contraste";
import { REGUA_DO_PRODUTO } from "@/lib/branding/regua-do-produto";

describe("tema claro profissional do Calixto", () => {
  it("usa off-white, branco e neutros esverdeados na hierarquia de superfícies", () => {
    expect(PALETTES.sage.surfaces.light).toEqual({
      bg: "#f3f4f3",
      surface: "#ffffff",
      surfaceElevated: "#fafaf9",
      text: "#121714",
      textMuted: "#606863",
      border: "#e3e6e3",
    });

    expect(PALETTES.sage.neutralLight).toEqual({
      50: "#fafbfa",
      100: "#f5f6f4",
      200: "#eceeec",
      300: "#d7dcd8",
      400: "#b7bdb9",
      500: "#929a95",
      600: "#606863",
      700: "#49514c",
      800: "#26342c",
      900: "#121714",
      950: "#0d3115",
    });

    expect(REGUA_DO_PRODUTO.claro.base).toEqual([
      { chave: "--color-bg", hex: "#f3f4f3" },
      { chave: "--color-surface", hex: "#ffffff" },
      { chave: "--color-surface-elevated", hex: "#fafaf9" },
    ]);
  });

  it("usa verde-floresta acessível como ação principal", () => {
    expect(PALETTES.sage.accent[700]).toBe("#21744b");
    expect(PALETTES.sage.accent[800]).toBe("#17623e");
    expect(REGUA_DO_PRODUTO.claro.indices).toMatchObject({ accent: 7, hover: 8 });
    expect(razaoDeContraste("#ffffff", "#21744b")).toBeGreaterThanOrEqual(4.5);
    expect(razaoDeContraste("#121714", "#f3f4f3")).toBeGreaterThanOrEqual(7);
  });

  it("mantém estados claros suaves e distinguíveis", () => {
    expect(PALETTES.sage.states.light).toEqual({
      success: "#247047",
      warning: "#896315",
      error: "#a84343",
      info: "#466473",
    });
  });
});
