# Versão mobile do CRM — Spec

## Problema

O CRM é usável no celular hoje (o Tailwind já colapsa várias telas abaixo de
`md`), mas duas coisas o deixam pior do que devia:

1. ~~`app/layout.tsx` não declara `width`/`initialScale` no `viewport`~~ — **premissa FALSA, corrigida em 2026-09-19.** A primeira versão deste spec dizia que, sem isso, o navegador mobile assumia um viewport de ~980px e todo o CSS responsivo nunca disparava num aparelho físico. Não é verdade: o Next.js parte de `createDefaultViewport()` (`width: 'device-width', initialScale: 1`, `node_modules/next/dist/lib/metadata/default-metadata.js:23`) e mescla o `viewport` do app POR CIMA (`resolve-metadata.js:835`), então a página já emitia `<meta name="viewport" content="width=device-width, initial-scale=1">` antes desta branch (confirmado no HTML servido). A conclusão foi tirada de uma leitura do código sem conferir o HTML emitido. O commit que "corrigia" isso foi desfeito na prática pelo commit `b7ddf0b8`; o que sobra é um teste que fixa o padrão do Next e proíbe `maximumScale`/`userScalable` (zoom) e `viewport-fit=cover` (ver Errata no plano).
2. **Não existe navegação em formato de app** — só um menu-gaveta acionado
   por um ícone de hambúrguer no topo. A referência que o usuário enviou
   (health app com barra de abas fixa no rodapé) pede exatamente esse
   padrão, e é o que falta aqui.

Além disso, uma auditoria linha-a-linha das telas de uso diário encontrou:

- **Kanban (`components/kanban/StageColumn.tsx:95`)**: colunas de 320px
  fixos, sem nenhuma classe responsiva — no celular é scroll horizontal cru,
  sem indicação de onde uma coluna termina e a próxima começa.
- **Contatos (`components/contacts/ContactsTable.tsx`)**: `<table>` HTML
  pura, sem nenhuma classe responsiva — no celular rola na horizontal, o
  nome do contato pode ficar fora da tela.
- **Tarefas (`app/app/tasks/_components/ListaDeTarefas.tsx:132`)**: os
  botões de editar/apagar só aparecem em `:hover` — em toque não existe
  hover, então em alguns navegadores móveis esses botões ficam
  praticamente inacessíveis. Isto é um bug de uso, não só de estilo.

Duas telas de uso diário já estavam bem: **Inbox**
(`components/inbox/InboxLayout.tsx`) já é uma coluna só abaixo de `md`, com
barra de voltar e painel de CRM num `Sheet`; e a **Agenda**, na visão semana
(`components/agenda/GradeDaAgenda.tsx:545-569`), já colapsa para um dia só
abaixo de `md` — com teste próprio
(`components/agenda/GradeDaAgenda.mobile.test.tsx`). Nenhuma das duas entra
neste plano.

## Decisões (da rodada de esclarecimento com o usuário)

- Implementação direta no código do CRM (Next.js/Tailwind), não a ferramenta
  externa Superdesign — o pedido final é código funcional testado, não um
  rascunho visual hospedado em outro serviço.
- Cores: as do CRM (tokens de `app/globals.css`), claro e escuro — nada da
  paleta teal/azul-marinho da imagem de referência. O que se aproveita da
  referência é o PADRÃO (barra de abas fixa no rodapé, cartões, densidade
  tocável), não a paleta.
- Deploy de preview na Vercel autorizado sem confirmação adicional (projeto
  já linkado: `calixto-ai-crm`, `.vercel/project.json`).
- QA em navegador real, sem login: (a) a tela pública de login no navegador
  embutido em 375/768, claro e escuro; (b) um harness que renderiza os componentes
  REAIS com o CSS de PRODUÇÃO (`pnpm build`) e mede geometria no Chromium
  (708 medições em 375/390/414/768/1280 × claro/escuro, 114 capturas); (c) preview
  na Vercel a partir de uma exportação limpa do commit final. **Não foi possível
  clicar no app autenticado**: o `.env.local` aponta para um Supabase hospedado
  (o banco real), não há Docker/Supabase local nem `.env.e2e` (a suíte e2e do
  repo não roda), e digitar senha ou criar conta não é algo que o agente faça —
  isso fica para o usuário fazer uma vez no painel do navegador ou no celular.

## Escopo

1. ~~Corrigir o `viewport` do layout raiz~~ — retirado: o Next já emite o meta certo (ver Problema 1).
2. Barra de navegação inferior mobile (bottom nav), reaproveitando
   `sidebarGroups()`/`canSee` — os mesmos 4 primeiros destinos que já
   aparecem no topo do menu lateral, na ordem que o produto já usa
   (`lib/navigation/catalogo.ts`, comentário de `NAV_GROUPS`), mais uma
   quinta aba "Mais" que abre o menu completo existente
   (`components/shell/Sidebar.tsx` → `SidebarContent`, reaproveitado, não
   duplicado).
3. Kanban: colunas com `scroll-snap` e largura de ~85vw no celular (`md:`
   preserva os 320px de hoje) — sensação de "arrastar para o próximo
   estágio" em vez de scroll cru.
4. Contatos: lista de cartões abaixo de `xl` (1280px) e tabela a partir de `xl` —
   medido em navegador: a tabela precisa de ~968px mais os 240px do menu lateral,
   então de 768 a 1279 ela era inutilizável (só a coluna Nome cabia). O cartão usa o
   mesmo desenho (`rounded-xl border bg-card`) que a tela de Tarefas, e o celular
   ganha uma fileira de chips de ordenação (a tabela escondida levava os cabeçalhos
   ordenáveis embora).
5. Tarefas: alvo de toque de 44px no checkbox e nos botões e ações sempre visíveis
   em ponteiros grosseiros (toque) em QUALQUER largura — `pointer-fine:` reserva o
   comportamento de mouse (hover) para quem tem mouse; medido: em tablets de toque
   a partir de 768 as ações ficavam invisíveis e ainda assim tocáveis. O apagar em
   dois toques ganhou uma guarda de 500 ms contra o toque duplo reflexo.
6. Revisão de segurança do que foi tocado (visibilidade por papel na nova
   navegação, nenhuma chamada nova ao backend, nenhum dado sensível exposto)
   + `pnpm gov:verify` limpo.
7. QA manual em viewport mobile (local + preview Vercel) de cada tela
   tocada, com prints/anotação de qualquer defeito encontrado e corrigido
   ali mesmo.

## Fora de escopo (e por quê)

- Dashboard mobile "estilo saúde" (saudação + cartões de métricas como na
  imagem de referência): o CRM não tem uma tela-dashboard hoje — `/app`
  redireciona por papel para `/app/inbox` (`lib/navigation/interface.ts:93-
  100`, `homeDaInterface`), uma decisão de produto documentada e testada.
  Criar uma tela nova mudaria essa decisão sem pedido explícito para isso;
  fica de fora até o usuário pedir uma dashboard de verdade.
- Inbox e Agenda (visão semana): já mobile-friendly, com teste cobrindo a
  Agenda. Retrabalhar o que já funciona não está no pedido.
- Agenda (visão mês): células de 80px com dois chips truncados — visualmente
  denso, mas não é alvo de toque quebrado (a visão mês hoje não tem clique
  nenhum na célula). Fica de fora por não ser uma avaria, só densidade
  visual, e o usuário pediu correção de avaria/abertura, não redesenho
  estético de toda tela.
- Playwright/e2e novo para mobile: o e2e existente já é frágil e exige
  ambiente Supabase local; QA manual cobre o pedido sem esse custo.
