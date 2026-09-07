import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const fonte = fs.readFileSync(path.join(process.cwd(), "app/app/kanban/_client.tsx"), "utf8");

describe("ação principal dos Funis", () => {
  it("usa o verde Calixto no botão Novo funil", () => {
    expect(fonte).toMatch(
      /data-testid="novo-funil"\s+className="w-full bg-accent-600 text-accent-foreground hover:bg-accent-700 sm:w-auto"/,
    );
  });
});
