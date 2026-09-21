# Redesign profissional do modo claro — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converter todo o modo claro do Calixto AI para a identidade premium branca, off-white e verde-floresta da referência, sem alterar o modo escuro nem qualquer comportamento do CRM.

**Architecture:** A mudança parte dos tokens canônicos em `app/globals.css`, é espelhada na vitrine e na régua de branding e chega às telas por classes semânticas do Tailwind. Componentes compartilhados recebem apenas refinamentos de superfície, raio, foco e estados; regras de negócio, rotas, banco, APIs e handlers permanecem intocados.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Tailwind CSS 3, shadcn/Radix, Vitest 4 e Playwright 1.

**Spec:** `C:\Users\Usuario\.codex\attachments\a3e5534b-59f1-47a8-a283-afc22a8b8f84\pasted-text.txt`

## Global Constraints

- Preservar integralmente os valores dentro de `[data-theme="dark"]`.
- Não alterar funcionalidade, rotas, autenticação, API, banco, modelos, integrações, permissões ou textos.
- Centralizar cores visuais em tokens; manter cores semânticas específicas quando necessárias.
- Manter responsividade e foco visível; não introduzir dependências.
- Validar light → dark → light → dark no navegador real.

---

### Task 1: Contrato automatizado do tema claro

**Files:**

- Create: `tests/unit/calixto-light-theme.test.ts`
- Create: `tests/unit/light-shared-surfaces.test.tsx`
- Create: `tests/unit/light-shell-surfaces.test.tsx`

**Interfaces:**

- Consumes: `PALETTES.sage`, `REGUA_DO_PRODUTO`, componentes `ui/*` e shell existentes.
- Produces: contrato de regressão para paleta, contraste e classes semânticas do modo claro.

- [ ] Escrever testes que exijam fundo `#f3f4f3`, superfície branca, elevado `#fafaf9`, texto `#121714`, borda `#e3e6e3`, verde principal `#21744b` e sidebar clara.
- [ ] Rodar os três testes e confirmar falha pelos valores azulados antigos.
- [ ] Manter os testes mínimos e sem mocks de implementação visual além dos mocks já necessários ao shell.

### Task 2: Tokens canônicos e branding

**Files:**

- Modify: `app/globals.css`
- Modify: `app/design/lib/tokens.ts`
- Modify: `lib/branding/regua-do-produto.ts`
- Modify: `tailwind.config.ts`

**Interfaces:**

- Consumes: contrato de extração de `lib/branding/contraste.ts` e aliases shadcn existentes.
- Produces: tokens claros centralizados para fundo, canvas, superfícies, texto, bordas, sidebar, estados, foco, sombra e scrollbars.

- [ ] Atualizar apenas `:root` e `[data-theme="light"]`, mantendo a mesma lista de propriedades exigida pelo espelhamento.
- [ ] Espelhar a paleta em `PALETTES.sage` e regenerar manualmente a régua conforme a mensagem do teste canônico.
- [ ] Ajustar raios, sombras e transição global sem alterar o bloco escuro.
- [ ] Rodar testes de branding e tema até ficarem verdes.

### Task 3: Componentes compartilhados

**Files:**

- Modify: `components/ui/button.tsx`
- Modify: `components/ui/card.tsx`
- Modify: `components/ui/input.tsx`
- Modify: `components/ui/textarea.tsx`
- Modify: `components/ui/select.tsx`
- Modify: `components/ui/dropdown-menu.tsx`
- Modify: `components/ui/dialog.tsx`
- Modify: `components/ui/alert-dialog.tsx`
- Modify: `components/ui/sheet.tsx`
- Modify: `components/ui/tabs.tsx`
- Modify: `components/ui/table.tsx`
- Modify: `components/ui/popover.tsx`
- Modify: `components/ui/tooltip.tsx`

**Interfaces:**

- Consumes: classes Tailwind semânticas (`bg-bg`, `bg-surface`, `border-border`, `text-text`, `bg-accent`).
- Produces: controles claros com superfícies brancas, raio 10–18 px, sombras suaves, estados hover/focus/selected/disabled consistentes e overrides escuros explícitos quando necessários.

- [ ] Implementar apenas classes visuais cobertas pelos testes da Task 1.
- [ ] Rodar os testes de componentes compartilhados e preservar os contratos do tema escuro.
- [ ] Revisar acessibilidade de foco, contraste e alvos de toque.

### Task 4: Shell, Inbox, Agenda e Kanban

**Files:**

- Modify: `components/shell/Sidebar.tsx`
- Modify: `components/shell/TopBar.tsx`
- Modify: `components/kanban/StageColumn.tsx`
- Modify: `components/kanban/KanbanCard.tsx`
- Modify somente os componentes de Inbox/Agenda encontrados na auditoria que ainda ignorem tokens.

**Interfaces:**

- Consumes: tokens e componentes compartilhados das Tasks 2–3.
- Produces: sidebar clara integrada, topbar branca, workspace off-white, lista de conversas/agenda/kanban com hierarquia leve e cabeçalhos semânticos dessaturados.

- [ ] Substituir hardcodes visuais incompatíveis por tokens, sem tocar em handlers ou dados.
- [ ] Manter a navegação ativa verde suave com texto verde profundo no claro e menta no escuro.
- [ ] Rodar testes do shell, kanban e regressões de dark mode.

### Task 5: Auditoria visual sistêmica

**Files:**

- Modify: somente arquivos visuais identificados por `rg` e comprovados no navegador.
- Create: `.changes/calixto-light-mode-profissional.md`

**Interfaces:**

- Consumes: CRM local autenticado e rotas existentes.
- Produces: modo claro consistente nas telas principais, sem overflow e sem regressão escura.

- [ ] Buscar hex/rgb/hsl, `bg-white`, `bg-black`, `text-white`, `text-black` e famílias gray/slate/zinc/neutral; classificar cada ocorrência antes de alterar.
- [ ] Verificar Dashboard/Inbox/Radar/Agenda/Templates/Funis/Contatos/Agentes/Follow-ups/Roteadores/Conexões/Webhooks/Métricas/Configurações e detalhes disponíveis.
- [ ] Testar modais, drawers, dropdowns, pesquisa, hover, foco, selected, disabled e estados vazios acessíveis.
- [ ] Testar desktop, notebook e mobile; confirmar ausência de overflow horizontal.
- [ ] Alternar light → dark → light → dark e comparar tokens computados.

### Task 6: Verificação final

**Files:**

- Verify: toda a árvore modificada no worktree.

**Interfaces:**

- Consumes: implementação completa.
- Produces: evidência reproduzível da qualidade e lista transparente de limitações ambientais.

- [ ] Rodar `git diff --check`.
- [ ] Rodar testes unitários focados e `pnpm test:unit` quando viável.
- [ ] Rodar `pnpm typecheck`, `pnpm lint` e `pnpm build`.
- [ ] Rodar E2E se o ambiente local seguro existir; se a proteção impedir, registrar a causa sem contornar `.env.e2e`.
- [ ] Revisar o diff para confirmar que nenhuma lógica de produto, API, schema ou segredo entrou na mudança.
