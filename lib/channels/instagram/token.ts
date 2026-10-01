/**
 * Ciclo de vida do token do Instagram (Instagram API with Instagram Login).
 *
 * O token de longa duração vale 60 dias a partir da emissão/renovação; só pode ser
 * renovado depois de 24 h de idade e enquanto ainda está vivo. Token que passa dos
 * 60 dias sem renovar morre e o operador precisa gerar outro na Meta.
 *
 * Estes endpoints NÃO são versionados e a Meta os documenta com o token na QUERY
 * (diferente do resto do canal, que usa cabeçalho). Por isso aqui:
 *  - `redirect: "error"` e timeout de 10 s;
 *  - a URL nunca é logada nem entra em erro/resultado;
 *  - nenhuma exceção ou texto da Meta é repassado: só motivos fixos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../archived";
import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets";

const GRAPH_HOST = "https://graph.instagram.com";
const TIMEOUT_MS = 10_000;

export type MotivoDaFalhaDoToken =
  | "token_novo_demais"
  | "token_expirado"
  | "rede"
  | "resposta_invalida"
  | "recusado";

export type ResultadoDoToken =
  | { ok: true; accessToken: string; expiresInSeconds: number }
  | { ok: false; motivo: MotivoDaFalhaDoToken };

/**
 * Mapeia o erro da Meta. NÃO verificado na documentação (ela não lista os erros de
 * refresh): 190 é o código geral de token inválido/expirado da Graph; "menos de 24 h"
 * é reconhecido pelo texto. Desconhecido vira `recusado`.
 */
function motivoDoErro(erro: { code?: unknown; message?: unknown }): MotivoDaFalhaDoToken {
  const msg = typeof erro.message === "string" ? erro.message : "";
  if (/24\s*hours?|too (new|recent)|not old enough/i.test(msg)) return "token_novo_demais";
  if (erro.code === 190) return "token_expirado";
  return "recusado";
}

async function chamar(caminho: string, params: Record<string, string>): Promise<ResultadoDoToken> {
  const url = `${GRAPH_HOST}/${caminho}?${new URLSearchParams(params).toString()}`;
  let res: Response;
  try {
    res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { ok: false, motivo: "rede" };
  }
  if (res.status >= 500) return { ok: false, motivo: "rede" };

  let json: {
    access_token?: unknown;
    expires_in?: unknown;
    error?: { code?: unknown; message?: unknown };
  } | null;
  try {
    json = JSON.parse(await res.text());
  } catch {
    return { ok: false, motivo: "resposta_invalida" };
  }
  if (!json || typeof json !== "object") return { ok: false, motivo: "resposta_invalida" };

  if (json.error || !res.ok) {
    return { ok: false, motivo: json.error ? motivoDoErro(json.error) : res.status === 401 ? "token_expirado" : "recusado" };
  }
  const { access_token: accessToken, expires_in: expiresIn } = json;
  if (
    typeof accessToken !== "string" ||
    !accessToken ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    return { ok: false, motivo: "resposta_invalida" };
  }
  return { ok: true, accessToken, expiresInSeconds: expiresIn };
}

/** Troca o token curto (1 h) por um de longa duração (60 dias). */
export function trocarPorTokenLongo(input: { appSecret: string; tokenCurto: string }): Promise<ResultadoDoToken> {
  return chamar("access_token", {
    grant_type: "ig_exchange_token",
    client_secret: input.appSecret,
    access_token: input.tokenCurto,
  });
}

/** Renova um token longo (vale mais 60 dias). Exige idade >= 24 h e token vivo. */
export function renovarToken(input: { tokenAtual: string }): Promise<ResultadoDoToken> {
  return chamar("refresh_access_token", {
    grant_type: "ig_refresh_token",
    access_token: input.tokenAtual,
  });
}

export type RenovacaoDaSessao =
  | { ok: true; tokenValidoAte: string }
  | {
      ok: false;
      motivo: MotivoDaFalhaDoToken | "sem_sessao" | "sem_credencial" | "cifra" | "banco";
    };

/**
 * Renova o token de UMA sessão. A sessão é buscada por `organization_id` + `id`
 * (vindos de fonte confiável, nunca do payload). Só grava depois de a Meta aceitar
 * e de a cifra funcionar; devolve apenas a validade, nunca o token.
 */
export async function renovarTokenDaSessao(
  admin: SupabaseClient,
  input: { organizationId: string; sessionId: string },
): Promise<RenovacaoDaSessao> {
  const { organizationId, sessionId } = input;
  const base = () =>
    admin
      .from("channel_sessions")
      .select("id, instagram_token_encrypted")
      .eq("organization_id", organizationId)
      .eq("id", sessionId)
      .eq("provider", "instagram");
  const { data, error } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );
  if (error) return { ok: false, motivo: "banco" };
  const cifrado = (data as { instagram_token_encrypted?: string | null } | null)?.instagram_token_encrypted;
  if (!data) return { ok: false, motivo: "sem_sessao" };
  if (!cifrado) return { ok: false, motivo: "sem_credencial" };

  const atual = (await decryptWebhookSecret(admin, cifrado))?.trim();
  if (!atual) return { ok: false, motivo: "sem_credencial" };

  const r = await renovarToken({ tokenAtual: atual });
  if (!r.ok) return { ok: false, motivo: r.motivo };

  const novoCifrado = await encryptWebhookSecret(admin, r.accessToken);
  if (!novoCifrado) return { ok: false, motivo: "cifra" };

  const validoAte = new Date(Date.now() + r.expiresInSeconds * 1000).toISOString();
  const { error: erroUpdate } = await admin
    .from("channel_sessions")
    .update({ instagram_token_encrypted: novoCifrado, instagram_token_expires_at: validoAte })
    .eq("organization_id", organizationId)
    .eq("id", sessionId);
  if (erroUpdate) return { ok: false, motivo: "banco" };
  return { ok: true, tokenValidoAte: validoAte };
}
