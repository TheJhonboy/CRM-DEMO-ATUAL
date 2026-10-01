-- 0277 — validade do token do Instagram (renovação automática)
--
-- O token de longa duração do Instagram Login vale 60 dias e só pode ser
-- renovado enquanto ainda está vivo (a partir de 24 h de idade). Guardamos
-- quando ele vence para a rotina diária renovar a tempo e para a tela avisar.
-- NULL = validade desconhecida (token colado já longo, cuja idade não dá para
-- saber). Aditiva e idempotente: coluna anulável, sem preenchimento.

alter table public.channel_sessions
  add column if not exists instagram_token_expires_at timestamptz;

comment on column public.channel_sessions.instagram_token_expires_at is
  'Quando o token do Instagram (instagram_token_encrypted) expira. Atualizada na conexão e a cada renovação. NULL = desconhecida.';
