import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { BulkActionBar } from "@/components/kanban/BulkActionBar";

/**
 * A barra em lote nascia `sticky bottom-4`, e o `<main>` do AppShell é o
 * ancestral rolável dela (`overflow-auto`) — só que o `<main>` NUNCA rola: quem
 * rola é o documento. Um `sticky` cujo ancestral rolável não rola não gruda em
 * nada; a barra ficava no FIM do quadro, com 0px na tela num funil comprido
 * (medido em 375, 390, 414 e 1280).
 *
 * No celular a barra inferior fixa (`--bottom-nav-h`) ainda cobria parte dela.
 * Abaixo de md ela vira `fixed`, 16px acima da barra de abas; a partir de md
 * segue `sticky bottom-4`, como sempre foi. O espaçador no fim da página deixa
 * os últimos cards rolarem para cima da barra fixa.
 *
 * ⚠️ Este arquivo só afirma NOMES de classe. Que o CSS de cada uma seja emitido
 * e vença a cascata foi medido à parte, com o Tailwind do repo e um Chromium
 * real (ver o relatório do Task 9) — teste de classe não prova isso.
 */

vi.mock("@/hooks/kanban/useBulkAction", () => ({
  useBulkAction: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useUser: () => ({ id: "u-1" }),
  useActiveOrg: () => ({ orgId: "org-1", role: "agent" }),
}));
vi.mock("@/hooks/inbox/useAssignableMembers", () => ({
  useAssignableMembers: () => ({ data: [] }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function renderBarra(selectedIds: string[]) {
  return render(
    <BulkActionBar
      selectedIds={selectedIds}
      stages={[]}
      pipelineId="p-1"
      tagsExistentes={[]}
      onClear={vi.fn()}
    />,
  );
}

// A barra de antes (de md para cima) e o que esta tarefa acrescentou (só abaixo de md).
const BASE_DE_MD =
  "sticky bottom-4 z-30 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 shadow-md";
const SO_ABAIXO_DE_MD =
  "max-md:fixed max-md:inset-x-0 max-md:bottom-[calc(var(--bottom-nav-h)+1rem)]";

const barra = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-lote-selecionados]");
const reserva = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-lote-reserva]");

describe("barra em lote — fixa acima da barra inferior no celular", () => {
  it("abaixo de md fica fixa, centrada e 16px acima da barra de abas", () => {
    const { container } = renderBarra(["l-1", "l-2"]);
    expect(barra(container)).toHaveClass(...SO_ABAIXO_DE_MD.split(" "));
  });

  it("a partir de md continua exatamente a barra de antes: as mesmas classes, na mesma ordem, e só as três de abaixo de md a mais", () => {
    const { container } = renderBarra(["l-1", "l-2"]);
    // O literal inteiro (como em painel-de-chamada-acima-da-barra.test.ts): perder `flex`
    // deixaria `flex-wrap` inerte e perder `bg-surface` deixaria a barra flutuante
    // transparente sobre os cards — nenhuma das duas cairia num `toHaveClass` parcial.
    expect(barra(container)?.className).toBe(`${BASE_DE_MD} ${SO_ABAIXO_DE_MD}`);
  });

  it("o deslocamento de baixo lê a fonte única --bottom-nav-h, sem número fixo", () => {
    const { container } = renderBarra(["l-1"]);
    const classes = (barra(container) as HTMLElement).className.split(/\s+/);
    const bottoms = classes.filter((c) => /(^|:)bottom-/.test(c));
    // as duas: o `bottom-4` de md+ e o `max-md:` que sobe a altura da barra de abas
    expect(bottoms.sort()).toEqual(["bottom-4", "max-md:bottom-[calc(var(--bottom-nav-h)+1rem)]"]);
    // nada de 4rem / bottom-16 / bottom-20 chumbado: a altura da barra de abas tem UM dono
    expect((barra(container) as HTMLElement).className).not.toMatch(/4rem|bottom-(16|20|24)\b/);
  });

  it("um espaçador escondido dos leitores de tela reserva a folga no fim da página só abaixo de md", () => {
    const { container } = renderBarra(["l-1", "l-2"]);
    const espaco = reserva(container);
    expect(espaco).not.toBeNull();
    expect(espaco).toHaveAttribute("aria-hidden", "true");
    // `h-44` (176px): a folga entre o último card e a barra ao fim da rolagem é
    // `altura do bloco + 49px − altura da barra`; com a barra de 166px (320 e 360, três
    // linhas) sobram 59px e com texto ampliado a 125% (barra de 199px) ainda sobram 26px.
    // O `h-32` anterior (128px) não bastava com texto ampliado.
    // `shrink-0`: a raiz da página é `flex h-full flex-col` e o quadro tem `h-full`
    // (base = a altura inteira da raiz). Sem `shrink-0` o espaçador cedia parte da altura
    // ao quadro (medido em 375 com `h-32`: ficava com 59px no funil curto e 106px no longo)
    // e as colunas do quadro esticavam até 69px de espaço vazio ao selecionar.
    expect(espaco).toHaveClass("h-44", "shrink-0", "md:hidden");
    // colado logo depois da barra: é o que fica no fim do fluxo da página
    expect(barra(container)?.nextElementSibling).toBe(espaco);
  });

  it("sem seleção não renderiza nem a barra nem o espaçador", () => {
    const { container } = renderBarra([]);
    expect(barra(container)).toBeNull();
    expect(reserva(container)).toBeNull();
    expect(container.innerHTML).toBe("");
  });
});
