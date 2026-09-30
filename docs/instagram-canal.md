# Canal Instagram (mensagens diretas)

Guia curto para quem opera o CRM. O canal recebe e responde as mensagens diretas (DM) da conta
profissional do Instagram da empresa, pela API "Instagram API with Instagram Login" da Meta.
A equipe e o agente de IA atendem pelo mesmo inbox do WhatsApp.

## Pré-requisitos

- Conta do Instagram **profissional** (Empresa ou Criador), com o acesso às mensagens liberado
  nas configurações do Instagram. **Não precisa** de Página do Facebook.
- Um app no painel de desenvolvedores da Meta (developers.facebook.com), tipo Empresa, com o
  produto **Instagram API with Instagram Login** (não é o Facebook Login).
- Permissões (scopes) do token: `instagram_business_basic` e `instagram_business_manage_messages`.
- Com o app em modo de desenvolvimento, a conta do Instagram precisa estar adicionada como
  **testadora** do app. Para atender clientes reais, o app precisa passar pela revisão da Meta.
- Quem conecta precisa ser `admin` da organização.

## Conectar (6 passos)

Tela: Configurações › Conexões › Instagram.

1. **Crie o app** na Meta e adicione o produto Instagram API with Instagram Login.
2. **Prepare a conta**: profissional, mensagens liberadas, adicionada como testadora (modo de desenvolvimento).
3. **Gere o token** do Instagram no painel do app, com os dois scopes acima.
4. **Junte os três dados**: ID da conta do Instagram, o token gerado e o **App Secret do mesmo app**
   (Configurações do app › Básico). O App Secret é o que assina os webhooks.
5. **Cole na tela e conecte.** O CRM consulta a Meta (`/me`), só aceita se o ID digitado for o da
   conta do token, grava token e segredo cifrados e tenta assinar os campos `messages` e
   `messaging_seen` sozinho.
6. **Ligue a volta**: cole a **URL de retorno** e o **verify token** mostrados na tela no webhook do
   app (produto Instagram). Se a tela disser que a assinatura automática não foi confirmada
   (`webhookSubscribed: false`), assine o campo `messages` no painel do app. Sem isso o CRM envia,
   mas não recebe.

## Como testar

1. Conecte como acima; o estado deve ficar **Conectado** (botão "Testar conexão" confirma).
2. De outra conta do Instagram (testadora do app, se estiver em desenvolvimento), mande uma DM
   para a conta conectada. A conversa aparece no inbox.
3. Responda pelo inbox, ou deixe o agente responder.
4. **Modo de teste do CRM:** com o modo de teste (pré go-live) ativo, a IA **não responde** no
   Instagram, porque o contato do Instagram não tem telefone liberado na lista de teste. Ative o
   go-live do canal para testar a resposta da IA.

## Limites conhecidos

- **Janela de 24 h:** só é possível responder até 24 h depois da última mensagem do cliente. Não há
  template para reabrir a janela neste canal, e a tag `HUMAN_AGENT` (resposta humana até 7 dias)
  **não é modelada** hoje.
- **Texto em partes:** a Meta limita cada mensagem de texto a **1000 bytes** (UTF-8; acento custa 2,
  emoji 4). Respostas maiores são divididas em partes enviadas em sequência (preferindo parágrafo,
  depois frase, depois espaço). Os ecos das partes seguintes voltam pelo webhook e são reconhecidos
  como do próprio CRM: não pausam a IA. Se uma parte falha no meio, as seguintes não saem e a
  mensagem fica marcada como falha (não é reenviada inteira, para não duplicar o que já chegou).
- **Mídia:** imagem, áudio, vídeo e arquivo saem por URL; o que o canal não entrega é recusado com
  erro explícito.
- **Um Instagram por organização.**
- **Incerteza sobre o ID da conta:** a documentação da Meta não confirma o nome do campo de ID no
  `/me` do Instagram Login. O CRM pede `user_id,username` e usa `user_id` (ou `id`, se for o que a
  Meta devolver). O ID que vale é o que chega no webhook em `entry.id`.

## Se as mensagens não chegam

1. O estado na tela está **Conectado**? Se estiver "Token inválido", gere um token novo e reconecte.
2. O campo `messages` está assinado no painel do app? (A tela avisa se a assinatura automática falhou.)
3. A URL de retorno e o verify token do app são os mostrados na tela?
4. O App Secret colado é o do **mesmo app** que envia o webhook? Assinatura inválida é recusada.
5. Compare o `entry.id` do evento no arquivo de webhooks do CRM com o ID da conta gravado na conexão.
   Se forem diferentes, o CRM descarta o evento como "conta de outra sessão". Reconecte informando o
   ID que aparece em `entry.id`.
6. Com a conta em modo de desenvolvimento, confirme que quem escreve é testador do app.

## Agente administrador (opt-in)

Rotina que mantém a casa em ordem sozinha, sem nunca falar com clientes. Está **desligada por padrão**
e precisa de dois interruptores:

- variável de ambiente `ADMIN_AGENT_ENABLED=true` (chave geral da instalação); e
- `organizations.settings.administrador_ativo = true` na organização (não há tela ainda; é um ajuste
  manual no banco, só para organizações ativas).

Ferramentas: **criar tarefa** (retomar lead parado), **registrar nota** e **etiquetar contato**
(`sem-responsavel` em conversa sem dono há 24 h ou mais). **Mover etapa do funil foi excluído de
propósito:** mover etapa dispara automações de follow-up e webhooks, e o administrador nunca deve
mandar mensagem ao cliente por conta própria.

## Limites conhecidos e operação

- **Respostas longas saem em partes.** Se a parte k (k > 1) falha, o cliente pode ver uma resposta
  parcial, e um reenvio manual da mensagem inteira repetiria as primeiras partes. Confira no inbox
  o que já foi entregue antes de reenviar.
- **Automações na mesma conta pausam a IA.** Respostas automáticas e mensagens de boas-vindas do
  próprio Instagram, ou outros apps conectados à conta (ManyChat, Business Suite etc.), geram ecos
  que o CRM trata como resposta humana e **pausam a IA naquela conversa**. Considere desligar essas
  automações. Não há filtro por `app_id` do eco: não está confirmado que o eco o traga, então isso
  não foi implementado.
- **Webhooks são arquivados antes da verificação da assinatura** (corpo de até 1 MiB). Mantenha o
  token da URL do webhook em segredo. Não existe hoje rotação desse token pela tela nem por API: ao
  reconectar, o mesmo token é preservado. Se ele vazar, é preciso trocar `webhook_path_token` da
  sessão diretamente no banco e atualizar a URL no painel da Meta.
- **Migration 0275:** adiciona uma coluna gerada (armazenada) em `contacts`, o que reescreve a
  tabela sob lock `ACCESS EXCLUSIVE`. Em bases grandes, aplique em horário de baixo movimento.
- **Colunas cifradas legíveis por membros da organização (RLS):** o token e o segredo ficam cifrados
  e só o service role decifra, mas o texto cifrado em si é legível por membros via RLS. É uma lacuna
  conhecida de defesa em profundidade.
- **Follow-ups segmentados pela tag `sem-responsavel`:** o administrador etiqueta contatos com essa
  tag; um follow-up automático segmentado por ela passaria a enviar mensagens indiretamente. Evite
  esse tipo de segmento.
- **Reenvios e excesso:** payloads assinados reenviados são deduplicados pelo id da mensagem; eventos
  além de 100 por requisição são descartados.
- **Override de host da Graph (`INSTAGRAM_GRAPH_BASE_URL`):** só para teste de integração. Em
  produção um valor que não comece com `https://` é ignorado.
