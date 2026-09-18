# Versão mobile do CRM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o CRM (Calixto AI CRM, Next.js 16 / React 19 / Tailwind v4) genuinely usável e bonito no celular — corrigindo o viewport que hoje impede toda a responsividade já existente de funcionar, somando uma barra de navegação inferior no padrão de app, e fechando três buracos de toque encontrados em auditoria (Kanban, Contatos, Tarefas) — sem tocar em Inbox nem Agenda (semana), que já são mobile-friendly e testados.

**Architecture:** Mudanças cirúrgicas, arquivo por arquivo, todas com classes Tailwind responsivas (`md:` = 768px, o breakpoint que o produto já usa em todo lugar) — nenhum hook novo de `matchMedia`/`useIsMobile` (o produto não usa esse padrão em lugar nenhum; segue CSS puro, evitando flash de hidratação). A navegação inferior reaproveita `sidebarGroups()`/`canSee` (única fonte de verdade de navegação, `lib/navigation/registry.ts`) — não duplica a lista de destinos nem a regra de papel.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Radix UI (`@radix-ui/react-dialog` via `components/ui/sheet.tsx`), Vitest + Testing Library, `@hello-pangea/dnd` (Kanban).

**Spec:** [docs/superpowers/specs/2026-09-18-versao-mobile-crm.md](../specs/2026-09-18-versao-mobile-crm.md)

## Global Constraints

- Breakpoint mobile→desktop é sempre `md` (768px) — o mesmo que `Sidebar`/`TopBar`/`InboxLayout`/`GradeDaAgenda` já usam. Não introduzir `sm:`/`lg:` como ponto de colapso principal.
- Cores só por token (`bg-sidebar`, `bg-card`, `text-sidebar-muted`, etc., de `app/globals.css`) — nunca hex literal novo. Claro e escuro vêm de graça pelos tokens já existentes.
- Nenhum `maximumScale`/`userScalable: false` no viewport — travar zoom quebra WCAG 2.1.4.4 (o projeto já tem histórico de correções WCAG AA; não abrir uma regressão nova).
- Toque: variantes de `Button` (`components/ui/button.tsx`) já são 44px (`h-11`/`w-11`) abaixo de `lg` — reaproveitar essas variantes em vez de escrever tamanho de botão à mão sempre que der.
- `sidebarGroups()`/`canSee` (`lib/navigation/registry.ts`) são a ÚNICA fonte de verdade de quem vê qual destino — a barra inferior não reimplementa essa regra.
- Todo teste novo roda com `pnpm test:unit` (Vitest + jsdom), sem depender de Supabase local nem do Playwright e2e.

---

## File Structure

| Arquivo | O que muda |
|---|---|
| `app/layout.tsx` | `viewport` export ganha `width`/`initialScale`/`viewportFit` |
| `lib/navigation/registry.ts` | nova função `bottomNavItems()` |
| `components/shell/MobileBottomNav.tsx` | **novo** — barra de abas fixa no rodapé, só no celular |
| `app/app/_components/AppShell.tsx` | monta `<MobileBottomNav />` e reserva espaço no `<main>` |
| `components/kanban/StageColumn.tsx` | coluna com `scroll-snap` e largura de ~85vw no celular |
| `components/kanban/KanbanBoard.tsx` | contêiner do board (e do skeleton) ativa `snap-x` só no celular |
| `components/contacts/ContactsTable.tsx` | lista de cartões abaixo de `md`, tabela preservada a partir de `md` |
| `app/app/tasks/_components/ListaDeTarefas.tsx` | checkbox maior e ações sempre visíveis no celular |
| `tests/unit/viewport-mobile.test.ts` | **novo** |
| `tests/unit/navegacao-registry.test.ts` | + testes de `bottomNavItems` |
| `tests/unit/mobile-bottom-nav.test.tsx` | **novo** |
| `tests/unit/kanban-colunas-mobile.test.ts` | **novo** |
| `tests/unit/contatos-cartoes-mobile.test.ts` | **novo** |
| `tests/unit/tarefas-alvos-de-toque.test.ts` | **novo** |

---

### Task 1: Corrigir o viewport do layout raiz

**Files:**
- Modify: `app/layout.tsx:116-118`
- Test: `tests/unit/viewport-mobile.test.ts` (novo)

**Interfaces:**
- Produces: `viewport.width === "device-width"`, `viewport.initialScale === 1`, `viewport.viewportFit === "cover"` — Task 2 depende de `viewportFit: "cover"` existir para que `env(safe-area-inset-bottom)` funcione de verdade num iPhone com notch.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/viewport-mobile.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

/**
 * Sem `width`/`initialScale` no viewport, o navegador mobile assume um
 * viewport de layout de ~980px e desenha a página inteira zerada — nenhuma
 * media query `md:` (768px) dispara de verdade num aparelho físico, mesmo
 * que o CSS responsivo já exista. Este é o defeito que faz toda a
 * responsividade já construída no produto (Sidebar, InboxLayout, semana da
 * Agenda) nunca aparecer fora do DevTools.
 */
describe("viewport mobile do layout raiz", () => {
  it("declara width=device-width e initialScale=1", () => {
    const src = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");
    expect(src).toContain('width: "device-width"');
    expect(src).toContain("initialScale: 1");
  });

  it("declara viewportFit=cover — necessário para env(safe-area-inset-bottom) da barra inferior", () => {
    const src = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");
    expect(src).toContain('viewportFit: "cover"');
  });

  it("não trava o zoom — maximumScale/userScalable travariam WCAG 2.1.4.4", () => {
    const src = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");
    expect(src).not.toContain("maximumScale");
    expect(src).not.toContain("userScalable");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run tests/unit/viewport-mobile.test.ts`
Expected: FAIL — as duas primeiras asserções não encontram as strings (o `viewport` de hoje só tem `themeColor`).

- [ ] **Step 3: Implementar**

Em `app/layout.tsx`, substituir (linhas 116-118):

```ts
export const viewport: Viewport = {
  themeColor: coresDaBarraDoNavegador(REGUA_DO_PRODUTO),
};
```

por:

```ts
export const viewport: Viewport = {
  themeColor: coresDaBarraDoNavegador(REGUA_DO_PRODUTO),
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run tests/unit/viewport-mobile.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx tests/unit/viewport-mobile.test.ts
git commit -m "fix(mobile): declarar width/initialScale no viewport do layout raiz

Sem isto o navegador mobile assumia viewport de layout de ~980px e
desenhava a página inteira zerada — nenhuma media query md: (768px)
disparava de verdade num aparelho físico. viewportFit=cover prepara
o terreno para a barra de navegação inferior (env(safe-area-inset-bottom))."
```

---

### Task 2: Barra de navegação inferior no celular

**Files:**
- Modify: `lib/navigation/registry.ts` (nova função, após `sidebarGroups`)
- Create: `components/shell/MobileBottomNav.tsx`
- Modify: `app/app/_components/AppShell.tsx`
- Test: `tests/unit/navegacao-registry.test.ts` (+ testes)
- Test: `tests/unit/mobile-bottom-nav.test.tsx` (novo)

**Interfaces:**
- Consumes: `sidebarGroups(isPlatformAdmin, role, settings)` de `lib/navigation/registry.ts` (já existe); `NavDestination` type (já existe); `useAuth()` de `@/hooks/auth/AuthProvider` devolvendo `{ user, activeOrg }` (já usado em `Sidebar.tsx`); `SidebarContent` de `@/components/shell/Sidebar` (já existe, reaproveitado sem modificação).
- Produces: `bottomNavItems(isPlatformAdmin: boolean, role: Role | null, settings?: InterfaceSettings): NavDestination[]` — exportada de `lib/navigation/registry.ts`. `MobileBottomNav` (componente, sem props) — exportado de `components/shell/MobileBottomNav.tsx`.

- [ ] **Step 1: Escrever o teste da função pura que falha**

Em `tests/unit/navegacao-registry.test.ts`, adicionar ao topo do bloco de import:

```ts
import {
  NAV_DESTINATIONS,
  NAV_GROUPS,
  bottomNavItems,
  canSee,
  hubSections,
  searchable,
  sidebarGroups,
} from "@/lib/navigation/registry";
```

E no fim do arquivo, adicionar:

```ts
describe("bottomNavItems", () => {
  it("devolve os quatro primeiros destinos do sidebar, na ordem do produto", () => {
    const itens = bottomNavItems(true, null);
    expect(itens.map((i) => i.href)).toEqual([
      "/app/inbox",
      "/app/radar",
      "/app/agenda",
      "/app/templates",
    ]);
  });

  it("respeita o papel — nunca mostra o que o papel não vê", () => {
    const itens = bottomNavItems(false, "viewer");
    expect(itens.every((i) => canSee(i, false, "viewer"))).toBe(true);
  });

  it("nunca devolve mais de quatro — o quinto slot é sempre a aba Mais", () => {
    expect(bottomNavItems(true, null).length).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run tests/unit/navegacao-registry.test.ts`
Expected: FAIL com `bottomNavItems is not a function` (ou erro de import) — a função ainda não existe.

- [ ] **Step 3: Implementar `bottomNavItems`**

Em `lib/navigation/registry.ts`, adicionar logo após a função `sidebarGroups` (depois da linha 128, antes de `hubSections`):

```ts
/**
 * Projeção da barra de abas do celular: os quatro primeiros destinos do
 * sidebar, na MESMA ordem de prioridade que `NAV_GROUPS` já declara (ver o
 * comentário "Grupos por OBJETIVO, na ordem de uso" em `catalogo.ts`). O
 * quinto slot da barra não vem daqui — é sempre "Mais", que abre o menu
 * completo (`SidebarContent`) num Sheet.
 *
 * Não reimplementa a regra de papel: `sidebarGroups()` já filtra por
 * `destinosDaInterface`/`canSee`, e este helper só achata e corta.
 */
export function bottomNavItems(
  isPlatformAdmin: boolean,
  role: Role | null,
  settings?: InterfaceSettings,
): NavDestination[] {
  return sidebarGroups(isPlatformAdmin, role, settings)
    .flatMap((g) => g.items)
    .slice(0, 4);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run tests/unit/navegacao-registry.test.ts`
Expected: PASS (todos os testes do arquivo, incluindo os 3 novos)

- [ ] **Step 5: Escrever o teste do componente que falha**

Criar `tests/unit/mobile-bottom-nav.test.tsx`:

```tsx
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
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `pnpm vitest run tests/unit/mobile-bottom-nav.test.tsx`
Expected: FAIL — `Cannot find module '@/components/shell/MobileBottomNav'`

- [ ] **Step 7: Implementar `MobileBottomNav`**

Criar `components/shell/MobileBottomNav.tsx`:

```tsx
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
      className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-sidebar-muted/20 bg-sidebar text-sidebar-foreground md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
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
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `pnpm vitest run tests/unit/mobile-bottom-nav.test.tsx`
Expected: PASS (2 testes)

- [ ] **Step 9: Integrar no AppShell**

Em `app/app/_components/AppShell.tsx`, adicionar o import (após a linha 5, junto dos outros imports de componentes):

```ts
import { MobileBottomNav } from "@/components/shell/MobileBottomNav";
```

E trocar (linhas 59-62):

```tsx
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
```

por:

```tsx
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <TopBar />
        {/* pb-24: reserva os 64px da barra inferior (h-16) mais folga —
            sem isto o fim de qualquer página fica atrás dela no celular.
            md:pb-6 devolve o padding normal a partir de onde a barra some. */}
        <main className="flex-1 overflow-auto p-6 pb-24 md:pb-6">{children}</main>
      </div>
      <MobileBottomNav />
```

- [ ] **Step 10: Rodar a suíte inteira uma vez e confirmar que nada quebrou**

Run: `pnpm vitest run`
Expected: PASS — nenhuma regressão em `sidebar-grupos.test.tsx`, `navegacao-completude.test.ts` ou qualquer teste de `AppShell`/`TopBar` existente.

- [ ] **Step 11: Commit**

```bash
git add lib/navigation/registry.ts components/shell/MobileBottomNav.tsx app/app/_components/AppShell.tsx tests/unit/navegacao-registry.test.ts tests/unit/mobile-bottom-nav.test.tsx
git commit -m "feat(mobile): barra de navegação inferior no celular

Reaproveita sidebarGroups()/canSee (lib/navigation/registry.ts) para os
quatro destinos de uso diário; a quinta aba (Mais) abre o menu completo
via SidebarContent, sem duplicar a lista de navegação. main ganha
padding-bottom no celular para o conteúdo não ficar atrás da barra fixa."
```

---

### Task 3: Kanban — colunas deslizáveis no celular

**Files:**
- Modify: `components/kanban/StageColumn.tsx:95`
- Modify: `components/kanban/KanbanBoard.tsx:56,60,248`
- Test: `tests/unit/kanban-colunas-mobile.test.ts` (novo)

**Interfaces:**
- Nenhuma nova — só classes CSS nos elementos existentes. `@hello-pangea/dnd` (`Droppable`/`Draggable`) fica intocado.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/kanban-colunas-mobile.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

/**
 * Sem nenhuma classe responsiva, a coluna de 320px fixos virava scroll
 * horizontal cru no celular — sem indicar onde uma etapa termina e a
 * próxima começa. scroll-snap com largura de ~85vw dá a sensação de
 * "arrastar para a próxima etapa"; a partir de md volta a ser exatamente
 * o board de hoje (w-80, sem snap).
 */
describe("Kanban — colunas no celular", () => {
  it("a coluna real tem ~85vw com snap no celular, 320px sem snap a partir de md", () => {
    const src = fs.readFileSync(path.join(RAIZ, "components/kanban/StageColumn.tsx"), "utf8");
    expect(src).toContain(
      'className="flex w-[85vw] shrink-0 snap-center flex-col rounded-lg border border-border bg-surface-muted/40 md:w-80 md:snap-none"',
    );
  });

  it("o contêiner do board ativa snap-x só no celular", () => {
    const src = fs.readFileSync(path.join(RAIZ, "components/kanban/KanbanBoard.tsx"), "utf8");
    expect(src).toContain(
      'className="flex h-full snap-x snap-mandatory gap-3 overflow-x-auto p-4 md:snap-none"',
    );
  });

  it("o skeleton de carregamento usa a mesma largura da coluna real — sem isto o board 'pula' quando os dados chegam", () => {
    const src = fs.readFileSync(path.join(RAIZ, "components/kanban/KanbanBoard.tsx"), "utf8");
    expect(src).toContain(
      'className="flex snap-x snap-mandatory gap-3 overflow-x-auto p-4 md:snap-none"',
    );
    expect(src).toContain(
      'className="flex w-[85vw] shrink-0 snap-center flex-col gap-2 rounded-lg border border-border bg-surface-muted/40 p-3 md:w-80 md:snap-none"',
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run tests/unit/kanban-colunas-mobile.test.ts`
Expected: FAIL — as 3 asserções não encontram as strings (código ainda usa `w-80` fixo sem snap).

- [ ] **Step 3: Implementar em `StageColumn.tsx`**

Trocar (linha 95):

```tsx
    <div className="flex w-80 shrink-0 flex-col rounded-lg border border-border bg-surface-muted/40">
```

por:

```tsx
    <div className="flex w-[85vw] shrink-0 snap-center flex-col rounded-lg border border-border bg-surface-muted/40 md:w-80 md:snap-none">
```

- [ ] **Step 4: Implementar em `KanbanBoard.tsx`**

Trocar em `BoardSkeleton` (linha 56):

```tsx
    <div className="flex gap-3 overflow-x-auto p-4">
```

por:

```tsx
    <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto p-4 md:snap-none">
```

Trocar em `BoardSkeleton` (linha 60):

```tsx
          className="flex w-80 shrink-0 flex-col gap-2 rounded-lg border border-border bg-surface-muted/40 p-3"
```

por:

```tsx
          className="flex w-[85vw] shrink-0 snap-center flex-col gap-2 rounded-lg border border-border bg-surface-muted/40 p-3 md:w-80 md:snap-none"
```

Trocar no board real (linha 248):

```tsx
      <div className="flex h-full gap-3 overflow-x-auto p-4">
```

por:

```tsx
      <div className="flex h-full snap-x snap-mandatory gap-3 overflow-x-auto p-4 md:snap-none">
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm vitest run tests/unit/kanban-colunas-mobile.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 6: Commit**

```bash
git add components/kanban/StageColumn.tsx components/kanban/KanbanBoard.tsx tests/unit/kanban-colunas-mobile.test.ts
git commit -m "fix(mobile): colunas do Kanban deslizam com scroll-snap no celular

Zero classe responsiva antes disto — coluna de 320px fixos era scroll
horizontal cru. md: preserva exatamente o board de hoje; skeleton
alinhado com a largura real para não 'pular' quando os dados chegam."
```

---

### Task 4: Contatos — lista de cartões no celular

**Files:**
- Modify: `components/contacts/ContactsTable.tsx`
- Test: `tests/unit/contatos-cartoes-mobile.test.ts` (novo)

**Interfaces:**
- Consumes: as mesmas props/handlers que a tabela já usa (`contacts`, `displayName`, `formatUltimaAtividade`, `iniciarConversa`, `setAlvo`, `clientesLigado`, `abrindo`) — nenhuma prop nova no componente.
- Produces: nenhuma interface nova exportada; só marcação (`data-testid="lista-mobile-contatos"` / `data-testid="tabela-contatos-desktop"`) para o teste.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/contatos-cartoes-mobile.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

/**
 * A tabela HTML pura não tinha NENHUMA classe responsiva — no celular ela
 * rolava na horizontal e o nome do contato podia ficar fora da tela. Abaixo
 * de md a lista vira cartões (mesmo estilo de app/app/tasks/_components/
 * ListaDeTarefas.tsx: rounded-xl border bg-card); a tabela populada
 * continua exatamente igual a partir de md.
 */
describe("Contatos — lista de cartões no celular", () => {
  it("existe uma lista de cartões só no celular", () => {
    const src = fs.readFileSync(path.join(RAIZ, "components/contacts/ContactsTable.tsx"), "utf8");
    expect(src).toContain('<div data-testid="lista-mobile-contatos" className="space-y-2 md:hidden">');
  });

  it("a tabela fica escondida abaixo de md", () => {
    const src = fs.readFileSync(path.join(RAIZ, "components/contacts/ContactsTable.tsx"), "utf8");
    expect(src).toContain('<div data-testid="tabela-contatos-desktop" className="hidden md:block">');
  });

  it("o cartão usa o mesmo estilo de card da tela de Tarefas — identidade visual coerente", () => {
    const src = fs.readFileSync(path.join(RAIZ, "components/contacts/ContactsTable.tsx"), "utf8");
    expect(src).toContain('className="rounded-xl border bg-card p-3"');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run tests/unit/contatos-cartoes-mobile.test.ts`
Expected: FAIL — nenhuma das três strings existe ainda.

- [ ] **Step 3: Implementar**

Em `components/contacts/ContactsTable.tsx`, trocar (linhas 155-157):

```tsx
  return (
    <>
    <Table>
```

por:

```tsx
  return (
    <>
    <div data-testid="lista-mobile-contatos" className="space-y-2 md:hidden">
      {contacts.map((c) => (
        <div key={c.id} className="rounded-xl border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <Link href={`/app/contacts/${c.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
              {displayName(c)}
            </Link>
            <div className="flex shrink-0 items-center gap-0.5">
              {c.conversa ? (
                <Button variant="ghost" size="icon" asChild>
                  <Link
                    href={`/app/inbox?id=${c.conversa.id}`}
                    title={t("Abrir conversa no Inbox")}
                    aria-label={`${t("Abrir conversa com")} ${displayName(c, t)} ${t("no Inbox")}`}
                  >
                    <ChatCircle size={18} weight="regular" aria-hidden />
                  </Link>
                </Button>
              ) : c.phone_number ? (
                <Button
                  variant="ghost"
                  size="icon"
                  title={t("Iniciar conversa no Inbox")}
                  aria-label={`${t("Iniciar conversa com")} ${displayName(c, t)} ${t("no Inbox")}`}
                  disabled={abrindo === c.id}
                  onClick={() => void iniciarConversa(c)}
                >
                  <ChatCircle size={18} weight="regular" aria-hidden />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-error-fg"
                title={t("Excluir contato")}
                aria-label={`${t("Excluir contato")} ${displayName(c, t)}`}
                onClick={() => setAlvo(c)}
              >
                <Trash size={18} weight="regular" aria-hidden />
              </Button>
            </div>
          </div>
          <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            {c.phone_number && <p>{phoneForDisplay(c.phone_number)}</p>}
            {c.email && <p className="truncate">{c.email}</p>}
            {c.last_activity_at && (
              <p className="text-xs">{formatUltimaAtividade(c.last_activity_at, localeDaData)}</p>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {c.is_anonymized && <Badge variant="destructive">{t("Anonimizado")}</Badge>}
            {c.is_blocked && <Badge variant="warning">{t("Bloqueado")}</Badge>}
            {clientesLigado && c.first_service_at && (
              <Badge variant="secondary">{t("Cliente")}</Badge>
            )}
            {!c.is_anonymized && !c.is_blocked && <Badge variant="success">{t("Ativo")}</Badge>}
            {c.tags.map((tag) => (
              <Badge key={tag} variant="neutral">{tag}</Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
    <div data-testid="tabela-contatos-desktop" className="hidden md:block">
    <Table>
```

E, para fechar a nova `<div>`, trocar (linha 285, logo depois de `</Table>`):

```tsx
    </Table>

    <AlertDialog open={alvo !== null} onOpenChange={(open) => { if (!open) setAlvo(null); }}>
```

por:

```tsx
    </Table>
    </div>

    <AlertDialog open={alvo !== null} onOpenChange={(open) => { if (!open) setAlvo(null); }}>
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run tests/unit/contatos-cartoes-mobile.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Rodar typecheck — o JSX ganhou uma div a mais e precisa fechar certo**

Run: `pnpm typecheck`
Expected: sem erro novo em `components/contacts/ContactsTable.tsx`

- [ ] **Step 6: Commit**

```bash
git add components/contacts/ContactsTable.tsx tests/unit/contatos-cartoes-mobile.test.ts
git commit -m "fix(mobile): Contatos vira lista de cartões abaixo de md

A tabela HTML não tinha nenhuma classe responsiva — no celular rolava
na horizontal e o nome podia sair da tela. Mesmo estilo de cartão que
Tarefas já usa (rounded-xl border bg-card), tabela intocada a partir
de md."
```

---

### Task 5: Tarefas — alvos de toque no celular

**Files:**
- Modify: `app/app/tasks/_components/ListaDeTarefas.tsx:86-91,132`
- Test: `tests/unit/tarefas-alvos-de-toque.test.ts` (novo)

**Interfaces:**
- Nenhuma nova — só classes CSS.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/tarefas-alvos-de-toque.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const ARQUIVO = path.join(RAIZ, "app/app/tasks/_components/ListaDeTarefas.tsx");

/**
 * Dois defeitos de toque encontrados na auditoria:
 *
 *  1. O checkbox de concluir era 16px (h-4 w-4) — abaixo de qualquer alvo de
 *     toque confortável.
 *  2. Editar/apagar só apareciam em `:hover` — em toque não existe hover, e
 *     em alguns navegadores móveis esses dois botões ficavam praticamente
 *     inalcançáveis. Isto é bug de uso, não só de estilo.
 *
 * md: preserva o comportamento de mouse de hoje (16px, hover-reveal) —
 * ambos os defeitos eram só no celular.
 */
describe("Tarefas — alvos de toque no celular", () => {
  it("o checkbox de concluir tem alvo maior no celular", () => {
    const src = fs.readFileSync(ARQUIVO, "utf8");
    expect(src).toContain(
      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors md:h-4 md:w-4",
    );
  });

  it("editar/apagar ficam sempre visíveis no celular — hover só a partir de md", () => {
    const src = fs.readFileSync(ARQUIVO, "utf8");
    expect(src).toContain(
      "flex shrink-0 items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100",
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run tests/unit/tarefas-alvos-de-toque.test.ts`
Expected: FAIL — as duas strings não existem ainda.

- [ ] **Step 3: Implementar**

Trocar (linhas 86-91):

```tsx
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-md border transition-colors",
          encerrada
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/40 hover:border-primary",
        )}
```

por:

```tsx
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors md:h-4 md:w-4",
          encerrada
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/40 hover:border-primary",
        )}
```

Trocar (linha 132):

```tsx
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
```

por:

```tsx
        <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100">
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run tests/unit/tarefas-alvos-de-toque.test.ts`
Expected: PASS (2 testes)

- [ ] **Step 5: Commit**

```bash
git add app/app/tasks/_components/ListaDeTarefas.tsx tests/unit/tarefas-alvos-de-toque.test.ts
git commit -m "fix(mobile): alvos de toque em Tarefas — checkbox maior, ações sempre visíveis

Editar/apagar só apareciam em :hover, que não existe em toque — bug de
uso, não só de estilo. md: preserva o comportamento de mouse de hoje."
```

---

### Task 6: Revisão de segurança e gate completo

**Files:**
- Nenhum arquivo de produto — só leitura/verificação. Se algo falhar, o próprio agente desta tarefa conserta o arquivo relevante das Tasks 1-5.

- [ ] **Step 1: Checklist de segurança do que foi tocado**

Ler `lib/navigation/registry.ts` (`bottomNavItems`), `components/shell/MobileBottomNav.tsx`, `components/contacts/ContactsTable.tsx` e confirmar, um por um:

1. `bottomNavItems` não contorna `canSee`/`destinosDaInterface` — ela só chama `sidebarGroups()`, que já filtra por papel. Nenhum item aparece na barra inferior que não apareceria no sidebar/drawer para o mesmo usuário.
2. `MobileBottomNav` não introduz nenhuma chamada de rede nova, nenhum dado de outro tenant, nenhum `dangerouslySetInnerHTML` — é navegação pura (`<Link>`) mais um `Sheet` que já existia.
3. O cartão de contato em `ContactsTable.tsx` usa exatamente os mesmos campos e os mesmos handlers (`iniciarConversa`, `setAlvo`) que a tabela — não abre nenhum caminho novo de exclusão ou de abertura de conversa; é a mesma ação, outro layout.
4. Nenhuma das mudanças de Tasks 3-5 introduz um `<a>`/`<Link>` com `href` construído por concatenação de string vinda de dado do usuário (todas usam os mesmos `href` que o código já usava).

Se qualquer item da lista falhar, corrigir o arquivo correspondente antes de prosseguir — esta tarefa só fecha quando os quatro itens são verdadeiros.

- [ ] **Step 2: Gate completo**

Run: `pnpm gov:verify`

Isto roda, em sequência: `pnpm typecheck && pnpm lint && pnpm lint:channels && pnpm lint:role-rank && pnpm test:unit`.

Expected: tudo verde. Se `test:unit` mostrar os mesmos 2 arquivos/3 testes que já falhavam antes deste plano (`apendice-do-baseline-nao-diverge-da-cadeia.test.ts`, `traducao-nao-defasa.test.ts` — pré-existentes, documentados em `docs/superpowers/specs/2026-09-18-versao-mobile-crm.md`), está OK; qualquer falha NOVA precisa ser corrigida antes de seguir.

- [ ] **Step 3: `pnpm audit` — nenhuma dependência nova foi adicionada, mas confirmar mesmo assim**

Run: `pnpm audit --prod`
Expected: mesmo estado de antes deste plano (nenhuma dependência nova entrou; nenhuma CVE nova).

- [ ] **Step 4: Commit (só se o Step 1 exigiu correção)**

Se nenhum arquivo precisou de correção no Step 1, não há o que commitar nesta tarefa — ela é só verificação. Se algo foi corrigido:

```bash
git add -A
git commit -m "fix(mobile): correção de segurança encontrada na revisão da versão mobile"
```

---

### Task 7: QA manual no navegador (mobile) + preview Vercel

**Files:**
- Nenhum arquivo de produto — QA manual. Qualquer defeito visual/funcional encontrado aqui volta para o arquivo relevante das Tasks 1-5 e ganha seu próprio commit de correção.

- [ ] **Step 1: Subir o servidor local**

Usar a ferramenta de browser embutida (`preview_start` com a config `calixto-dev` de `.claude/launch.json`, que já existe e roda `pnpm dev` na porta 3000).

- [ ] **Step 2: Testar em três larguras de celular + tablet**

Emular 375×812 (iPhone SE), 390×844 (iPhone 13/14), 414×896 (Android grande) e 768×1024 (tablet) e, em cada uma, percorrer:

1. Login → confirma que a página inteira NÃO aparece zerada/encolhida (era o sintoma do bug do Task 1).
2. Depois de logado: a barra de navegação inferior aparece, com os 4 ícones + "Mais"; tocar em cada aba navega para a rota certa; a aba ativa fica destacada.
3. Tocar em "Mais": abre o menu completo (drawer), navega para uma tela que não está na barra (ex.: Configurações), e o drawer fecha ao navegar.
4. Abrir um funil (`/app/pipelines/[id]`): arrastar o dedo na horizontal desliza entre as colunas com scroll-snap (uma etapa de cada vez); abrir o dossiê de um lead ainda funciona; arrastar um card entre colunas (drag-and-drop) ainda funciona.
5. Abrir Contatos: aparece a lista de cartões (não a tabela); tocar no nome abre o contato; tocar no ícone de conversa abre o Inbox; tocar no ícone de lixeira abre a confirmação de exclusão.
6. Abrir Tarefas: os botões de editar/apagar aparecem SEM precisar de hover; tocar no checkbox de concluir funciona (alvo maior que antes).
7. Abrir Inbox e Agenda (semana): confirmar que continuam funcionando como antes — este plano não mudou nada ali, mas é o teste de não-regressão do viewport do Task 1, que afeta a página inteira.
8. Alternar tema claro/escuro: a barra inferior, os cartões de Contatos e as colunas do Kanban acompanham o tema (mesmos tokens de cor do resto do produto).
9. Geometria da barra (emenda das Tasks 2 e 8): em 390×844 em `/app/inbox`, `document.documentElement.scrollHeight <= window.innerHeight` (sem rolagem de página) e o campo de mensagem do Inbox fica INTEIRO acima da barra; as abas medem ≥ 44px de altura; em `/app/kanban` selecionar um ou mais cards e conferir que a `BulkActionBar` (`components/kanban/BulkActionBar.tsx:170`, `sticky bottom-4 z-30`) NÃO fica coberta pela barra inferior — se ficar, corrigir com `bottom-[calc(var(--bottom-nav-h)+1rem)] md:bottom-4`.
10. Rótulos das abas: "Respostas rápidas" trunca em ~67px de célula? Se sim, decidir e aplicar o ajuste mínimo (rótulo mais curto ou `leading-tight` com duas linhas) e conferir também em espanhol.
11. Aba ativa: o destaque é legível nos dois temas? Se só o peso do ícone diferencia, acrescentar `font-semibold` no rótulo ativo.

Qualquer passo que falhar: voltar ao arquivo da Task correspondente, corrigir, rodar os testes daquela Task de novo, e só então continuar o QA daqui.

- [ ] **Step 3: Deploy de preview na Vercel**

O projeto já está linkado (`.vercel/project.json`, `projectName: "calixto-ai-crm"`). Rodar o deploy de preview (via `vercel deploy` ou a ferramenta MCP de deploy) a partir da branch `feature/versao-mobile`.

- [ ] **Step 4: Repetir o Step 2 (itens 1-8) contra a URL de preview**

Confirma que o comportamento é o mesmo em produção-como-vai-rodar, não só no `pnpm dev` local (fonte de diferença possível: cabeçalhos/CSP, compressão, cold start).

- [ ] **Step 5: Commit final (se algo foi corrigido durante o QA)**

Se o QA não exigiu nenhuma correção, não há commit nesta tarefa. Se algo foi corrigido:

```bash
git add -A
git commit -m "fix(mobile): ajuste encontrado no QA manual da versão mobile"
```

---

### Task 8: Painel de chamada acima da barra inferior (emenda — executa DEPOIS da Task 5 e ANTES da Task 6)

Emenda registrada no ledger: a revisão da Task 2 e o implementador acharam que `components/voice/ActiveCallPanel.tsx:102` (`fixed bottom-4 right-4 z-50`) fica por cima da barra inferior no celular e cobre a aba "Mais" enquanto há uma chamada. `BulkActionBar.tsx:170` NÃO entra aqui: se ela fica coberta depende de o `sticky` ter mesmo o viewport como referência, o que só a Task 7 mede num navegador.

**Files:**
- Modify: `components/voice/ActiveCallPanel.tsx:102`
- Test: `tests/unit/painel-de-chamada-acima-da-barra.test.ts` (novo)

**Interfaces:**
- Consumes: `--bottom-nav-h` (definida em `app/globals.css`, `@layer base`, regra `html`, pela Task 2).

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/painel-de-chamada-acima-da-barra.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

/**
 * O painel de chamada é `fixed`, então a barra de navegação inferior do
 * celular (também `fixed`, z-30) ficava ABAIXO dele: durante uma chamada o
 * painel (z-50) cobria a aba "Mais". Abaixo de md ele sobe a altura da barra
 * (`--bottom-nav-h`, a mesma variável que a barra e o `<main>` usam); a
 * partir de md a barra some e o painel volta ao `bottom-4` de sempre.
 */
describe("painel de chamada acima da barra inferior", () => {
  it("sobe a altura da barra no celular e volta a bottom-4 a partir de md", () => {
    const src = fs.readFileSync(path.join(RAIZ, "components/voice/ActiveCallPanel.tsx"), "utf8");
    expect(src).toContain(
      'className="fixed bottom-[calc(var(--bottom-nav-h)+1rem)] right-4 z-50 flex w-[min(320px,calc(100%-2rem))] items-center gap-3 rounded-xl border border-border bg-popover p-3 shadow-2xl animate-in fade-in slide-in-from-bottom-4 md:bottom-4"',
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run tests/unit/painel-de-chamada-acima-da-barra.test.ts`
Expected: FAIL — a string nova não existe ainda.

- [ ] **Step 3: Implementar**

Em `components/voice/ActiveCallPanel.tsx`, trocar (linha 102):

```tsx
      className="fixed bottom-4 right-4 z-50 flex w-[min(320px,calc(100%-2rem))] items-center gap-3 rounded-xl border border-border bg-popover p-3 shadow-2xl animate-in fade-in slide-in-from-bottom-4"
```

por:

```tsx
      className="fixed bottom-[calc(var(--bottom-nav-h)+1rem)] right-4 z-50 flex w-[min(320px,calc(100%-2rem))] items-center gap-3 rounded-xl border border-border bg-popover p-3 shadow-2xl animate-in fade-in slide-in-from-bottom-4 md:bottom-4"
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run tests/unit/painel-de-chamada-acima-da-barra.test.ts`
Expected: PASS. Rodar também os testes existentes que citam `ActiveCallPanel` (`grep -l ActiveCallPanel tests/unit`) — se algum assertir a classe antiga `bottom-4`, atualizá-lo minimamente e dizer qual.

- [ ] **Step 5: Commit**

```bash
git add components/voice/ActiveCallPanel.tsx tests/unit/painel-de-chamada-acima-da-barra.test.ts
git commit -m "fix(mobile): painel de chamada sobe acima da barra inferior

fixed bottom-4 z-50 ficava por cima da barra no celular e cobria a aba
Mais durante toda chamada. Abaixo de md sobe --bottom-nav-h; a partir de
md volta ao bottom-4 de sempre."
```

---

## Self-Review

- **Cobertura do spec:** os 7 itens de escopo do spec (`docs/superpowers/specs/2026-09-18-versao-mobile-crm.md`) têm task correspondente — viewport (T1), barra inferior (T2), Kanban (T3), Contatos (T4), Tarefas (T5), segurança/gate (T6), QA+preview (T7). Os itens "fora de escopo" (dashboard nova, Inbox, Agenda semana/mês, Playwright novo) não têm task — de propósito.
- **Sem placeholder:** toda task tem código real, com `className` exatos e caminhos de arquivo com número de linha; nenhum "TODO"/"adicionar validação apropriada" em lugar nenhum.
- **Consistência de tipos:** `bottomNavItems` usa a mesma assinatura de `sidebarGroups` (`isPlatformAdmin: boolean, role: Role | null, settings?: InterfaceSettings`) e devolve `NavDestination[]`, o mesmo tipo que `NAV_DESTINATIONS`/`sidebarGroups` já usam — nenhum tipo novo inventado. `MobileBottomNav` consome exatamente esse retorno sem transformação extra.
