# Versão mobile do CRM — Spec

## Problema

O CRM é usável no celular hoje (o Tailwind já colapsa várias telas abaixo de
`md`), mas duas coisas o deixam pior do que devia:

1. **`app/layout.tsx` não declara `width`/`initialScale` no `viewport`.** Sem
   isso, navegador mobile assume um viewport de layout ~980px e desenha a
   página inteira zerada — todo o trabalho responsivo que já existe
   (`Sidebar` escondida abaixo de `md`, `InboxLayout` de uma coluna, a semana
   da Agenda colapsando para um dia) nunca dispara de verdade num aparelho
   físico, porque a media query nunca vê a largura real da tela. Este é o
   "avaria" mais severo encontrado: um defeito de plataforma, não de tela.
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
- Teste manual no navegador embutido (viewports 375/390/414/768) + preview
  Vercel. Sem Playwright/e2e novo: a suíte e2e existente exige Supabase local
  configurado (`pnpm e2e:env`) e todo o ambiente de teste; criar um projeto
  Playwright novo só para isto é desproporcional ao escopo.

## Escopo

1. Corrigir o `viewport` do layout raiz (base de tudo — sem isso o resto não
   se comprova em aparelho real).
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
4. Contatos: lista de cartões abaixo de `md`, tabela preservada a partir de
   `md` — mesmo receio visual (`rounded-xl border bg-card`) que a tela de
   Tarefas já usa, para manter a identidade visual coerente entre telas.
5. Tarefas: alvo de toque do checkbox maior no celular; botões de
   editar/apagar sempre visíveis no celular (hover preservado só a partir de
   `md`, onde hover existe de verdade).
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
