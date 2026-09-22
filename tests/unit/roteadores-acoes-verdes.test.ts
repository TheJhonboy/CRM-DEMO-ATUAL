import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const fonte = fs.readFileSync(path.join(process.cwd(), "app/app/ai/routers/_client.tsx"), "utf8");

describe("ações principais de roteadores", () => {
  it("usa o verde Calixto nos dois caminhos de criação", () => {
    expect(
      fonte.match(
        /bg-accent text-accent-foreground hover:bg-accent-hover dark:bg-accent-600 dark:hover:bg-accent-700/g,
      ),
    ).toHaveLength(2);
  });
});
