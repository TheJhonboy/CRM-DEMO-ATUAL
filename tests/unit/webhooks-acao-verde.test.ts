import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const fonte = fs.readFileSync(
  path.join(process.cwd(), "app/app/webhooks/_components/SourcesTab.tsx"),
  "utf8",
);

describe("ação de criação de fonte", () => {
  it("usa o verde principal do Calixto", () => {
    expect(fonte).toContain(
      "bg-accent-600 text-accent-foreground hover:bg-accent-700",
    );
  });
});
