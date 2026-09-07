import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const cliente = fs.readFileSync(path.join(process.cwd(), "app/app/settings/tenant/pipelines/_client.tsx"), "utf8");
const mapeamento = fs.readFileSync(path.join(process.cwd(), "app/app/settings/tenant/pipelines/_mapping.tsx"), "utf8");

describe("ações de salvar a configuração de funis", () => {
  it("usa verde claro quando cada botão está disponível", () => {
    const classe = "bg-accent-500 text-text hover:bg-accent-600";
    expect(cliente).toContain(classe);
    expect(mapeamento).toContain(classe);
  });
});
