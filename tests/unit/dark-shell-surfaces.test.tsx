import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/inbox" }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (value: string) => value }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { is_platform_admin: false },
    activeOrg: { role: "owner", marca: null },
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

describe("casca do CRM no modo escuro", () => {
  it("mantém a barra superior na camada estrutural", () => {
    render(<TopBar />);
    expect(screen.getByRole("banner")).toHaveClass("dark:bg-surface", "dark:border-white/10");
  });

  it("separa a lateral do conteúdo com borda discreta", () => {
    render(<Sidebar collapsed={false} />);
    expect(screen.getByRole("complementary")).toHaveClass("dark:border-white/10");
  });
});
