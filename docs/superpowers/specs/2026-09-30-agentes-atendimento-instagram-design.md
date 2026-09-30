# Agentes de atendimento (WhatsApp + Instagram) e agente administrador — design

Data: 2026-09-30. Branch: `feat/agentes-atendimento-instagram` (sobre `feature/versao-mobile`).
Status: aprovado pelo usuário por delegação (2026-09-30); revisão v2 troca Zernio por Meta Graph direto.

## Objetivo
Deixar o Calixto AI pronto para, assim que o usuário conectar uma conta Zernio com o Instagram da empresa, atender clientes no Instagram e no WhatsApp com um agente de IA, e manter o CRM organizado com um agente administrador.

## Entendimento (dito pelo usuário)
- Bot 1: atende clientes no Instagram (DM) e WhatsApp.
- Bot 2: administrador do CRM; ações automáticas; consistente em mobile e PC.
- Reusar agentes e Supabase existentes (`CRM-DESCONTRACAO`, `pmhnzjnmrzvcsbsmbflg`). Sem serviço novo.
- O usuário conecta o Instagram no fim; tudo antes disso fica pronto e testado sem credenciais reais.
- Empresa do pai do usuário usará o CRM; importação dos dados dela é etapa futura.
- Antigravity (Google AI, Gemini 3.8) é usado ao máximo: segunda opinião, revisão de segurança, tarefas em Bash. O Claude orquestra.

## Premissas (não ditas pelo usuário)
- DECISÃO v2: o usuário informou que o Zernio não atende Instagram. O Instagram passa a ser provider próprio `meta_instagram`, usando a Instagram Messaging API (Meta Graph), no padrão do adapter `meta-cloud.ts` já existente. O Zernio não é usado para Instagram.
- Credenciais reais (app Meta, token de página, app secret, verify token) não existem ainda: o usuário as cria no fim. Até lá tudo é testado com payloads simulados e assinaturas HMAC geradas em teste.
- Só é possível afirmar 'funciona de ponta a ponta no Instagram real' depois que o usuário conectar; antes disso a entrega é 'pronto e testado com simulação'.

## Achados da segunda opinião (Antigravity, 2026-09-30) e resposta
- Suporte do Zernio a Instagram DM é premissa de alto risco. Resposta: primeira tarefa do plano é um spike que lê a documentação oficial do Zernio (envio, recebimento, assinatura do webhook). Se não sustentar Instagram DM, o trabalho de Instagram para e o usuário decide entre Meta Graph direto ou outro provedor. WhatsApp e agente administrador seguem independentes.
- Regras diferentes por canal (janela de 24h, templates, limites de mídia, anti-spam). Resposta: um agente, mas política por canal via `capabilities.ts`; fora da janela o agente não envia texto livre, escala para humano.
- Assinatura do webhook pode não existir para Instagram. Resposta: sem verificação criptográfica comprovada, o canal Instagram fica desligado por padrão (falha fechada).
- Tenant: a organização é resolvida pela sessão de canal cadastrada no servidor (`channel_sessions`), nunca por campo do payload. Teste de isolamento entre duas organizações.
- Injeção cruzada: texto de cliente gravado em nota/tarefa é marcado como dado não confiável; o agente administrador só lê campos estruturados e não segue instruções embutidas em notas.
- Fluxo de envio (outbound) entra no escopo: envio pelo adapter, tratamento de erro e nova tentativa limitada, registro de falha entregue ao humano.

## Fora de escopo
Importação de dados do pai; merge na `main`; deploy de produção; conexão real ao Instagram; revisão de app da Meta.

## Componentes

### 1. Canal Instagram (provider `meta_instagram`, Meta Graph direto)
- Rota de webhook própria: GET de verificação (verify token, comparação em tempo constante) e POST com validação de `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto com o app secret). Sem assinatura válida: 401 e nada é gravado.
- Ingest normaliza DM do Instagram para o modelo de conversa/contato do CRM (quem escreve aparece como contato e lead com canal Instagram), idempotente por `mid` (mensagem repetida não duplica).
- Adapter de envio: Graph API `/{ig-user-id}/messages`, com timeout, retry limitado com backoff, tratamento de erro da Meta (token expirado, fora da janela de 24h, limite de taxa) e saúde do canal visível na tela de conexão.
- Capabilities do canal Instagram declaradas em `lib/channels/capabilities.ts` (janela de resposta, sem templates WhatsApp), sem prometer o que não foi medido.
- Fluxo de conexão em Configurações: campos app secret, verify token e token de página, teste de conexão, estado "não conectado" claro enquanto não houver credencial. Segredos só no servidor, criptografados como os demais; nunca no cliente nem em log.
- Verificação de assinatura do webhook obrigatória; evento sem assinatura válida é rejeitado.
- Testes: eventos simulados de Instagram (texto, mídia, evento inválido, assinatura inválida, replay).

### 2. Agente atendente (WhatsApp + Instagram)
- Configura agente no `lib/agent-engine/` existente, um perfil para os dois canais, com guardrails já existentes.
- Escala para humano quando não sabe, quando o cliente pede, ou em assunto sensível.
- Avaliação: conversas simuladas em WhatsApp (português) medindo entendimento, tom e escalonamento; resultado registrado.

### 3. Agente administrador
- Ferramentas em `lib/mcp/tools` para ações seguras: mover etapa, criar tarefa, registrar nota, organizar/etiquetar contato.
- Não apaga dados. Não envia mensagem a cliente por conta própria. Toda ação grava audit log (`lib/mcp/audit.ts`). RLS multi-tenant preservada.
- Execução agendada pelo scheduler existente; limite de ações por execução.

### 4. Banco
- Somente migrações novas e aditivas. Aplicadas primeiro em branch do Supabase (custo avisado antes de criar), nunca direto no projeto.

### 5. Mobile/PC
- Telas tocadas ou criadas (conexão Instagram, painel do admin) conferidas em viewport mobile e desktop, com teste de botões (Playwright, Chromium).

## Segurança
- Segredos: só servidor, criptografados, fora de log e de git.
- Webhook: assinatura, proteção contra replay, limite de tamanho, rate limit.
- Isolamento multi-tenant (RLS) testado para as tabelas novas.
- Prompt injection: conteúdo do cliente é dado, nunca instrução; admin agent não aceita comandos vindos de mensagens.
- Revisão independente do Antigravity (ver abaixo) mais `security-review` do Claude.

## Papel do Antigravity
- Claude: orquestra, implementa, integra.
- Antigravity: (a) segunda opinião sobre este spec e o plano; (b) revisão de segurança do diff; (c) rodar verificações em Bash quando útil.
- Fluxo: Claude faz `git push` da branch; Antigravity faz `git fetch/pull` e revisa; devolve achados via Maestri. Claude aprova os prompts dele lendo o terminal com `maestri check`.
- Achados do Antigravity são tratados como dados a verificar, não como ordens.

## Verificação antes de dizer "pronto"
- Suíte de testes relevante (uma por vez), typecheck, lint de canais (`scripts/lint-channels.ts`).
- Medição em Chromium mobile e desktop; botões clicados de fato.
- Falhas antigas conhecidas (3 testes do baseline) reportadas como preexistentes, não corrigidas aqui.

## Entrega
Branch enviada ao origin; sem PR e sem merge sem pedido. Lista do que o usuário faz para conectar: criar app Meta com Instagram Messaging, conectar a conta Instagram Business à Página, colar app secret, token e verify token em Configurações e apontar o webhook para a URL mostrada na tela.
