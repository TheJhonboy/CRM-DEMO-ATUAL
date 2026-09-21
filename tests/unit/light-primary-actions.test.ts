import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const actionFiles = [
  "app/app/templates/_components/TemplatesClient.tsx",
  "app/app/webhooks/_components/SourcesTab.tsx",
  "app/app/kanban/_client.tsx",
  "app/app/ai/routers/_client.tsx",
  "app/app/settings/tenant/pipelines/_mapping.tsx",
  "app/app/settings/tenant/pipelines/_client.tsx",
];

describe("ações principais no modo claro", () => {
  it.each(actionFiles)(
    "usa o verde-floresta sem alterar o tom já aprovado no escuro: %s",
    (file) => {
      const source = fs.readFileSync(path.join(root, file), "utf8");

      expect(source).toContain("bg-accent text-accent-foreground hover:bg-accent-hover");
      expect(source).toMatch(/dark:bg-accent-(?:500|600)/);
    },
  );
});
