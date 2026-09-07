import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const raiz = process.cwd();
const agenda = fs.readFileSync(path.join(raiz, "app/app/agenda/_client.tsx"), "utf8");
const historico = fs.readFileSync(path.join(raiz, "components/agenda/HistoricoDaAgenda.tsx"), "utf8");

describe("ações visuais da Agenda", () => {
  it("usa azul nas ações e seleções de agendamento", () => {
    expect(agenda).toContain('className="border border-info/30 bg-info-bg text-info-fg hover:bg-info/20 hover:text-info-fg"');
    expect(agenda).toContain('? "bg-info-bg font-semibold text-info-fg"');
    expect(historico).toContain('? "bg-info-bg font-semibold text-info-fg"');
  });
});
