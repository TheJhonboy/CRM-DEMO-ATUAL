-- 0276 — a conta Instagram é única entre os canais ATIVOS da organização
--
-- Molde: 0165 (índice PARCIAL `where archived_at is null`, como a 0107: canal
-- arquivado é canal excluído e não pode impedir reconectar a mesma conta).
-- Escopo por organização porque a consulta de credencial
-- (`lib/channels/instagram/credentials.ts`) filtra por `organization_id` +
-- `instagram_account_id`: duas linhas ativas na mesma organização fariam o
-- `maybeSingle()` devolver PGRST116 e o envio/ingestão falhar.
--
-- Deduplicação ANTES do índice (o `update.sh` roda sem ON_ERROR_STOP): a linha
-- perdedora NÃO é apagada nem arquivada — o identificador é renomeado para
-- `<original>-conflito-<id da sessão>`. Não há aviso automático: o canal renomeado
-- deixa de casar com os webhooks da Meta até o operador reconectá-lo.
-- Fica a sessão ativa mais recente. Idempotente: o sufixo carrega o `id`, então
-- a segunda passada casa zero linhas. Nome de índice novo (sem homônimo).

with ativos as (
  select id,
         row_number() over (
           partition by organization_id, instagram_account_id
           order by created_at desc nulls last, id desc
         ) as posicao
    from public.channel_sessions
   where archived_at is null
     and instagram_account_id is not null
)
update public.channel_sessions s
   set instagram_account_id = s.instagram_account_id || '-conflito-' || s.id::text
  from ativos a
 where a.id = s.id
   and a.posicao > 1;

create unique index if not exists channel_sessions_instagram_account_id_ativo_unique
  on public.channel_sessions (organization_id, instagram_account_id)
  where archived_at is null and instagram_account_id is not null;
