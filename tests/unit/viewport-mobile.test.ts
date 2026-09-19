import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

/**
 * O celular já recebe `<meta name="viewport" content="width=device-width, initial-scale=1">`
 * SEM o app fazer nada: o Next parte de `createDefaultViewport()` (que já traz
 * `width: "device-width"` e `initialScale: 1`) e mescla o `viewport` exportado por
 * `app/layout.tsx` por cima. Por isso o export do layout não repete esses dois campos.
 *
 * Este arquivo guarda o que NÃO pode entrar nesse export (zoom travado, `viewport-fit`) e
 * fixa a premissa de que o padrão do Next continua entregando `device-width` — se um upgrade
 * do Next mudar o padrão, o caso de baixo quebra e alguém precisa voltar a declarar o campo.
 */
describe("viewport mobile do layout raiz", () => {
  it("o padrão do Next já entrega width=device-width e initialScale=1 (por isso o layout não os repete)", async () => {
    const { createDefaultViewport } = await import("next/dist/lib/metadata/default-metadata");
    const padrao = createDefaultViewport();
    expect(padrao.width).toBe("device-width");
    expect(padrao.initialScale).toBe(1);
  });

  it("não liga viewport-fit=cover — com ele só a inset inferior é compensada e os banners do topo (impersonação, conexão caída) iriam para trás da barra de status", () => {
    const src = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");
    expect(src).not.toMatch(/viewportFit\s*:/);
  });

  it("não trava o zoom — maximumScale/userScalable travariam WCAG 2.1.4.4", () => {
    const src = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");
    expect(src).not.toContain("maximumScale");
    expect(src).not.toContain("userScalable");
  });
});
