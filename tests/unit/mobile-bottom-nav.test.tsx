import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { MobileBottomNav } from "@/components/shell/MobileBottomNav";
import { razaoDeContraste } from "@/lib/branding/contraste";
import type { ActiveOrg, AuthUser } from "@/lib/auth/types";

const authRef: { user: Pick<AuthUser, "is_platform_admin">; activeOrg: ActiveOrg | null } = {
  user: { is_platform_admin: false },
  activeOrg: { orgId: "org-1", name: "Org", role: "admin" },
};

// Mesma receita de tests/unit/sidebar-grupos.test.tsx. O Sheet "Mais" só monta o
// `SidebarContent` quando aberto (o Radix Dialog não monta fechado); os casos da folha
// abaixo a abrem, então o `SidebarContent` precisa dos mesmos três mocks do teste do Sidebar.
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => authRef,
  usePermission: () => false,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/app/inbox",
}));
vi.mock("@/components/connections/ConnectionHealthDot", () => ({
  ConnectionHealthDot: () => null,
}));
vi.mock("@/app/actions/shell/toggleSidebar", () => ({
  toggleSidebar: vi.fn(),
}));
// Busca a versão via react-query; sem QueryClientProvider ele lança, e o rodapé de versão
// não é o que estes testes examinam.
vi.mock("@/components/shell/VersionFooter", () => ({
  VersionFooter: () => null,
}));

afterEach(cleanup);

/** As cinco abas da barra: os quatro links do sidebar e o botão Mais, na ordem em que aparecem. */
function abas(): HTMLElement[] {
  const nav = screen.getByRole("navigation", { name: "Navegação principal" });
  return [
    ...within(nav).getAllByRole("link"),
    within(nav).getByRole("button", { name: "Mais opções" }),
  ];
}

describe("barra de navegação inferior (mobile)", () => {
  it("mostra os quatro destinos do sidebar mais a aba Mais, escondida a partir de md", () => {
    render(<MobileBottomNav />);
    const nav = screen.getByRole("navigation", { name: "Navegação principal" });
    expect(nav).toHaveClass("md:hidden");
    expect(screen.getByRole("link", { name: /Inbox/ })).toHaveAttribute("href", "/app/inbox");
    expect(screen.getByRole("link", { name: /Radar/ })).toHaveAttribute("href", "/app/radar");
    expect(screen.getByRole("link", { name: /Agenda/ })).toHaveAttribute("href", "/app/agenda");
    expect(screen.getByRole("link", { name: /Respostas rápidas/ })).toHaveAttribute(
      "href",
      "/app/templates",
    );
    expect(screen.getByRole("button", { name: "Mais opções" })).toBeTruthy();
  });

  it("a altura vem da variável única e a área segura entra como padding — sem h-16 fixo", () => {
    render(<MobileBottomNav />);
    const nav = screen.getByRole("navigation", { name: "Navegação principal" });
    // Com `h-16` + padding de área segura, o `border-box` do Tailwind v4 tirava o
    // padding de DENTRO dos 64px e espremia as abas em aparelho com notch. A
    // altura é `--bottom-nav-h` (4rem + inset), e o inset só entra como padding.
    expect(nav).toHaveClass("h-[var(--bottom-nav-h)]", "pb-[env(safe-area-inset-bottom)]");
    expect(nav).not.toHaveClass("h-16");
  });

  it("marca a rota atual com aria-current", () => {
    render(<MobileBottomNav />);
    expect(screen.getByRole("link", { name: /Inbox/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Radar/ })).not.toHaveAttribute("aria-current");
  });

  // Medido num Chromium real: "Respostas rápidas" deixava a sua aba com 96,8px contra
  // 69,5px das outras (um item flex tem `min-width:auto` e o `truncate` nunca corta o
  // rótulo), e a 320px as outras quatro caíam abaixo de 60px. `min-w-0` + rótulo em até
  // duas linhas dão cinco abas iguais e sem rótulo cortado.
  it("as cinco abas dividem a largura por igual: min-w-0 em cada uma e o rótulo quebra em até duas linhas", () => {
    render(<MobileBottomNav />);
    const todas = abas();
    expect(todas).toHaveLength(5);
    for (const aba of todas) {
      expect(aba).toHaveClass("flex-1", "min-w-0");
      const rotulo = aba.lastElementChild as HTMLElement;
      expect(rotulo).toHaveClass("line-clamp-2", "px-1", "text-center", "leading-tight");
      // A 320px cada aba tem 64px (um quinto da barra) e, tirado o `px-1` do rótulo, 56px de
      // conteúdo. "Respuestas rápidas" (espanhol) começa por uma palavra de 10 letras sem ponto de
      // quebra, que a 11px ocupa 55,67px. `break-words` (`overflow-wrap:break-word`) é uma
      // proteção barata para as cinco abas, inclusive o Mais, medida como inerte: a 11px nada
      // quebra nem sai da aba, e a 12px a caixa cresce uns 5px sem cortar nada.
      expect(rotulo).toHaveClass("break-words");
      // `truncate` era o que deixava o rótulo largo alargar a aba.
      expect(rotulo).not.toHaveClass("truncate");
    }
  });

  // Quando UM rótulo quebra em duas linhas ("Respostas rápidas") e os outros ficam em uma, o
  // grupo [pílula + rótulo] de cada aba é centrado na sua caixa: o dessa aba tinha ~61,5px e os
  // das outras quatro ~47,75px, então a pílula da aba larga ficava a ~0,75px do topo e as
  // outras a ~7,6px — ícones em alturas diferentes. Cada rótulo reserva SEMPRE duas linhas
  // (`min-h-[2.5em]` = 2 × `leading-tight` de 1,25), todos os grupos têm a mesma altura e as
  // pílulas se alinham. Para caber com folga na caixa de 63px a pílula é de 28px (`h-7`).
  it("todo rótulo reserva duas linhas (min-h-[2.5em]), inclusive o do Mais — senão os ícones desalinham entre as abas", () => {
    render(<MobileBottomNav />);
    // Sem isto, uma aba a menos (item que sumiu do registro, "Mais" removido) faria o loop
    // abaixo passar sobre menos abas sem ninguém notar.
    expect(abas()).toHaveLength(5);
    for (const aba of abas()) {
      const rotulo = aba.lastElementChild as HTMLElement;
      expect(rotulo).toHaveClass("min-h-[2.5em]", "line-clamp-2", "leading-tight");
    }
  });

  // A cor do rótulo sozinha separava a aba ativa da inativa por 1,25:1 no tema claro
  // (medido); o ícone preenchido era a única pista. A pílula é o MESMO fundo do item ativo
  // do Sidebar de desktop (`bg-sidebar-active`), e o glifo usa o par que o token existe
  // para formar: `text-sidebar-active-fg` (6,57:1 no claro, 12,63:1 no escuro — WCAG
  // 1.4.11 pede 3:1 para um gráfico que carrega significado). O <Icon> herda
  // `currentColor` do span. O rótulo continua fora da pílula, com a cor da aba.
  //
  // ⚠️ ESTE CASO EXIGIA `text-sidebar` até a paleta Calixto entrar, e a troca é medição,
  // não gosto. Na paleta antiga a barra era azul-marinho (#0f4c75) e a pílula verde cheia
  // (#00b66b): recortar o glifo na cor da barra dava 3,42:1 e o `sidebar-active-fg` branco
  // dava 2,66:1 — o recorte era o único que passava. Na paleta Calixto o claro inverteu:
  // barra quase branca (#fafbfa) sobre pílula verde-pálida (#e9f5ed) dá 1,08:1, glifo
  // invisível. Medido com `razaoDeContraste` de `lib/branding/contraste.ts`.
  it("só a aba ativa tem a pílula bg-sidebar-active com o glifo na cor de frente dela; as inativas e o Mais têm o mesmo invólucro (h-7 w-14) sem ela", () => {
    render(<MobileBottomNav />);
    const ativa = screen.getByRole("link", { name: /Inbox/ });
    expect(ativa).toHaveClass("text-sidebar-active-fg");
    expect(ativa.firstElementChild).toHaveClass(
      "h-7",
      "w-14",
      "rounded-full",
      "bg-sidebar-active",
      "text-sidebar-active-fg",
    );
    expect(ativa.firstElementChild).not.toHaveClass("h-8");
    // O rótulo da aba ativa NÃO ganha a cor da barra: ele fica fora da pílula.
    expect(ativa.lastElementChild).not.toHaveClass("text-sidebar");

    for (const inativa of [
      screen.getByRole("link", { name: /Radar/ }),
      screen.getByRole("link", { name: /Agenda/ }),
      screen.getByRole("link", { name: /Respostas rápidas/ }),
      screen.getByRole("button", { name: "Mais opções" }),
    ]) {
      expect(inativa.firstElementChild).toHaveClass("h-7", "w-14", "rounded-full");
      expect(inativa.firstElementChild).not.toHaveClass("h-8");
      expect(inativa.firstElementChild).not.toHaveClass("bg-sidebar-active");
      expect(inativa.firstElementChild).not.toHaveClass("text-sidebar");
      expect(inativa).not.toHaveClass("text-sidebar-active-fg");
    }
  });

  // A aba da ponta encosta na borda da tela: o anel de foco padrão (2px + offset de 2px)
  // saía 100% fora da viewport, e a 2,1:1 contra a barra clara. O offset negativo o
  // desenha para dentro da aba, e a cor é a do item ativo do Sidebar (7,10:1 no claro).
  // O `dark:` existe porque `sidebar-active-fg` no escuro é o quase-preto da pílula de
  // menta: contra a barra escura ele dá 1,13:1 — ver o caso de contraste abaixo.
  it("todas as abas desenham o anel de foco para dentro e na cor do item ativo", () => {
    render(<MobileBottomNav />);
    expect(abas()).toHaveLength(5);
    for (const aba of abas()) {
      expect(aba).toHaveClass(
        "focus-visible:-outline-offset-2",
        "focus-visible:outline-sidebar-active-fg",
        "dark:focus-visible:outline-sidebar-foreground",
      );
    }
  });
});

/**
 * O CONTRASTE DA BARRA, MEDIDO NOS TOKENS — não em nome de classe.
 *
 * Os casos acima provam que a classe está no DOM. Nenhum deles prova que a COR que ela
 * carrega dá para enxergar, e é exatamente por aí que a barra quebrou duas vezes numa
 * troca de paleta que não encostou neste arquivo:
 *
 *   - glifo recortado com `text-sidebar` sobre `bg-sidebar-active`: 3,42:1 na paleta
 *     azul-marinho, 1,08:1 na Calixto clara (barra #fafbfa, pílula #e9f5ed);
 *   - rótulo e anel com `sidebar-active-fg` sobre a barra: 17,06:1 na paleta antiga
 *     escura, 1,13:1 na Calixto escura (#07110b, que é a frente da MENTA, sobre #151d23).
 *
 * Em ambos os casos toda asserção de classe continuava verde. Este caso lê os tokens dos
 * blocos de tema do `globals.css` e mede com o helper do produto; quem trocar a paleta
 * de novo reprova aqui, com o número na mensagem.
 */
describe("barra inferior · contraste dos tokens nos dois temas", () => {
  const CSS = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

  /** Hex de um `--color-*` dentro do bloco de seletor pedido. */
  function token(seletor: string, nome: string): string {
    const i = CSS.search(new RegExp(`^${seletor.replace(/[[\]"$]/g, "\\$&")}\\s*\\{`, "m"));
    expect(i, `não achei o bloco \`${seletor}\``).toBeGreaterThanOrEqual(0);
    const bloco = CSS.slice(i, CSS.indexOf("\n}", i));
    const m = new RegExp(`^\\s*${nome}:\\s*(#[0-9a-f]{3,8});`, "im").exec(bloco);
    expect(m?.[1], `\`${nome}\` não é hex literal em \`${seletor}\``).toBeTruthy();
    return m![1]!;
  }

  // `:root` é o bloco claro canônico (ver o comentário do `[data-theme="light"]` em
  // globals.css: o claro mora no `:root` e é espelhado para subárvore).
  const temas = [
    ["claro", ":root"],
    ["escuro", '[data-theme="dark"]'],
  ] as const;

  it.each(temas)("o glifo da pílula ativa passa de 3:1 sobre ela — tema %s", (_, seletor) => {
    const razao = razaoDeContraste(
      token(seletor, "--color-sidebar-active-fg"),
      token(seletor, "--color-sidebar-active"),
    );
    expect(razao, `glifo da pílula a ${razao.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });

  it.each(temas)("os rótulos passam de 4,5:1 sobre a barra — tema %s", (tema, seletor) => {
    const barra = token(seletor, "--color-sidebar");
    // No claro o rótulo ativo é `sidebar-active-fg`; no escuro o `dark:` do componente
    // troca para `sidebar-foreground`. A troca está aqui para o teste medir o que a tela
    // realmente pinta, não o token que o nome sugere.
    const ativo = token(
      seletor,
      tema === "escuro" ? "--color-sidebar-foreground" : "--color-sidebar-active-fg",
    );
    const inativo = token(seletor, "--color-sidebar-muted");

    const rAtivo = razaoDeContraste(ativo, barra);
    const rInativo = razaoDeContraste(inativo, barra);
    expect(rAtivo, `rótulo ativo a ${rAtivo.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    expect(rInativo, `rótulo inativo a ${rInativo.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

// A quinta aba existia só como botão: nenhum caso a ABRIA, então a folha, o `SidebarContent` dentro
// dela e o `onNavigate` que a fecha podiam quebrar sem que um único teste reprovasse.
describe("folha da aba Mais (menu completo no celular)", () => {
  // Sem o roteador do App Router, o `next/link` deixa o clique seguir e o jsdom tenta navegar de
  // verdade ("Not implemented: navigation to another Document"). Este ouvinte no `document` roda
  // DEPOIS dos handlers do React e só cancela essa navegação: o `Link` real e o `onNavigate` real
  // continuam sob teste, sem mock do `next/link`.
  const impedirNavegacaoDoJsdom = (e: Event) => e.preventDefault();
  beforeEach(() => document.addEventListener("click", impedirNavegacaoDoJsdom));
  afterEach(() => document.removeEventListener("click", impedirNavegacaoDoJsdom));

  it("o botão Mais opções abre a folha com a navegação completa do Sidebar", async () => {
    render(<MobileBottomNav />);
    // Fechada, a folha não está no DOM (o Radix Dialog não monta o conteúdo fechado).
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Mais opções" }));

    const folha = await screen.findByRole("dialog");
    expect(folha).toHaveAccessibleName("Navegação principal");
    // O `SidebarContent`, e não uma lista paralela: o link do Inbox vem dele...
    expect(within(folha).getByRole("link", { name: "Inbox" })).toHaveAttribute("href", "/app/inbox");
    // ...e há destinos que a barra de quatro abas não tem, só o menu completo.
    expect(within(folha).getByRole("link", { name: /Ver tudo em CRM/ })).toHaveAttribute(
      "href",
      "/app/crm",
    );
  });

  it("tocar num link da folha a fecha (onNavigate → setMaisAberto(false))", async () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByRole("button", { name: "Mais opções" }));
    const folha = await screen.findByRole("dialog");

    fireEvent.click(within(folha).getByRole("link", { name: "Inbox" }));

    // `waitFor`: o Radix Presence desmonta a folha depois do estado mudar.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
