import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

/**
 * O painel de chamada é `fixed`, então a barra de navegação inferior do
 * celular (também `fixed`, z-30) ficava ABAIXO dele: durante uma chamada o
 * painel (z-50) cobria a aba "Mais". Abaixo de md ele sobe a altura da barra
 * (`--bottom-nav-h`, a mesma variável que a barra e o `<main>` usam); a
 * partir de md a barra some e o painel volta ao `bottom-4` de sempre.
 */
describe("painel de chamada acima da barra inferior", () => {
  it("sobe a altura da barra no celular e volta a bottom-4 a partir de md", () => {
    const src = fs.readFileSync(path.join(RAIZ, "components/voice/ActiveCallPanel.tsx"), "utf8");
    expect(src).toContain(
      'className="fixed bottom-[calc(var(--bottom-nav-h)+1rem)] right-4 z-50 flex w-[min(320px,calc(100%-2rem))] items-center gap-3 rounded-xl border border-border bg-popover p-3 shadow-2xl animate-in fade-in slide-in-from-bottom-4 md:bottom-4"',
    );
  });
});
