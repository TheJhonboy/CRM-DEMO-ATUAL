import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { ThemeProvider, STORAGE_KEY } from "@/lib/theme";

/**
 * `ThemeToggle` não tem mais o próprio guard de hidratação (`mounted` via
 * `useSyncExternalStore`): o conserto real mora em `lib/theme.tsx`
 * (`getTemaSnapshotDoServidor`), medido por `lib/theme.test.tsx`. Guard aqui
 * em cima seria redundante — e discordava, porque um mostrava "Alternar tema"
 * (neutro) e o outro "Tema: system" (o valor determinístico do servidor) para
 * a MESMA renderização.
 *
 * Este arquivo continua existindo porque cobre a MESMA propriedade por outra
 * porta: `renderToStaticMarkup` com `window` presente e um tema JÁ salvo no
 * `localStorage` (o estado de quem volta ao site) não pode vazar esse tema
 * salvo para a primeira passada — que é exatamente o `getServerSnapshot`
 * garantindo "system" mesmo com "light" gravado.
 */
describe("ThemeToggle", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
  });

  afterEach(() => window.localStorage.clear());

  it("a primeira passada não vaza o tema salvo no localStorage", () => {
    window.localStorage.setItem(STORAGE_KEY, "light");

    const html = renderToStaticMarkup(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(html).toContain('aria-label="Tema: system. Cmd+Shift+L para alternar."');
    expect(html).not.toContain("Tema: light");
  });
});
