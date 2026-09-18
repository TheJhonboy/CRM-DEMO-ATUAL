import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

/**
 * Sem `width`/`initialScale` no viewport, o navegador mobile assume um
 * viewport de layout de ~980px e desenha a página inteira zerada — nenhuma
 * media query `md:` (768px) dispara de verdade num aparelho físico, mesmo
 * que o CSS responsivo já exista. Este é o defeito que faz toda a
 * responsividade já construída no produto (Sidebar, InboxLayout, semana da
 * Agenda) nunca aparecer fora do DevTools.
 */
describe("viewport mobile do layout raiz", () => {
  it("declara width=device-width e initialScale=1", () => {
    const src = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");
    expect(src).toContain('width: "device-width"');
    expect(src).toContain("initialScale: 1");
  });

  it("declara viewportFit=cover — necessário para env(safe-area-inset-bottom) da barra inferior", () => {
    const src = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");
    expect(src).toContain('viewportFit: "cover"');
  });

  it("não trava o zoom — maximumScale/userScalable travariam WCAG 2.1.4.4", () => {
    const src = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");
    expect(src).not.toContain("maximumScale");
    expect(src).not.toContain("userScalable");
  });
});
