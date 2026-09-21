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
 *
 * Quatro decisões, todas medidas num Chromium real:
 *  - `min-w-0` em cada aba e rótulo em até duas linhas: um item flex tem
 *    `min-width:auto`, então "Respostas rápidas" alargava a sua aba (96,8px contra
 *    69,5px) e `truncate` nunca chegava a cortar; a 320px as outras quatro caíam
 *    abaixo de 60px.
 *  - Pílula `bg-sidebar-active` atrás do ícone da aba ativa (o mesmo fundo do item
 *    ativo do Sidebar de desktop): só a cor do rótulo separava ativa de inativa por
 *    1,25:1 no tema claro. O glifo usa `text-sidebar-active-fg` — o par que o token
 *    existe para formar (6,57:1 no claro, 12,63:1 no escuro; WCAG 1.4.11 pede 3:1
 *    para gráfico que carrega significado). O ícone herda `currentColor` do span.
 *
 *    ⚠️ Era `text-sidebar` ("recortar" o glifo na cor da própria barra), e a troca
 *    NÃO é gosto: na paleta antiga a barra era azul-marinho sobre pílula verde cheia
 *    (3,42:1) e o branco de `sidebar-active-fg` dava 2,66:1. Com a paleta Calixto o
 *    claro tem barra quase branca (#fafbfa) e pílula verde-pálida (#e9f5ed) — recortar
 *    o glifo nela dá 1,08:1, ou seja, ícone INVISÍVEL. Medido com
 *    `razaoDeContraste` de `lib/branding/contraste.ts`.
 *  - O rótulo fica fora da pílula. Ele é lido sobre a BARRA, não sobre a pílula, e por
 *    isso não pode usar `sidebar-active-fg` no escuro: lá esse token é o quase-preto
 *    #07110b, feito para a menta, e dá 1,13:1 contra a barra #151d23. `dark:` devolve
 *    o `sidebar-foreground` (15,83:1). No claro `sidebar-active-fg` é o verde-floresta
 *    #17623e e vale 7,10:1 contra #fafbfa, então lá ele fica.
 *  - Todo rótulo reserva SEMPRE duas linhas (`min-h-[2.5em]` = 2 × o `leading-tight`
 *    de 1,25) e a pílula tem 28px: sem isso o grupo [pílula + rótulo] de "Respostas
 *    rápidas" media ~61,5px e o das outras quatro ~47,75px, e como cada grupo é
 *    centrado na caixa da aba os ícones ficavam em alturas diferentes (~0,75px do
 *    topo numa aba, ~7,6px nas outras). Com grupos iguais as pílulas se alinham.
 *  - Anel de foco para DENTRO da aba (offset de foco negativo) e na cor do item ativo: a
 *    aba da ponta encosta na borda da tela e o anel padrão saía inteiro fora dela,
 *    a 2,1:1 contra a barra clara. O anel é lido contra a BARRA e leva o mesmo
 *    `dark:` do rótulo, pela mesma medição (7,10:1 no claro, 15,83:1 no escuro).
 *
 * Os rótulos também levam `break-words`, por precaução: a 320px cada aba tem 64px (um
 * quinto da barra) e, tirado o `px-1` do rótulo, 56px de conteúdo, e "Respuestas" (de
 * "Respuestas rápidas", em espanhol) ocupa 55,67px a 11px. Medido num Chromium real: a 11px
 * nada quebra nem sai da aba; com a fonte 9% maior a palavra passa (60,7px) e a caixa do
 * rótulo cresce uns 5px para fora da aba, sem cortar nada. `break-word` não reduz a
 * largura mínima do item, então a classe é inerte nesses casos; só `wrap-anywhere`
 * quebraria a palavra no meio.
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
              "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors duration-200 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-active-fg dark:focus-visible:outline-sidebar-foreground",
              isActive
                ? "text-sidebar-active-fg dark:text-sidebar-foreground"
                : "text-sidebar-muted hover:text-sidebar-hover-fg",
            )}
          >
            <span
              className={cn(
                "flex h-7 w-14 items-center justify-center rounded-full transition-colors duration-200",
                isActive && "bg-sidebar-active text-sidebar-active-fg",
              )}
            >
              <Icon size={22} weight={isActive ? "fill" : "regular"} aria-hidden />
            </span>
            <span className="line-clamp-2 min-h-[2.5em] break-words px-1 text-center leading-tight">
              {t(item.label)}
            </span>
          </Link>
        );
      })}
      <Sheet open={maisAberto} onOpenChange={setMaisAberto}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label={t("Mais opções")}
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-sidebar-muted transition-colors duration-200 hover:text-sidebar-hover-fg focus-visible:-outline-offset-2 focus-visible:outline-sidebar-active-fg dark:focus-visible:outline-sidebar-foreground"
          >
            <span className="flex h-7 w-14 items-center justify-center rounded-full transition-colors duration-200">
              <DotsThree size={22} weight="bold" aria-hidden />
            </span>
            <span className="line-clamp-2 min-h-[2.5em] break-words px-1 text-center leading-tight">
              {t("Mais")}
            </span>
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
