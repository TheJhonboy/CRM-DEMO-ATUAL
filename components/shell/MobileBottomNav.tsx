"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { bottomNavItems } from "@/lib/navigation/registry";
import { SidebarContent } from "@/components/shell/Sidebar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DotsThree } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Barra de abas fixa no rodapé, só no celular — o padrão de app que o menu-
 * gaveta (`MobileSidebar`) sozinho não dava. Os quatro primeiros itens vêm de
 * `bottomNavItems` (mesma fonte de verdade do Sidebar); a quinta aba abre o
 * menu completo, reaproveitando `SidebarContent` em vez de duplicar a lista.
 */
export function MobileBottomNav() {
  const t = useT();
  const pathname = usePathname();
  const { user, activeOrg } = useAuth();
  const [maisAberto, setMaisAberto] = useState(false);
  const items = bottomNavItems(
    user.is_platform_admin && !user.support,
    activeOrg?.role ?? null,
    activeOrg?.interface_settings,
  );

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex h-[var(--bottom-nav-h)] items-stretch border-t border-sidebar-muted/20 bg-sidebar pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:hidden"
      aria-label={t("Navegação principal")}
    >
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors duration-200",
              isActive ? "text-sidebar-active-fg" : "text-sidebar-muted hover:text-sidebar-hover-fg",
            )}
          >
            <Icon size={22} weight={isActive ? "fill" : "regular"} aria-hidden />
            <span className="truncate px-1">{t(item.label)}</span>
          </Link>
        );
      })}
      <Sheet open={maisAberto} onOpenChange={setMaisAberto}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label={t("Mais opções")}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-sidebar-muted transition-colors duration-200 hover:text-sidebar-hover-fg"
          >
            <DotsThree size={22} weight="bold" aria-hidden />
            <span className="truncate px-1">{t("Mais")}</span>
          </button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-0 p-0 sm:max-w-xs"
        >
          <SheetTitle className="sr-only">{t("Navegação principal")}</SheetTitle>
          <SidebarContent
            collapsed={false}
            showCollapseControl={false}
            onNavigate={() => setMaisAberto(false)}
          />
        </SheetContent>
      </Sheet>
    </nav>
  );
}
