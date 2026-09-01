# Handoff para continuar o trabalho no Codex

> Estado do fork em **2026-08-31**. Escrito para quem vai retomar este repositório
> em outra ferramenta (Codex, Cursor, outra sessão) sem ter acompanhado a anterior.
>
> **Este arquivo não contém senhas nem chaves.** Os segredos vivem em `.env.local`,
> que é ignorado pelo Git e nunca sobe. Peça-os a quem administra a instalação.

---

## O que é este repositório

Fork do [DeskcommCRM](https://github.com/melgarafael/DeskcommCRM) — CRM open source
de vendas por WhatsApp com agentes de IA, multi-tenant, self-host. Partiu da
**v1.8.0** (commit `d2be828c`).

O objetivo do fork é **entregar o CRM já configurado a empresas clientes**. Esse
eixo decide o produto: telas que configuram a organização inteira são de quem
instala, não de quem usa. Quando a decisão for ambígua, é essa a régua.

**Stack:** Next.js 16 (App Router, Turbopack) · React 19 · TypeScript 6 estrito ·
Tailwind + shadcn/ui · Supabase (Postgres + Auth + Storage + RLS) · WhatsApp via
WAHA · Vercel AI SDK. 101 telas, 225 rotas de API, 112 tabelas.

**Remotes:**

| remote | aponta para | serve para |
|---|---|---|
| `origin` | `TheJhonboy/CRM-DEMO-teste` (privado) | onde o trabalho é publicado |
| `upstream` | `melgarafael/DeskcommCRM` | puxar atualizações do projeto original |

---

## Leia isto antes de escrever código

O repositório tem **doutrina própria e obrigatória** em [`CLAUDE.md`](CLAUDE.md) —
não é documentação decorativa, é o contrato que o CI cobra. O que mais custa caro
quando ignorado:

1. **Multi-tenancy.** Toda tabela tenant-aware leva `organization_id` e RLS. O
   service role burla RLS, então todo handler que o usa **filtra
   `organization_id` manualmente**, resolvido de fonte confiável (cookie, JWT,
   segredo de webhook) — **nunca do corpo da requisição**. No backend é sempre
   `getUser()`, jamais `getSession()`.
2. **Mudança de schema sai em tripla:** arquivo em `supabase/migrations/` +
   apêndice idempotente no `supabase/baseline.sql` + linha no `MANIFEST.md`. O kit
   self-host aplica **só o baseline** — o que não chega lá não chega a quem
   instalou numa VPS.
3. **Nenhuma feature nomeia um provider.** Provider vive em `lib/channels/`.
   `pnpm lint:channels` é catraca com lista de dívida que só encolhe.
4. **Mudança visível a quem opera uma VPS exige um fragmento em `.changes/`**
   declarando o impacto (`nada_mudou` / `capacidade_nova` / `exige_acao`).
   Confira com `pnpm release:conferir`.
5. **A Definition of Done exige prova pela tela**, não só teste verde. `curl` não
   conta como prova de UX.

Há uma skill `DeskcommCRM` em `.claude/skills/` que carrega isso. Em outra
ferramenta, leia o `CLAUDE.md` direto — ou o [`AGENTS.md`](AGENTS.md), que é o
mesmo contrato em formato portável para Codex/Cursor/Copilot.

---

## Como subir o ambiente

Pré-requisitos: **Node 22+** e **pnpm**. Numa máquina limpa, o Node sai por
`winget install OpenJS.NodeJS.LTS` e o pnpm por `corepack prepare pnpm@9.15.9 --activate`.

```bash
pnpm install
# preencha .env.local — veja a seção "Configuração" abaixo
pnpm dev          # http://localhost:3000
```

### Configuração mínima

Só **três** variáveis são obrigatórias em desenvolvimento (`lib/env.ts` valida no
boot e derruba o app se faltarem):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

O resto do `.env.local` já está preenchido com segredos de desenvolvimento
gerados localmente (chaves de cifra, `INTERNAL_SECRET`) e com `APP_NAME`.
Modelo completo e comentado em [`.env.example`](.env.example).

### Banco

O projeto Supabase em uso está no **plano gratuito (500 MB)** — hoje em ~22 MB.
**Não rode os `scripts/seed-*.ts`**: são 28 scripts que populam dados de teste e
o limite é apertado. O `CHANGELOG` registra um caso real em que a tabela de log
de webhooks virou 86% do banco e estourou a cota.

Para um banco novo, o schema **não** sobe pelas migrations (as 0001–0009 e 0013
são stubs). Aplique o baseline:

```bash
psql "$DB_URL" -c 'create extension if not exists vector with schema public;
                   create extension if not exists citext with schema public;
                   create extension if not exists pg_trgm with schema public;'
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/baseline.sql
```

### Primeiro usuário

**Não existe tela de cadastro** — `/signup` é 404 de propósito. O dono se cria
por script, que também cria a organização e o promove a super-admin:

```bash
OWNER_EMAIL=... OWNER_PASSWORD=... OWNER_ORG_NAME=... npx tsx scripts/bootstrap-owner.ts
```

---

## ⚠️ Armadilhas do Windows

Duas mordem em silêncio e custaram tempo. Ambas já estão contornadas neste clone,
mas quem clonar de novo volta a pegá-las:

**1. `core.autocrlf` corrompe o schema.** O Git no Windows converte quebras de
linha, e o `baseline.sql` tem uma trava de md5 sobre o corpo de um playbook. Com
CRLF ela falha e o schema **não aplica**:

```
ERRO: playbook agendamento: o md5 declarado (...) nao corresponde ao corpo inserido.
```

Correção, antes de qualquer coisa:

```bash
git config core.autocrlf false && git config core.eol lf
git rm --cached -r . && git reset --hard HEAD
```

**2. `pnpm test:unit` tem ~153 falhas pré-existentes** de 5.382 testes. São testes
de governança que invocam `npx`/bash e quebram no ambiente Windows
(`spawnSync npx ENOENT`) — **não são regressão**. `pnpm typecheck` e `pnpm lint`
passam limpos e são a régua confiável aqui.

---

## O que já foi feito neste fork

Dois commits sobre a v1.8.0:

### `62a08b40` — `fix(lint-channels)`

`scripts/lint-channels.ts` reprovava a árvore limpa em qualquer máquina Windows.
`walk()` montava caminhos com `join()` (separador `\`), enquanto as três
comparações do script usam barra POSIX. Nenhuma casava: `lib/channels/**` — o
único lugar onde nomear o provider é permitido — era acusado de violação, e as
listas de "vazamento novo" e "apague da lista" saíam idênticas. Invisível no CI,
que roda em Linux.

### `87acf48b` — `feat(onboarding)`

O assistente de instalação de 6 passos era a primeira tela de **qualquer** pessoa
numa organização sem `onboarded_at` — o gate em `app/app/layout.tsx` não olhava
quem chegava. Num produto entregue configurado, o vendedor que abria a Inbox caía
numa tela que decide o nicho que treina o agente, o fuso da janela de envio e o
funil do time inteiro.

A regra virou `lib/onboarding/quem-passa-pelo-wizard.ts`, cobrindo as **duas
portas** — o desvio do `/app/*` e a URL digitada direto em `/onboarding`. Regra
duplicada em dois layouts divergiria no primeiro conserto, e portas que discordam
viram laço de redirect infinito (há teste para isso).

Também: a primeira opção de região passou a citar **Goiânia e Centro-Oeste**. É o
mesmo `America/Sao_Paulo` de sempre — mudou o rótulo, não o fuso.

Provado na tela: dono cai no assistente; usuário `agent` na mesma organização
entra direto na Inbox; o mesmo usuário digitando `/onboarding` volta para a Inbox.
Sabotar a regra deixa a suíte vermelha.

### Fora do Git: a marca

O nome da instalação é **"Calixto IA"**. Isso **não está em nenhum arquivo do
repositório** — é configuração, e o sistema é white-label de propósito. Ele vive
em dois lugares, nesta ordem de precedência:

1. **`platform_branding.app_name` no banco** — a fonte que manda. Editável em
   **Admin › Marca**.
2. **`APP_NAME` no `.env`** — semente e piso de rollback.

Numa instalação nova, defina `APP_NAME` ou troque pela tela após instalar. A cor
(`accent_hex`, hoje `#d9a441`) e o logo saem da mesma tela.

---

## Verificação antes de abrir PR

```bash
pnpm typecheck        # tsc --noEmit estrito
pnpm lint             # eslint (286 warnings pré-existentes, 0 erros)
pnpm test:unit        # vitest — ver a ressalva do Windows acima
pnpm lint:channels    # catraca de provider
pnpm release:conferir # valida os fragmentos de .changes/
```

Os cinco checks obrigatórios da `main` do projeto original são `verify`,
`build-and-size`, `invariants`, `e2e` e `imagens-ok`. `pnpm gov:verify` **não**
cobre `test:db` nem `test:e2e` — verde ali não prova mudança de schema nem de UI.

---

## O que ficou pendente

1. **Publicar estes commits.** Estavam apenas locais quando este arquivo foi
   escrito, por falta de credencial do GitHub na máquina. O repositório de destino
   tem um README próprio e histórico independente, então o primeiro push precisa
   de `--allow-unrelated-histories`.
2. **Decisão em aberto:** o painel do React Query (o ícone flutuante no canto).
   Ele já só aparece em `NODE_ENV=development` e nunca chega ao cliente. As opções
   discutidas: remover, esconder atrás de atalho de teclado, ou deixar.
3. **Nada de WhatsApp, IA ou e-mail está configurado.** WAHA, provedor de IA,
   Upstash, Resend e Sentry seguem sem credencial — o app sobe e funciona sem
   eles. `docs/SETUP.md` é o tutorial completo de todas as integrações.
