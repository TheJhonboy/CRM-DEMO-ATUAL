/**
 * O AVISO DE FALHA DO PAINEL DE CHAMADA PRECISA SER LEGÍVEL E TOCÁVEL.
 *
 * Medido num Chromium real (em toda largura, não só no celular): "Não consegui abrir
 * o áudio. Confira o microfone." precisa de 235px, mas era um `<span class="truncate">`
 * numa linha flex de uma linha só, com o botão "Tentar de novo" (`shrink-0`, 77px) ao
 * lado — sobravam 36px (52px em 1280): a frase virava "Não c…" e quem estava com o
 * microfone bloqueado não lia o que fazer. O botão, com 77×16,5px, também não era um
 * alvo tocável.
 *
 * Aqui o painel REAL é montado (do mesmo jeito que `voz-painel-diz-onde-esta-o-audio`)
 * no estado de falha de mídia, e as classes são conferidas nos elementos renderizados.
 * O que o CSS faz com elas foi medido no navegador — um teste de classe não prova
 * que o CSS existe, só que ninguém apagou a classe.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessao = vi.hoisted(() => ({ valor: {} as Record<string, unknown> }));
vi.mock("@/components/voice/VoiceCallContext", () => ({ useVoiceCall: () => sessao.valor }));
vi.mock("@/hooks/contacts/useContact", () => ({ useContact: () => ({ data: undefined }) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));

import { ActiveCallPanel } from "@/components/voice/ActiveCallPanel";

function emLigacao(over: Record<string, unknown> = {}) {
  sessao.valor = {
    call: {
      id: "c1",
      contact_id: null,
      direction: "outbound",
      peer_phone: "553198966398",
      status: "ringing",
      answered_at: null,
    },
    muted: false,
    connectingMedia: false,
    estadoDaMidia: "falhou",
    midiaEmOutraAba: false,
    encerrando: false,
    toggleMute: vi.fn(),
    hangUp: vi.fn(),
    ouvirAqui: vi.fn(),
    ...over,
  };
  render(<ActiveCallPanel />);
}

beforeEach(() => vi.clearAllMocks());

describe("aviso de falha de mídia do painel de chamada — legível", () => {
  it("a frase de falha quebra de linha em vez de virar reticências, e a linha do aviso pode quebrar", () => {
    emLigacao();
    const aviso = screen.getByRole("status");
    const frase = screen.getByText("Não consegui abrir o áudio. Confira o microfone.");

    // A linha deixa o botão descer para baixo da frase quando não cabe ao lado dela.
    expect(aviso).toHaveClass("flex", "flex-wrap", "items-center", "gap-1", "text-[11px]");
    // O aviso grave continua destrutivo (a cor não mudou).
    expect(aviso).toHaveClass("font-medium", "text-destructive");

    // A frase é um item flexível que pode encolher (`min-w-0`), ocupa o que sobra
    // (`flex-1`) a partir de uma base pequena (`basis-24`, 6rem) — sem `truncate`.
    expect(frase).toBe(aviso.querySelector("span:not([class~='sr-only'])"));
    expect(frase).toHaveClass("min-w-0", "flex-1", "basis-24");
    expect(frase).not.toHaveClass("truncate");
  });

  it("o aviso que não é grave também quebra, e continua na cor discreta", () => {
    emLigacao({ midiaEmOutraAba: true, estadoDaMidia: "ociosa" });
    const aviso = screen.getByRole("status");
    const frase = screen.getByText("O áudio desta ligação está em outra aba");

    expect(aviso).toHaveClass("flex-wrap", "text-muted-foreground");
    expect(aviso).not.toHaveClass("text-destructive");
    expect(frase).toHaveClass("min-w-0", "flex-1", "basis-24");
    expect(frase).not.toHaveClass("truncate");
  });
});

describe("aviso de falha de mídia do painel de chamada — ação tocável", () => {
  it("o botão 'Tentar de novo' ganha área de toque de ~44px sem crescer o desenho", () => {
    emLigacao();
    const botao = screen.getByRole("button", { name: "Tentar de novo" });

    // O texto do botão tem 16,5px de altura (medido); o pseudo-elemento se estende 14px
    // para cima e para baixo (`after:-inset-y-3.5`): 16,5 + 2×14 = 44,5px. Na horizontal,
    // 8px de cada lado (`after:-inset-x-2`), que cabem no vão de `gap-3` até os botões.
    // `relative` é o que ancora o `after:absolute` ao botão.
    expect(botao).toHaveClass("relative", "after:absolute", "after:-inset-x-2", "after:-inset-y-3.5");
    expect(botao).toHaveClass("after:content-['']");
    // O que já era dele continua sendo.
    expect(botao).toHaveClass("ml-1", "shrink-0", "font-semibold", "text-foreground", "underline");
  });
});

/**
 * A POSIÇÃO do painel, ancorada ao elemento renderizado (`role="region"`) e não ao texto do
 * fonte: `painel-de-chamada-acima-da-barra.test.ts` confere o literal inteiro no arquivo; este
 * confere que as classes que fazem o painel subir acima da barra chegam ao elemento certo.
 */
describe("posição do painel de chamada", () => {
  it("o painel sobe a altura da barra inferior no celular e volta a bottom-4 a partir de md", () => {
    emLigacao();
    const painel = screen.getByRole("region");

    // `--bottom-nav-h` é a mesma variável da barra e do <main>; `+1rem` é o respiro de 16px
    // acima dela. A partir de md a barra some e o painel volta ao `bottom-4` de sempre.
    expect(painel).toHaveClass("fixed", "bottom-[calc(var(--bottom-nav-h)+1rem)]", "md:bottom-4");
  });
});
