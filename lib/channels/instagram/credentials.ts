/**
 * Credenciais do Instagram — **sempre por sessão, sem fallback de `.env`**.
 *
 * Diferença deliberada em relação a `../zernio/credentials.ts`: lá um env global
 * serve de reserva. Aqui não existe reserva. Cada organização conecta a SUA conta
 * profissional, e um token global enviaria a mensagem pela conta errada. Sem
 * credencial própria, o chamador trata como canal não conectado.
 *
 * Cifra: as mesmas RPCs do resto do repo (`decryptWebhookSecret`).
 *
 * A busca leva `organization_id` junto e recorta `archived_at is null` (issue
 * #236): o client é de service role, que bypassa RLS, e o identificador do
 * provider não é único entre organizações. O `error` NUNCA é descartado — mas,
 * como no molde, a consulta que falha LANÇA (falha transitória do banco se
 * distingue de "não conectado", e o envio pode tentar de novo). A mensagem não
 * carrega segredo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../archived";
import { graphVersion } from "@/lib/graph-version";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export interface InstagramCredentials {
  accountId: string;
  accessToken: string;
  baseUrl: string;
}

export interface InstagramCredsLookup {
  /** Resolvido de fonte confiável (sessão, linha já escopada, token do webhook). */
  organizationId: string;
  /** `channel_sessions.instagram_account_id` — o `sessionRef` deste canal. */
  accountId: string;
}

/**
 * Base da API do Instagram com Instagram Login (host graph.instagram.com). A versão vem do lugar
 * único (`lib/graph-version.ts`). `INSTAGRAM_GRAPH_BASE_URL` existe só para teste
 * de integração; `||` + `trim()` para que vazio (estado do `.env.example`) caia no
 * padrão em vez de gerar URL sem host.
 */
export function instagramBaseUrl(): string {
  return (
    process.env.INSTAGRAM_GRAPH_BASE_URL?.trim() || `https://graph.instagram.com/${graphVersion()}`
  );
}

/** `null` = sem credencial utilizável (linha ausente/arquivada, decifra falhou, token vazio).
 * LANÇA quando a consulta falha. */
export async function resolveInstagramCredentials(
  admin: SupabaseClient,
  lookup: InstagramCredsLookup,
): Promise<InstagramCredentials | null> {
  const { organizationId, accountId } = lookup;
  if (!organizationId || !accountId) return null;

  const base = () =>
    admin
      .from("channel_sessions")
      .select("instagram_account_id, instagram_token_encrypted")
      .eq("organization_id", organizationId)
      .eq("instagram_account_id", accountId);
  const { data, error } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );
  if (error) {
    throw new Error(
      `instagram_creds_lookup_failed: ${error.code ?? "sem_codigo"} ${error.message ?? ""}`.trim(),
    );
  }

  const cifrado = data?.instagram_token_encrypted;
  if (!data || !cifrado) return null;

  const accessToken = (await decryptWebhookSecret(admin, cifrado as unknown as string))?.trim();
  if (!accessToken) return null;

  return {
    accountId: data.instagram_account_id as string,
    accessToken,
    baseUrl: instagramBaseUrl(),
  };
}
