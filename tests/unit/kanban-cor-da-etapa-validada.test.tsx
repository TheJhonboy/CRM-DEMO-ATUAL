import { DragDropContext } from "@hello-pangea/dnd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/kanban/KanbanCardActions", () => ({
  KanbanCardActions: () => <span />,
}));

import { StageColumn } from "@/components/kanban/StageColumn";
import type { Stage } from "@/lib/kanban/types";

/**
 * A COR DA ETAPA É VALIDADA NO CÓDIGO, NÃO SÓ NO BANCO
 * (auditoria de 21/09/2026, nota sobre `components/kanban/StageColumn.tsx`).
 *
 * `stage.color` é valor do BANCO e entra em `color-mix(in srgb, <cor> 28%, …)` no
 * `style` do cabeçalho. Hoje a CHECK `crm_stages_color_format`
 * (`^#[0-9a-fA-F]{6}$`) fecha o caminho — mas o componente não deve depender de
 * uma constraint de schema para não deixar um valor arbitrário virar CSS: uma
 * migration que afrouxe a CHECK, ou uma linha gravada por fora dela, passaria a
 * injetar declaração no atributo `style`.
 *
 * A regra: usa `stage.color` só quando `ehHexValido` a aceita (já normalizada em
 * `#rrggbb`); o resto cai no fallback que etapa sem cor já tinha,
 * `var(--color-border-strong)`.
 */

const FALLBACK = "var(--color-border-strong)";

function etapa(color: string | null): Stage {
  return {
    id: "stage-1",
    organization_id: "org-1",
    pipeline_id: "pipeline-1",
    name: "Qualificação",
    slug: "qualificacao",
    position: 1,
    color,
    is_won: false,
    is_lost: false,
    is_archived: false,
    expected_duration_hours: null,
  };
}

function renderizar(color: string | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <DragDropContext onDragEnd={() => undefined}>
        <StageColumn stage={etapa(color)} leads={[]} pipelineId="pipeline-1" />
      </DragDropContext>
    </QueryClientProvider>,
  );
  const cabecalho = screen.getByRole("heading", { name: "Qualificação" }).parentElement!;
  const ponto = cabecalho.querySelector("span[aria-hidden]") as HTMLElement;
  return { cabecalho, ponto };
}

describe("StageColumn — cor da etapa", () => {
  it("hex válido segue como antes: vai inteiro para o acento e para o color-mix", () => {
    const { cabecalho } = renderizar("#1a2b3c");
    expect(cabecalho.style.getPropertyValue("--stage-accent")).toBe("#1a2b3c");
    expect(cabecalho.style.getPropertyValue("--stage-header-bg")).toBe(
      "color-mix(in srgb, #1a2b3c 28%, var(--color-surface))",
    );
  });

  it("hex de 3 dígitos ou maiúsculo entra normalizado em #rrggbb", () => {
    expect(renderizar("#ABC").cabecalho.style.getPropertyValue("--stage-accent")).toBe("#aabbcc");
  });

  it("etapa sem cor segue no fallback, como antes", () => {
    const { cabecalho, ponto } = renderizar(null);
    expect(cabecalho.style.getPropertyValue("--stage-accent")).toBe(FALLBACK);
    expect(cabecalho.style.getPropertyValue("--stage-header-bg")).toBe(
      `color-mix(in srgb, ${FALLBACK} 28%, var(--color-surface))`,
    );
    expect(ponto).toHaveClass("bg-text-muted/40");
  });

  it.each([
    ["declaração pendurada", "red;background:url(x)"],
    ["cor nomeada", "red"],
    ["hex curto demais (5 dígitos)", "#12345"],
    ["hex longo demais (7 dígitos)", "#1234567"],
    ["hex com caractere fora da base 16", "#12345g"],
    ["função CSS", "expression(alert(1))"],
    ["url()", "url(https://exemplo.invalid/x.png)"],
    ["var() apontando para outra coisa", "var(--x)"],
    ["hex seguido de declaração", "#1a2b3c;background:url(x)"],
    ["string vazia", ""],
  ])("valor inválido (%s) cai no fallback e não chega ao atributo style", (_nome, valor) => {
    const { cabecalho, ponto } = renderizar(valor);

    expect(cabecalho.style.getPropertyValue("--stage-accent")).toBe(FALLBACK);
    expect(cabecalho.style.getPropertyValue("--stage-header-bg")).toBe(
      `color-mix(in srgb, ${FALLBACK} 28%, var(--color-surface))`,
    );

    const estiloDoCabecalho = cabecalho.getAttribute("style") ?? "";
    const estiloDoPonto = ponto.getAttribute("style") ?? "";
    for (const trecho of ["url(", "expression(", "alert(", "red", "#12345", "var(--x)"]) {
      expect(estiloDoCabecalho, `style do cabeçalho carrega "${trecho}"`).not.toContain(trecho);
      expect(estiloDoPonto, `style do ponto carrega "${trecho}"`).not.toContain(trecho);
    }
  });

  it("a geometria mobile da coluna (snap e largura) não mudou", () => {
    renderizar("#1a2b3c");
    const coluna = screen.getByRole("heading", { name: "Qualificação" }).parentElement!.parentElement!;
    for (const classe of ["w-[85vw]", "shrink-0", "snap-center", "md:w-80"]) {
      expect(coluna, `perdeu a classe ${classe}`).toHaveClass(classe);
    }
  });
});
