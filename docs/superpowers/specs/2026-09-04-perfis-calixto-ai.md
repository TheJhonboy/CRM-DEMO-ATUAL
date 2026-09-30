# Perfis locais do Calixto AI

## Objetivo

Permitir que o responsável veja o CRM local como desenvolvedor, dono e atendente, sem criar uma nova hierarquia de banco nem ampliar permissões existentes.

## Decisões confirmadas

- **Desenvolvedor** usa o acesso transversal existente `is_platform_admin` e enxerga todos os tenants e análises de plataforma.
- **Dono** usa o papel humano existente `admin` apenas na organização de demonstração.
- **Atendente** usa o papel humano existente `agent`, com a visibilidade de conversas já limitada pelo CRM a itens próprios e não atribuídos.
- A barra lateral continua sendo uma projeção de `lib/navigation/registry.ts`; a proteção real permanece nas páginas, APIs e RLS.
- As três contas são exclusivas do ambiente local. A senha é recebida ao executar o preparador e nunca entra no Git, em documentação ou em saída de log.

## Fora de escopo

- Criar um novo papel no banco ou mudar RLS.
- Alterar regras de mapeamento dos funis sem uma regra de negócio fornecida pelo responsável.
- Criar contas ou gravar credenciais em produção.

## Critérios de aceite

- Um preparador idempotente cria ou atualiza as três contas na organização local selecionada.
- A conta de desenvolvedor recebe `platform_admins`; dono recebe `admin`; atendente recebe `agent`.
- O menu de cada conta é calculado pelo registro de navegação existente.
- Testes unitários provam os três perfis e o preparador rejeita execução fora do ambiente local.
