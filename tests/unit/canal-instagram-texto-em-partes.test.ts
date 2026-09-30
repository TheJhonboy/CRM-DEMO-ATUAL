import { describe, expect, it } from "vitest";

import { dividirTextoEmPartes, LIMITE_DE_BYTES } from "@/lib/channels/instagram/texto";

const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("dividirTextoEmPartes", () => {
  it("limite e 1000 bytes", () => expect(LIMITE_DE_BYTES).toBe(1000));

  it("texto de exatamente 1000 bytes: uma parte, intacta", () => {
    const t = "a".repeat(1000);
    expect(dividirTextoEmPartes(t)).toEqual([t]);
  });

  it("1001 bytes: duas partes, nenhuma passa de 1000", () => {
    const t = "a".repeat(1001);
    const p = dividirTextoEmPartes(t);
    expect(p.length).toBe(2);
    expect(p.every((x) => bytes(x) <= 1000)).toBe(true);
    expect(p.join("")).toBe(t);
  });

  it("texto vazio: uma parte vazia (o adapter decide)", () => {
    expect(dividirTextoEmPartes("")).toEqual([""]);
  });

  it("acentos na borda: 999 bytes + 'é' (2 bytes) nao e cortado ao meio", () => {
    const t = "a".repeat(999) + "é" + "b".repeat(10);
    const p = dividirTextoEmPartes(t);
    expect(p.every((x) => bytes(x) <= 1000)).toBe(true);
    expect(p.join("")).toBe(t);
    for (const x of p) expect(x).not.toContain("�");
  });

  it("emoji (par substituto, 4 bytes) na borda: nunca parte o ponto de codigo", () => {
    for (const pad of [996, 997, 998, 999, 1000]) {
      const t = "a".repeat(pad) + "😀".repeat(5) + "zz";
      const p = dividirTextoEmPartes(t);
      expect(p.every((x) => bytes(x) <= 1000)).toBe(true);
      expect(p.join("")).toBe(t);
      for (const x of p) {
        expect(x).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
        expect(x).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      }
    }
  });

  it("so emojis longos: todas as partes <= 1000 bytes e juntas reconstroem o texto", () => {
    const t = "😀".repeat(700);
    const p = dividirTextoEmPartes(t);
    expect(p.length).toBeGreaterThan(2);
    expect(p.every((x) => bytes(x) <= 1000)).toBe(true);
    expect(p.join("")).toBe(t);
  });

  it("prefere limite de paragrafo", () => {
    const p1 = "Primeiro paragrafo. ".repeat(30).trim(); // ~600 bytes
    const p2 = "Segundo paragrafo. ".repeat(30).trim();
    const p = dividirTextoEmPartes(`${p1}\n\n${p2}`);
    expect(p).toEqual([p1, p2]);
  });

  it("sem paragrafo, prefere fim de frase", () => {
    const frase = "Esta e uma frase de tamanho razoavel para o teste.";
    const t = Array.from({ length: 40 }, () => frase).join(" ");
    const p = dividirTextoEmPartes(t);
    expect(p.length).toBeGreaterThan(1);
    for (const x of p) {
      expect(bytes(x)).toBeLessThanOrEqual(1000);
      expect(x.endsWith(".")).toBe(true);
    }
  });

  it("sem pontuacao, corta em espaco (sem partir palavra)", () => {
    const t = Array.from({ length: 400 }, (_, i) => `palavra${i}`).join(" ");
    const p = dividirTextoEmPartes(t);
    const palavras = new Set(t.split(" "));
    for (const x of p) {
      expect(bytes(x)).toBeLessThanOrEqual(1000);
      for (const w of x.split(" ")) expect(palavras.has(w)).toBe(true);
    }
  });

  it("palavra gigante sem espaco: corte duro, ainda <= 1000 e sem perda", () => {
    const t = "x".repeat(2500);
    const p = dividirTextoEmPartes(t);
    expect(p.length).toBe(3);
    expect(p.join("")).toBe(t);
  });
});
