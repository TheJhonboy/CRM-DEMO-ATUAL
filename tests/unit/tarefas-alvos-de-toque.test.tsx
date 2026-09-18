/**
 * Dois defeitos de toque encontrados na auditoria:
 *
 *  1. O checkbox de concluir era 16px (h-4 w-4) — abaixo de qualquer alvo de
 *     toque confortável. Agora o desenho tem 24px e a ÁREA de toque 44px (um
 *     pseudo-elemento `after:` que se estende 10px para cada lado); a partir de
 *     md volta ao desenho de 16px e o pseudo-elemento coincide com o botão.
 *  2. Editar/apagar só apareciam em `:hover` — em toque não existe hover, e em
 *     alguns navegadores móveis esses botões ficavam praticamente
 *     inalcançáveis. Abaixo de md ficam sempre visíveis, e com o tamanho padrão
 *     do `Button` (44px); a partir de md voltam ao comportamento de mouse de
 *     hoje (28px, revelados no hover).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { ListaDeTarefas } from "@/app/app/tasks/_components/ListaDeTarefas";
import type { Tarefa } from "@/lib/tarefas/tipos";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

const TAREFA: Tarefa = {
  id: "t-1",
  organization_id: "org-1",
  title: "Ligar para a Joana",
  description: null,
  due_date: null,
  priority: "medium",
  status: "pending",
  lead_id: null,
  contact_id: null,
  assigned_to: null,
  created_by: null,
  created_at: "2026-01-01T10:00:00.000Z",
  updated_at: "2026-01-01T10:00:00.000Z",
};

function montar(over: Partial<ComponentProps<typeof ListaDeTarefas>> = {}) {
  const props = {
    tarefas: [TAREFA],
    podeEditar: true,
    aoAlternarConcluida: vi.fn(async () => undefined),
    aoEditar: vi.fn(),
    aoApagar: vi.fn(async () => undefined),
    ...over,
  };
  render(<ListaDeTarefas {...props} />);
  return props;
}

describe("Tarefas — alvos de toque no celular", () => {
  it("o checkbox tem desenho de 24px e área de toque de 44px no celular, 16px a partir de md", () => {
    montar();
    const caixa = screen.getByRole("checkbox", { name: "Marcar como concluída" });
    expect(caixa).toHaveClass("h-6", "w-6", "md:h-4", "md:w-4");
    expect(caixa).toHaveClass("relative", "after:absolute", "after:-inset-2.5", "md:after:inset-0");
  });

  it("tocar no checkbox conclui a tarefa", () => {
    const props = montar();
    fireEvent.click(screen.getByRole("checkbox", { name: "Marcar como concluída" }));
    expect(props.aoAlternarConcluida).toHaveBeenCalledWith(TAREFA);
  });

  it("editar/apagar ficam sempre visíveis no celular — o hover só existe a partir de md", () => {
    montar();
    const acoes = screen.getByRole("button", { name: "Editar a tarefa" }).parentElement!;
    expect(acoes).toHaveClass(
      "opacity-100",
      "md:opacity-0",
      "md:focus-within:opacity-100",
      "md:group-hover:opacity-100",
    );
    expect(acoes).not.toHaveClass("opacity-0");
  });

  it("os botões não carregam tamanho fixo abaixo de md — herdam os 44px do Button", () => {
    montar();
    for (const nome of ["Editar a tarefa", "Apagar a tarefa"]) {
      const botao = screen.getByRole("button", { name: nome });
      expect(botao).toHaveClass("md:h-7", "md:w-7");
      expect(botao).not.toHaveClass("h-7");
      expect(botao).not.toHaveClass("w-7");
    }
  });

  it("apagar continua em dois toques, e o botão de confirmar também herda o tamanho de toque", () => {
    const props = montar();
    fireEvent.click(screen.getByRole("button", { name: "Apagar a tarefa" }));
    const confirmar = screen.getByRole("button", { name: "Confirmar" });
    expect(confirmar).toHaveClass("md:h-7", "md:px-2");
    expect(confirmar).not.toHaveClass("h-7");
    fireEvent.click(confirmar);
    expect(props.aoApagar).toHaveBeenCalledWith(TAREFA);
  });

  it("quem não pode editar não vê editar nem apagar", () => {
    montar({ podeEditar: false });
    expect(screen.queryByRole("button", { name: "Editar a tarefa" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apagar a tarefa" })).toBeNull();
  });
});
