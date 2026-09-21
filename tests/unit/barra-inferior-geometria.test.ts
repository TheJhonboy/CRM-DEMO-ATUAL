import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const ler = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

/** Toda classe de todo `className="..."` literal — o que um comentário não consegue forjar. */
function classesLiterais(src: string): string[] {
  return [...src.matchAll(/className="([^"]*)"/g)].flatMap((m) => (m[1] ?? "").split(/\s+/));
}

/**
 * A altura da barra inferior do celular é reservada UMA vez, em
 * `--bottom-nav-h`, e lida por cinco consumidores: a própria barra, o padding de
 * baixo do <main>, a altura da grade do Inbox, o painel de chamada e a barra de
 * ações em lote. Se um deles voltar a um número solto (`h-16`, `pb-24`), as
 * contas deixam de fechar: a página ganha rolagem e o composer do Inbox fica
 * embaixo da barra. jsdom não calcula layout, então o que se prende aqui é o
 * texto — a medida real, no navegador, é da Task 7.
 */
describe("geometria da barra inferior do celular", () => {
  it("app/globals.css declara --bottom-nav-h com a área segura", () => {
    expect(ler("app/globals.css")).toContain(
      "--bottom-nav-h: calc(4rem + env(safe-area-inset-bottom))",
    );
  });

  it("o <main> do AppShell reserva a barra: padding normal + --bottom-nav-h, sem o pb-24 antigo", () => {
    const classes = classesLiterais(ler("app/app/_components/AppShell.tsx"));
    expect(classes).toContain("pb-[calc(var(--space-6)+var(--bottom-nav-h))]");
    expect(classes).toContain("md:pb-6");
    expect(classes).not.toContain("pb-24");
  });

  it("a grade do Inbox desconta a barra abaixo de md e mantém a conta antiga a partir dele", () => {
    const classes = classesLiterais(ler("components/inbox/InboxLayout.tsx"));
    expect(classes).toContain("h-[calc(100dvh-3.5rem-2*var(--space-6)-var(--bottom-nav-h))]");
    expect(classes).toContain("md:h-[calc(100dvh-3.5rem-2*var(--space-6))]");
    // Sem o prefixo `md:`, a conta antiga valeria também no celular e o defeito voltaria.
    expect(classes).not.toContain("h-[calc(100dvh-3.5rem-2*var(--space-6))]");
  });
});
