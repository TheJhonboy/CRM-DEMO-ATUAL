"use client";
import Link from "next/link";
import { useT } from "@/hooks/i18n/useT";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { ArrowRight, CaretDoubleLeft, CaretDoubleRight, Gear, WhatsappLogo } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { toggleSidebar } from "@/app/actions/shell/toggleSidebar";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { ConnectionHealthDot } from "@/components/connections/ConnectionHealthDot";
import { VersionFooter } from "@/components/shell/VersionFooter";
import { useMarcaDaInstalacao } from "@/lib/branding/contexto";
import { GRUPO_NO_RODAPE, NAV_GROUPS, sidebarGroups } from "@/lib/navigation/registry";

interface SidebarContentProps {
  collapsed: boolean;
  showCollapseControl?: boolean;
  onNavigate?: () => void;
}

/**
 * Navegação principal, agrupada por objetivo.
 *
 * Não decide nada: `sidebarGroups()` (lib/navigation/registry.ts) resolve quais
 * grupos e destinos este papel vê, e este componente desenha. Antes, a lista de
 * itens e sete `usePermission()` viviam aqui — e divergiam do hub de
 * Configurações e das abas de IA, que mantinham suas próprias listas.
 */
export function SidebarContent({
  collapsed,
  showCollapseControl = true,
  onNavigate,
}: SidebarContentProps) {
  // A barra lateral aparece em TODA tela — traduzi-la aqui é o que faz a
  // escolha de idioma virar algo visível no primeiro clique.
  const t = useT();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const { user, activeOrg } = useAuth();
  const todos = sidebarGroups(user.is_platform_admin, activeOrg?.role ?? null);
  // Configurações sai da área que rola e vai para o rodapé fixo: medido em
  // 1280x768, ele caía fora da dobra mesmo em telas de 1080px.
  const grupos = todos.filter((g) => g.group.id !== GRUPO_NO_RODAPE);
  const rodape = NAV_GROUPS.find((g) => g.id === GRUPO_NO_RODAPE)?.hub;

  const brand = useMarcaDaInstalacao();
  /**
   * O CONSUMIDOR do nome por organização.
   *
   * Sem ele, `settings.branding.app_name` seria campo decorativo: medido, o nome
   * da org não aparece em lugar nenhum da casca para o cliente típico de um
   * revendedor — o único leitor é o `TenantSwitcher`, e ele devolve `null` com
   * uma organização só.
   *
   * A marca da INSTALAÇÃO continua embaixo: a organização que não definiu nome
   * vê exatamente o que via antes. O que mudou é POR ONDE ela chega — era
   * `branding()`, que no navegador lê `window.__PUBLIC_ENV__` e no servidor lê
   * `process.env`, e essas duas fontes passaram a divergir quando o layout raiz
   * começou a injetar a marca do BANCO. Divergência entre SSR e cliente aqui não
   * é detalhe: com logo no banco e `APP_LOGO_URL` vazio, o servidor desenhava o
   * `<span>` de baixo e o cliente desenhava o `<img>` — React #418 em toda tela.
   * Hoje a marca vem por PROP do servidor (`useMarcaDaInstalacao`), pela mesma
   * rota de `activeOrg`, e os dois lados leem o mesmo objeto por construção.
   */
  const nome = activeOrg?.marca?.nome ?? brand.name;
  /**
   * O mesmo desenho para o LOGO — e é este par de linhas que fecha o caminho do
   * `logo_url` gravado até a tela.
   *
   * `||` e não `??`: vazio é AUSÊNCIA de logo, não "logo em branco". É a regra
   * que `resolveBranding` e `primeiroDefinido` já aplicam nas camadas de baixo, e
   * com `??` um `""` vindo de cima apagaria o logo do revendedor em vez de
   * descer para ele — que é o contrário do que a precedência por campo promete.
   */
  const logo = activeOrg?.marca?.logoUrl || brand.logoUrl;

  return (
    <>
      <div className={cn("flex items-center border-b px-4 h-14", collapsed ? "justify-center" : "justify-start")}>
        {logo && !collapsed ? (
          // <img> em vez de next/image de propósito: a URL vem de quem hospeda
          // (banco ou .env), e next/image exige allowlist de domínios fechada em
          // build — a imagem pré-buildada rejeitaria o domínio do self-hoster.
          // Altura fixa e largura livre porque a arte enviada tem proporção
          // desconhecida; forçar as duas distorceria o logo de quem configurou.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt={nome}
            className="h-7 w-auto max-w-[10rem] object-contain"
          />
        ) : collapsed ? (
          // Recolhida, a marca ainda precisa ser reconhecível. Mantém o logo
          // configurado quando existir e usa o mascote apenas como fallback.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo || "/calixto-assistant.png"}
            alt={logo ? nome : "Assistente virtual"}
            className="h-9 w-9 object-contain"
          />
        ) : (
          <>
            {/* O arquivo local é o fallback visual da instalação. Logo enviado
                pela organização continua tendo prioridade no bloco acima. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/calixto-assistant.png"
              alt="Assistente virtual"
              className="h-9 w-9 shrink-0 object-contain"
            />
            <span className="ml-2 font-semibold tracking-tight">{nome}</span>
            <WhatsappLogo size={16} weight="fill" aria-hidden className="ml-1 text-[#bff7dd]" />
          </>
        )}
      </div>
      <nav className="flex-1 space-y-3 overflow-y-auto p-2" aria-label="Navegação principal">
        {grupos.map(({ group, items }) => {
          const tituloId = `nav-grupo-${group.id}`;
          return (
            <div key={group.id} className="space-y-1">
              {/* Colapsado, o sidebar tem 64px: seis rótulos ali seriam ilegíveis.
                  Vira um filete separador, que preserva o agrupamento sem texto. */}
              {collapsed ? (
                <div aria-hidden className="mx-2 border-t first:hidden" />
              ) : (
                <h2
                  id={tituloId}
                  className="px-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-muted/70"
                >
                  {t(group.label)}
                </h2>
              )}
              <ul aria-labelledby={collapsed ? undefined : tituloId} aria-label={collapsed ? t(group.label) : undefined} className="space-y-1">
                {items.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={collapsed ? t(item.label) : undefined}
                        aria-current={isActive ? "page" : undefined}
                        onClick={onNavigate}
                        className={cn(
                          "relative flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors duration-200",
                          isActive
                            ? "bg-sidebar-active text-sidebar-active-fg"
                            : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-hover-fg",
                          collapsed && "justify-center px-2",
                        )}
                      >
                        <Icon size={18} weight={isActive ? "fill" : "regular"} aria-hidden />
                        {!collapsed && <span className="truncate">{t(item.label)}</span>}
                        {item.healthDot && (
                          <ConnectionHealthDot
                            className={cn(collapsed ? "absolute right-1.5 top-1.5" : "ml-auto")}
                          />
                        )}
                      </Link>
                    </li>
                  );
                })}
                {group.hub && (
                  <li>
                    <Link
                      href={group.hub.href}
                      title={collapsed ? t(group.hub.label) : undefined}
                      aria-current={pathname === group.hub.href ? "page" : undefined}
                      onClick={onNavigate}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors duration-200",
                        pathname === group.hub.href
                          ? "bg-sidebar-active text-sidebar-active-fg"
                          : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-hover-fg",
                        collapsed && "justify-center px-2",
                      )}
                    >
                      <ArrowRight size={18} aria-hidden />
                      {!collapsed && <span className="truncate">{t(group.hub.label)}</span>}
                    </Link>
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t p-2">
        {rodape && (
          <Link
            href={rodape.href}
            title={collapsed ? t(rodape.label) : undefined}
            aria-current={pathname.startsWith(rodape.href) ? "page" : undefined}
            onClick={onNavigate}
            className={cn(
              "mb-1 flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors duration-200",
              pathname.startsWith(rodape.href)
                ? "bg-sidebar-active text-sidebar-active-fg"
                : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-hover-fg",
              collapsed && "justify-center px-2",
            )}
          >
            <Gear size={18} aria-hidden />
            {!collapsed && <span className="truncate">{rodape.label}</span>}
          </Link>
        )}
        <VersionFooter collapsed={collapsed} onNavigate={onNavigate} />
        {showCollapseControl && (
          <button
            type="button"
            onClick={() => startTransition(() => toggleSidebar(collapsed))}
            disabled={isPending}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-sidebar-muted transition-colors duration-200 hover:bg-sidebar-hover hover:text-sidebar-hover-fg",
              collapsed && "justify-center px-2",
            )}
            aria-label={collapsed ? "Expandir sidebar" : "Recolher sidebar"}
          >
            {collapsed ? <CaretDoubleRight size={14} aria-hidden /> : <CaretDoubleLeft size={14} aria-hidden />}
            {!collapsed && <span>Recolher</span>}
          </button>
        )}
      </div>
    </>
  );
}

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  return (
    <aside
      className={cn(
        // A barra ocupa lugar na linha, e NUNCA é `fixed`.
        //
        // Com `fixed` a barra sai do fluxo: ela não ocupa lugar nenhum na linha,
        // e quem afastava o conteúdo era um `md:ml-16`/`md:ml-60` do lado de lá.
        // Duas medidas para a mesma coisa, em componentes diferentes — e no dia
        // em que discordassem (largura de 60 com margem de 16), a barra passava
        // POR CIMA da lista de conversas, escondendo o começo de cada linha.
        //
        // Foi assim que apareceu numa instalação real: a barra expandida, com as
        // etiquetas legíveis, e a lista atrás dela cortada. Um F5 "consertava",
        // que é a assinatura de servidor e navegador terem pintado estados
        // diferentes — e `AppShell` e `Sidebar` são ambos `"use client"`.
        //
        // `self-stretch` acompanha a altura da página. `h-screen` a cortava na
        // primeira janela em telas longas, deixando um bloco branco na Agenda.
        //
        // `shrink-0` porque item de flex encolhe por padrão, e uma barra de 60
        // espremida para caber é o mesmo defeito por outro caminho.
        "z-30 flex self-stretch shrink-0 flex-col border-r border-sidebar-muted/20 bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <SidebarContent collapsed={collapsed} />
    </aside>
  );
}
