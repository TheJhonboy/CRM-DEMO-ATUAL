import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

/**
 * Sem nenhuma classe responsiva, a coluna de 320px fixos virava scroll
 * horizontal cru no celular — sem indicar onde uma etapa termina e a
 * próxima começa. scroll-snap com largura de ~85vw dá a sensação de
 * "arrastar para a próxima etapa"; a partir de md volta a ser exatamente
 * o board de hoje (w-80, sem snap).
 */
describe("Kanban — colunas no celular", () => {
  it("a coluna real tem ~85vw com snap no celular, 320px sem snap a partir de md", () => {
    const src = fs.readFileSync(path.join(RAIZ, "components/kanban/StageColumn.tsx"), "utf8");
    expect(src).toContain(
      'className="flex w-[85vw] shrink-0 snap-center flex-col rounded-lg border border-border bg-surface-muted/40 md:w-80 md:snap-none"',
    );
  });

  it("o contêiner do board ativa snap-x só no celular", () => {
    const src = fs.readFileSync(path.join(RAIZ, "components/kanban/KanbanBoard.tsx"), "utf8");
    expect(src).toContain(
      'className="flex h-full snap-x snap-mandatory gap-3 overflow-x-auto p-4 md:snap-none"',
    );
  });

  it("o skeleton de carregamento usa a mesma largura da coluna real — sem isto o board 'pula' quando os dados chegam", () => {
    const src = fs.readFileSync(path.join(RAIZ, "components/kanban/KanbanBoard.tsx"), "utf8");
    expect(src).toContain(
      'className="flex snap-x snap-mandatory gap-3 overflow-x-auto p-4 md:snap-none"',
    );
    expect(src).toContain(
      'className="flex w-[85vw] shrink-0 snap-center flex-col gap-2 rounded-lg border border-border bg-surface-muted/40 p-3 md:w-80 md:snap-none"',
    );
  });
});
