# Perfis locais do Calixto AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar contas locais idempotentes para demonstrar as visões de desenvolvedor, dono e atendente sem alterar o RBAC de produção.

**Architecture:** Reutilizar `platform_admins` para desenvolvedor e `user_organizations.role` para dono e atendente. O script escolhe uma organização existente pelo slug, só roda contra um endpoint local e mantém a senha exclusivamente em memória de processo.

**Tech Stack:** TypeScript, Supabase Admin API, Vitest, Next.js 16.

**Spec:** `docs/superpowers/specs/2026-09-04-perfis-calixto-ai.md`

## Global Constraints

- Não criar papel, tabela, migration ou regra de RLS nova.
- Nunca ler, registrar ou versionar valores de `.env*`.
- Recusar endpoint Supabase que não seja local.
- A navegação segue `lib/navigation/registry.ts`; páginas e APIs mantêm os próprios guards.
- Não criar commit sem autorização explícita do responsável.

---

### Task 1: Formalizar as três visões existentes

**Files:**
- Modify: `lib/navigation/registry.ts`
- Create: `tests/unit/perfis-calixto.test.ts`

**Interfaces:**
- Consumes: `canSee(destination, isPlatformAdmin, role)` da navegação.
- Produces: testes que declaram a visibilidade esperada de desenvolvedor, dono e atendente.

- [ ] Escrever teste com `sidebarGroups(true, "agent")`, `sidebarGroups(false, "admin")` e `sidebarGroups(false, "agent")`.
- [ ] Verificar que desenvolvedor vê destinos de análise, dono vê conexões e atendente não vê configurações, conexões ou montagem de IA.
- [ ] Ajustar somente `minRole` quando o registro contradisser a especificação; não enfraquecer guard de página/API.
- [ ] Rodar o arquivo Vitest até ficar verde.

### Task 2: Preparador local de contas

**Files:**
- Create: `scripts/bootstrap-demo-accounts.ts`
- Create: `tests/unit/bootstrap-demo-accounts.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `DEMO_PASSWORD`, `DEMO_ORG_SLUG` opcional e variáveis Supabase já existentes no processo local.
- Produces: comando `pnpm demo:accounts` que cria `dev@calixto.local`, `dono@calixto.local` e `atendente@calixto.local`.

- [ ] Escrever testes puros para a validação de URL local e para o plano de três perfis.
- [ ] Implementar funções puras exportadas: `isLocalSupabaseUrl(url)` e `demoAccounts()`.
- [ ] Implementar execução idempotente: localizar a organização, criar/atualizar usuário, inserir/reativar associação e garantir platform admin do desenvolvedor.
- [ ] Recusar senha ausente, URL ausente, URL não local e organização não encontrada antes de qualquer mutação.
- [ ] Adicionar o script `demo:accounts` e rodar seus testes até ficarem verdes.

### Task 3: Verificação proporcional

**Files:**
- Modify: `docs/testing/user-journey-map.md` se houver ambiente E2E disponível.

- [ ] Rodar testes unitários específicos, typecheck e lint.
- [ ] Iniciar o CRM local e verificar visualmente a navegação em cada perfil quando o Supabase local estiver disponível.
- [ ] Rodar E2E somente após gerar `.env.e2e` com Supabase local; registrar bloqueio se Docker não estiver instalado.

## Self-review

- A especificação não introduz um novo papel; o plano reutiliza os dois mecanismos de autorização existentes.
- Cada requisito de aceite possui tarefa e teste correspondente.
- Não há senha, URL privada ou instrução de produção no plano.
