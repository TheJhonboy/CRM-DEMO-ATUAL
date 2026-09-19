/**
 * Dois defeitos de toque encontrados na auditoria:
 *
 *  1. O checkbox de concluir era 16px (h-4 w-4) — abaixo de qualquer alvo de
 *     toque confortável. Agora o desenho tem 24px e a ÁREA de toque 44px: um
 *     pseudo-elemento `after:` que se estende 11px a partir da caixa de
 *     preenchimento (1px dentro da borda), 22px + 2×11px = 44px. Só com MOUSE
 *     (`md:pointer-fine:`) volta ao desenho de 16px e o pseudo-elemento coincide
 *     com o botão.
 *  2. Editar/apagar só apareciam em `:hover` — em toque não existe hover, e em
 *     alguns navegadores móveis esses botões ficavam praticamente
 *     inalcançáveis. Sem mouse ficam sempre visíveis, e com o tamanho padrão do
 *     `Button` (44px); com mouse (`md:pointer-fine:`) voltam ao comportamento de
 *     hoje (28px, revelados no hover).
 *
 * Por que o critério é o PONTEIRO e não só a largura (medido num Chromium real,
 * 768px com toque): o Tailwind v4 embrulha `group-hover:` em `@media (hover:hover)`,
 * que é falso em tela de toque. Com `md:opacity-0` sozinho, num tablet ≥768px o
 * grupo de ações ficava com `opacity:0` para sempre — invisível e ainda tocável
 * (`pointer-events:auto`), com botões de 28px e o checkbox de 16px sem área de
 * toque. Com `md:pointer-fine:`, ponteiro grosso (celular OU tablet) mantém
 * controles visíveis e do tamanho de toque em qualquer largura. Com MOUSE, o
 * tamanho de `lg` para cima continua vindo das variantes do `Button` — e é por
 * isso que a altura dos botões usa `md:max-lg:pointer-fine:`: uma variante
 * empilhada é emitida DEPOIS do `lg:h-9` do Button, então `md:pointer-fine:h-7`
 * puro passaria por cima dele com mouse a partir de 1024px (medido: 28×28 em
 * vez de 36×36; o Confirmar, 28 em vez de 32).
 *
 * Com TOQUE a partir de 1024px (iPad em paisagem) o `lg:h-9 lg:w-9` do Button
 * encolheria o alvo para 36px (o Confirmar, 32px). `pointer-coarse:lg:h-11
 * pointer-coarse:lg:w-11` o devolve aos 44px, como nos cartões de Contatos: a
 * variante composta é emitida DEPOIS do `lg:` puro e só vale sob
 * `(pointer: coarse)`, então o mouse não muda.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    vi.useRealTimers();
  });

  it("o checkbox tem desenho de 24px e área de toque de 44px em ponteiro grosso, 16px só com mouse a partir de md", () => {
    montar();
    const caixa = screen.getByRole("checkbox", { name: "Marcar como concluída" });
    expect(caixa).toHaveClass("h-6", "w-6", "md:pointer-fine:h-4", "md:pointer-fine:w-4");
    expect(caixa).toHaveClass(
      "relative",
      "after:absolute",
      "after:-inset-[11px]",
      "md:pointer-fine:after:inset-0",
    );
    // Sem o `pointer-fine:`, um tablet ≥768px voltaria ao checkbox de 16px sem área de toque.
    for (const semPonteiro of ["md:h-4", "md:w-4", "md:after:inset-0"]) {
      expect(caixa).not.toHaveClass(semPonteiro);
    }
  });

  it("tocar no checkbox conclui a tarefa", () => {
    const props = montar();
    fireEvent.click(screen.getByRole("checkbox", { name: "Marcar como concluída" }));
    expect(props.aoAlternarConcluida).toHaveBeenCalledWith(TAREFA);
  });

  it("editar/apagar ficam sempre visíveis em ponteiro grosso — o esconde-e-revela só vale com mouse, a partir de md", () => {
    montar();
    // A âncora é a LINHA (`.group`): é ela que faz o `group-hover:` funcionar, e a barra de
    // ações é o filho direto dela que contém os botões. `closest` acha a barra mesmo que um dia
    // o botão ganhe um invólucro, o que `parentElement` não pega.
    const acoes = screen.getByRole("button", { name: "Editar a tarefa" }).closest<HTMLElement>(".group > div");
    expect(acoes).not.toBeNull();
    if (!acoes) return;
    expect(acoes).toHaveClass(
      "opacity-100",
      "md:pointer-fine:opacity-0",
      "md:pointer-fine:focus-within:opacity-100",
      "md:pointer-fine:group-hover:opacity-100",
    );
    expect(acoes).not.toHaveClass("opacity-0");
    // Sem o `pointer-fine:`, o tablet ≥768px (onde `group-hover:` nunca dispara) escondia as ações para sempre.
    for (const semPonteiro of [
      "md:opacity-0",
      "md:focus-within:opacity-100",
      "md:group-hover:opacity-100",
    ]) {
      expect(acoes).not.toHaveClass(semPonteiro);
    }
  });

  it("os botões não carregam tamanho fixo em ponteiro grosso — herdam os 44px do Button", () => {
    montar();
    for (const nome of ["Editar a tarefa", "Apagar a tarefa"]) {
      const botao = screen.getByRole("button", { name: nome });
      // `max-lg:` e não `md:pointer-fine:h-7` puro: o Tailwind emite a variante empilhada DEPOIS do
      // `lg:h-9` do Button, e com mouse a partir de 1024px o 28px passaria por cima do 36px que
      // sempre valeu ali (medido: 28×28 em 1024 e 1280 em vez de 36×36). Limitado a md..lg, o
      // tamanho de lg para cima segue vindo do Button.
      expect(botao).toHaveClass("md:max-lg:pointer-fine:h-7", "md:max-lg:pointer-fine:w-7");
      // E em tablet de toque a partir de 1024px (iPad em paisagem) o `lg:h-9 lg:w-9` do Button
      // encolheria o alvo para 36px; `pointer-coarse:lg:` (composta, emitida DEPOIS do `lg:` puro)
      // o devolve aos 44px, igual aos cartões de Contatos.
      expect(botao).toHaveClass("pointer-coarse:lg:h-11", "pointer-coarse:lg:w-11");
      expect(botao).not.toHaveClass("md:pointer-fine:h-7");
      expect(botao).not.toHaveClass("md:pointer-fine:w-7");
      expect(botao).not.toHaveClass("md:h-7");
      expect(botao).not.toHaveClass("md:w-7");
      expect(botao).not.toHaveClass("h-7");
      expect(botao).not.toHaveClass("w-7");
      // E o que vale de fato vem do `size="icon"` do Button: 44px de toque, 36px de `lg` para
      // cima com mouse (com toque, o `pointer-coarse:lg:` acima o mantém em 44px). Estes tamanhos
      // só valiam POR AUSÊNCIA de um `h-7`; afirmá-los pega quem trocar o `size` do botão sem
      // perceber.
      expect(botao).toHaveClass("h-11", "w-11", "lg:h-9", "lg:w-9");
    }
  });

  it("apagar continua em dois toques, e o botão de confirmar também herda o tamanho de toque", () => {
    // Só o `Date` é falso: o `Confirmar` ignora cliques logo depois de armar (caso abaixo).
    vi.useFakeTimers({ toFake: ["Date"] });
    const props = montar();
    fireEvent.click(screen.getByRole("button", { name: "Apagar a tarefa" }));
    const confirmar = screen.getByRole("button", { name: "Confirmar" });
    // Mesma regra da altura dos botões acima: `max-lg:` mantém o `lg:h-8` do Button valendo de 1024 para cima.
    expect(confirmar).toHaveClass("md:max-lg:pointer-fine:h-7", "md:pointer-fine:px-2");
    // E o `lg:h-8` (32px) do Button não pode encolher o alvo em tablet de toque a partir de 1024px.
    expect(confirmar).toHaveClass("pointer-coarse:lg:h-11");
    expect(confirmar).not.toHaveClass("md:pointer-fine:h-7");
    expect(confirmar).not.toHaveClass("md:h-7");
    expect(confirmar).not.toHaveClass("md:px-2");
    expect(confirmar).not.toHaveClass("h-7");
    // O tamanho herdado do `size="sm"` do Button: 44px de toque, 32px de `lg` para cima com mouse
    // (com toque, o `pointer-coarse:lg:h-11` acima o mantém em 44px), `px-3`.
    expect(confirmar).toHaveClass("h-11", "px-3", "lg:h-8");
    vi.advanceTimersByTime(600);
    fireEvent.click(confirmar);
    expect(props.aoApagar).toHaveBeenCalledWith(TAREFA);
  });

  it("um segundo toque no mesmo lugar, logo depois de armar, NÃO apaga", () => {
    // No celular o lixo e o `Confirmar` têm 44px e ocupam o MESMO lugar: o toque duplo
    // reflexo (quando o primeiro parece não ter pegado) cairia em `Confirmar` e apagaria
    // sem confirmação nenhuma.
    vi.useFakeTimers({ toFake: ["Date"] });
    const props = montar();
    fireEvent.click(screen.getByRole("button", { name: "Apagar a tarefa" }));
    const confirmar = screen.getByRole("button", { name: "Confirmar" });
    fireEvent.click(confirmar);
    expect(props.aoApagar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    fireEvent.click(confirmar);
    expect(props.aoApagar).toHaveBeenCalledWith(TAREFA);
  });

  it("quem não pode editar não vê editar nem apagar, e o checkbox fica desabilitado sem concluir nada", () => {
    const props = montar({ podeEditar: false });
    expect(screen.queryByRole("button", { name: "Editar a tarefa" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apagar a tarefa" })).toBeNull();

    // O checkbox continua na linha (a tarefa é visível), mas a área de toque de 44px não pode
    // deixar quem não edita concluir a tarefa: desabilitado, e o toque não chama nada.
    const caixa = screen.getByRole("checkbox", { name: "Marcar como concluída" });
    expect(caixa).toBeDisabled();
    fireEvent.click(caixa);
    expect(props.aoAlternarConcluida).not.toHaveBeenCalled();
  });
});
