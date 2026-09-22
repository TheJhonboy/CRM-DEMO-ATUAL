# Redesign profissional do modo escuro — Calixto AI CRM

> **Especificação aprovada:** `C:\Users\Usuario\.codex\attachments\9f25dc58-bd52-4b7c-8333-5bd5a365a054\pasted-text.txt`
>
> **Referência visual aprovada:** captura de tela colada pelo autor na sessão do Codex de 12/09/2026 (não versionada; a paleta que ela mostra está descrita nos critérios de aceite abaixo).

## Objetivo

Substituir o tema escuro quente/acinzentado por uma interface premium em carvão azulado e verde-menta, sem alterar o modo claro, a estrutura de navegação, regras de negócio, rotas, APIs ou banco de dados.

## Estratégia

1. Proteger o contrato visual com testes de tokens, contraste, espelhamento de marca e componentes compartilhados.
2. Centralizar a nova paleta nos tokens globais e nos dois espelhos de branding já existentes.
3. Refinar apenas componentes compartilhados que precisem de hierarquia explícita: barra superior, navegação lateral, overlays e kanban.
4. Revisar cores literais restantes por contexto, preservando branco funcional de QR codes e ilustrações.
5. Validar o modo claro e escuro com testes automatizados, build e inspeção real no navegador em desktop, tablet e mobile.

## Arquivos previstos

- `app/globals.css`
- `app/design/lib/tokens.ts`
- `lib/branding/regua-do-produto.ts`
- `tailwind.config.ts`
- `components/shell/TopBar.tsx`
- `components/shell/Sidebar.tsx`
- `components/ui/dialog.tsx`
- `components/ui/alert-dialog.tsx`
- `components/ui/sheet.tsx`
- `components/kanban/StageColumn.tsx`
- testes unitários de tema/branding e fragmento em `.changes/`

## Critérios de aceite

- Paleta escura usa `#0B1115`, `#10171C`, `#151D23`, `#202A31` e `#83E6A3` conforme a especificação.
- Ações em menta usam texto escuro `#07110B`.
- Sidebar, topbar, cards, inputs, tabelas, dropdowns, modais e kanban mantêm hierarquia clara e foco visível.
- O modo claro permanece visual e funcionalmente inalterado.
- Typecheck, lint, testes unitários relevantes e build passam.
- As rotas principais são verificadas visualmente no navegador, incluindo responsividade e interação básica.
