import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const cliente = fs.readFileSync(path.join(process.cwd(), "app/app/settings/tenant/pipelines/_client.tsx"), "utf8");
const mapeamento = fs.readFileSync(path.join(process.cwd(), "app/app/settings/tenant/pipelines/_mapping.tsx"), "utf8");

describe("ações de salvar a configuração de funis", () => {
  it("usa verde claro quando cada botão está disponível", () => {
    // O par de cores (rótulo x fundo, nos dois temas) é medido em light-primary-actions.test.ts;
    // aqui só se prende que os dois botões seguem a receita do verde do Calixto.
    const classe = "bg-accent text-accent-foreground hover:bg-accent-hover";
    expect(cliente).toContain(classe);
    expect(mapeamento).toContain(classe);
  });
});
