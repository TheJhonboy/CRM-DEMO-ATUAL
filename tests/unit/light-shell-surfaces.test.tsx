import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/inbox" }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (value: string) => value }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { is_platform_admin: false },
    activeOrg: { role: "admin", marca: null },
  }),
}));
vi.mock("@/lib/branding/contexto", () => ({
  useMarcaDaInstalacao: () => ({ name: "Calixto AI", logoUrl: null }),
}));
vi.mock("@/app/actions/shell/toggleSidebar", () => ({ toggleSidebar: vi.fn() }));
vi.mock("@/components/shell/AlertsBell", () => ({ AlertsBell: () => <span /> }));
vi.mock("@/components/shell/MobileSidebar", () => ({ MobileSidebar: () => <span /> }));
vi.mock("@/components/shell/TenantSwitcher", () => ({ TenantSwitcher: () => <span /> }));
vi.mock("@/components/shell/UserMenu", () => ({ UserMenu: () => <span /> }));
vi.mock("@/components/shell/SearchTrigger", () => ({ SearchTrigger: () => <span /> }));
vi.mock("@/components/shell/VersionFooter", () => ({ VersionFooter: () => <span /> }));
vi.mock("@/components/connections/ConnectionHealthDot", () => ({
  ConnectionHealthDot: () => <span />,
}));

import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";

describe("casca do CRM no modo claro", () => {
  it("usa topbar branca e discreta", () => {
    render(<TopBar />);
    expect(screen.getByRole("banner")).toHaveClass("bg-surface/95", "border-border");
  });

  it("usa sidebar clara e navegação ativa verde suave", () => {
    const { container } = render(<Sidebar collapsed={false} />);
    expect(screen.getByRole("complementary")).toHaveClass("bg-sidebar", "border-sidebar-border");
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveClass(
      "bg-sidebar-active",
      "text-sidebar-active-fg",
    );
    expect(container.querySelector("svg.ml-1")).toHaveClass("text-accent-700", "dark:text-accent");
  });
});
