---
impacto: capacidade_nova
secao: adicionado
titulo: Novo canal Instagram (mensagens diretas) e agente administrador opcional
---

O CRM passa a receber e responder as mensagens diretas da conta profissional do Instagram da
empresa, pela API "Instagram API with Instagram Login" da Meta, no mesmo inbox do WhatsApp. A
conexão é feita em Configurações › Conexões › Instagram, com o passo a passo na própria tela; o
guia completo está em `docs/instagram-canal.md`. Respostas acima de 1000 bytes saem em partes, a
janela de 24 horas vale como no canal oficial e, com o modo de teste do CRM ativo, a IA não
responde no Instagram até o go-live.

Também chega o agente administrador: uma rotina que cria tarefa de retomada para lead parado,
registra nota e etiqueta contato de conversa sem responsável. Ele **vem desligado**: só roda com
`ADMIN_AGENT_ENABLED=true` e com `organizations.settings.administrador_ativo = true` na
organização. Nunca envia mensagem a cliente e não move lead de etapa.

As migrations 0275 e 0276 são aplicadas pelo fluxo normal de atualização, antes de a aplicação
reiniciar; não há passo manual. A 0275 acrescenta uma coluna gerada em `contacts`, o que
reescreve a tabela: em bases grandes a atualização pode demorar mais que de costume.
