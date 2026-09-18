import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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

  it("marca a rota atual com aria-current", () => {
    render(<MobileBottomNav />);
    expect(screen.getByRole("link", { name: /Inbox/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Radar/ })).not.toHaveAttribute("aria-current");
  });
});
