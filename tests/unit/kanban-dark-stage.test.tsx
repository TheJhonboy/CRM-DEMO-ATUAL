import { DragDropContext } from "@hello-pangea/dnd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/kanban/KanbanCardActions", () => ({
  KanbanCardActions: () => <span />,
}));

import { StageColumn } from "@/components/kanban/StageColumn";
import type { Stage } from "@/lib/kanban/types";
import type { Lead } from "@/lib/types/leads";

const STAGE: Stage = {
  id: "stage-1",
  organization_id: "org-1",
  pipeline_id: "pipeline-1",
  name: "Qualificação",
  slug: "qualificacao",
  position: 1,
  color: "#29496d",
  is_won: false,
  is_lost: false,
  is_archived: false,
  expected_duration_hours: null,
};

const LEAD = {
  id: "lead-1",
  organization_id: "org-1",
  pipeline_id: "pipeline-1",
  stage_id: "stage-1",
  contact_id: null,
  title: "Oficina Central",
  description: null,
  status: "open",
  lost_reason: null,
  position_in_stage: 1,
  value_cents: 250000,
  currency: "BRL",
  tags: [],
  last_activity_at: "2026-09-12T10:00:00.000Z",
  created_at: "2026-09-12T09:00:00.000Z",
  owner_kind: null,
  owner_user_id: null,
  owner_agent_id: null,
  owner_agent: null,
  next_action: null,
  score: null,
  assigned_at: null,
  expected_close_date: null,
  closed_at: null,
  source: "manual",
  source_metadata: {},
  external_id: null,
  custom_fields: {},
  updated_at: "2026-09-12T10:00:00.000Z",
  created_by_user_id: null,
} satisfies Lead;

function renderStage(leads: Lead[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DragDropContext onDragEnd={() => undefined}>
        <StageColumn stage={STAGE} leads={leads} pipelineId="pipeline-1" />
      </DragDropContext>
    </QueryClientProvider>,
  );
}

describe("identidade visual das colunas do kanban", () => {
  it("leva a cor da etapa para o cabeçalho inteiro, não apenas para um ponto", () => {
    renderStage([]);

    const cabecalho = screen.getByRole("heading", { name: "Qualificação" }).parentElement;
    expect(cabecalho).not.toBeNull();
    expect(cabecalho?.style.getPropertyValue("--stage-accent")).toBe("#29496d");
    expect(cabecalho?.style.getPropertyValue("--stage-header-bg")).toContain("color-mix");
  });

  it("mantém os cards internos numa camada elevada", () => {
    renderStage([LEAD]);

    expect(screen.getByRole("group", { name: "Lead: Oficina Central" })).toHaveClass(
      "dark:bg-surface-elevated",
    );
  });
});
