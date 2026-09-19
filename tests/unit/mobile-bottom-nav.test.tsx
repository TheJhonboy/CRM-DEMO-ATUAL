import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { MobileBottomNav } from "@/components/shell/MobileBottomNav";
import type { ActiveOrg, AuthUser } from "@/lib/auth/types";

const authRef: { user: Pick<AuthUser, "is_platform_admin">; activeOrg: ActiveOrg | null } = {
  user: { is_platform_admin: false },
  activeOrg: { orgId: "org-1", name: "Org", role: "admin" },
};

// Mesma receita de tests/unit/sidebar-grupos.test.tsx — o Sheet "Mais" só
// monta SidebarContent quando aberto (Radix Dialog não monta fechado), então
// não precisamos mockar ConnectionHealthDot/VersionFooter/toggleSidebar aqui.
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => authRef,
  usePermission: () => false,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/app/inbox",
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
    for (const aba of abas()) {
      const rotulo = aba.lastElementChild as HTMLElement;
      expect(rotulo).toHaveClass("min-h-[2.5em]", "line-clamp-2", "leading-tight");
    }
  });

  // A cor do rótulo sozinha separava a aba ativa da inativa por 1,25:1 no tema claro
  // (medido); o ícone preenchido era a única pista. A pílula é o MESMO fundo do item ativo
  // do Sidebar de desktop (`bg-sidebar-active`), mas o glifo NÃO fica branco sobre ele:
  // branco sobre a pílula verde dava 2,66:1 no claro e 2,90:1 no escuro (WCAG 1.4.11 pede
  // 3:1 para um gráfico que carrega significado). O glifo é "recortado" na pílula com a
  // cor da própria barra (`text-sidebar`; o <Icon> herda `currentColor` do span). O rótulo
  // continua fora da pílula, com a cor da aba.
  it("só a aba ativa tem a pílula bg-sidebar-active com o glifo na cor da barra; as inativas e o Mais têm o mesmo invólucro (h-7 w-14) sem ela", () => {
    render(<MobileBottomNav />);
    const ativa = screen.getByRole("link", { name: /Inbox/ });
    expect(ativa).toHaveClass("text-sidebar-active-fg");
    expect(ativa.firstElementChild).toHaveClass(
      "h-7",
      "w-14",
      "rounded-full",
      "bg-sidebar-active",
      "text-sidebar",
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
  // desenha para dentro da aba, e a cor é a do item ativo do Sidebar (9,1:1 no claro).
  it("todas as abas desenham o anel de foco para dentro e na cor do item ativo", () => {
    render(<MobileBottomNav />);
    for (const aba of abas()) {
      expect(aba).toHaveClass(
        "focus-visible:-outline-offset-2",
        "focus-visible:outline-sidebar-active-fg",
      );
    }
  });
});
