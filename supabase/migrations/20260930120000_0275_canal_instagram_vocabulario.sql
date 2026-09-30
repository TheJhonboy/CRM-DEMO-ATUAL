-- 0275 — vocabulário do canal Instagram (DM via Meta Graph, direto).
-- Vocabulário antes do transporte: tipo TS, matriz e colunas nascem juntos.
-- Aditiva e idempotente; nenhuma linha existente viola as colunas novas.

alter table public.channel_sessions
  add column if not exists instagram_account_id text,
  add column if not exists instagram_token_encrypted bytea;

-- RECRIA os CHECKs com TODOS os providers vigentes (waha, meta_cloud, zernio,
-- wacalls — este último da 0233 — mais instagram).
alter table public.channel_sessions drop constraint if exists channel_sessions_provider_check;
alter table public.channel_sessions add constraint channel_sessions_provider_check
  check (provider = any (array['waha'::text,'meta_cloud'::text,'zernio'::text,'wacalls'::text,'instagram'::text]));

alter table public.channel_sessions drop constraint if exists channel_sessions_provider_ref_check;
alter table public.channel_sessions add constraint channel_sessions_provider_ref_check check (
  (provider = 'waha'       and waha_session_name    is not null) or
  (provider = 'meta_cloud' and meta_phone_number_id is not null) or
  (provider = 'zernio'     and zernio_account_id    is not null) or
  (provider = 'wacalls'    and wacalls_session_id   is not null) or
  (provider = 'instagram'  and instagram_account_id is not null)
);

-- Identidade do contato no Instagram: IGSID (id com escopo do app). NÃO mexe na
-- coluna gerada wa_identity (WhatsApp) para não reescrever índice dependente.
alter table public.contacts
  add column if not exists instagram_scoped_id text
  generated always as (nullif(source_metadata->>'instagram_igsid', '')) stored;

create unique index if not exists uniq_contacts_org_instagram_scoped_id
  on public.contacts (organization_id, instagram_scoped_id)
  where instagram_scoped_id is not null and is_merged_into is null;

comment on column public.channel_sessions.instagram_account_id is
  'ID da conta Instagram Business (IG User ID) deste canal. Endereça envio e identifica o dono do webhook. Espelhado em lib/channels/session-ref.ts.';
comment on column public.channel_sessions.instagram_token_encrypted is
  'Token de acesso da Página/Instagram, cifrado por fn_encrypt_oauth. Por SESSÃO.';
