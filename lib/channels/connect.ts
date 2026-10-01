/**
 * Conexão de um canal por CREDENCIAL — do lado de dentro do seam.
 *
 * A tela e a rota não podem saber qual provider é (invariante 1 da doutrina),
 * mas precisam de três coisas concretas: como se chama o canal para o usuário,
 * quais campos pedir, e se a credencial que ele colou presta. As três moram
 * aqui, onde nomear o provider é permitido.
 *
 * ─── Validar ANTES de gravar ────────────────────────────────────────────────
 *
 * Mesma decisão da conexão oficial, pelo mesmo motivo: gravar primeiro e
 * descobrir depois é o que faz o operador achar que conectou e só entender que
 * não na primeira mensagem que não sai — com o lead do outro lado esperando.
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

import { instagramAdapter } from "./adapters/instagram";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "./archived";
import { CHANNEL_PROVIDER_INSTAGRAM, CHANNEL_PROVIDER_ZERNIO } from "./capabilities";
import { instagramBaseUrl } from "./instagram/credentials";
import { colunaDeValidadeAusente, COLUNA_VALIDADE, renovarToken, trocarPorTokenLongo } from "./instagram/token";
import { zernioBaseUrl } from "./zernio/credentials";
import type { ChannelProvider } from "./types";

/**
 * O canal conectável por credencial nesta instalação.
 *
 * Exportado como valor para que rota e tela não escrevam a string — é o que o
 * `lint:channels` cobra, e o que faz um canal seguinte trocar uma linha aqui
 * em vez de dez espalhadas.
 */
export const PARTNER_CHANNEL_PROVIDER: ChannelProvider = CHANNEL_PROVIDER_ZERNIO;

/**
 * Como o canal se chama PARA O USUÁRIO.
 *
 * O nome comercial mora aqui e não na tela por causa do lint — mas a razão é
 * anterior a ele: quem instala reconhece a marca do serviço que contratou, e a
 * tela que diz "provedor parceiro" obriga a adivinhar. O rótulo é dado, não
 * decisão de quem desenha a tela.
 */
export const PARTNER_CHANNEL_LABEL = "Zernio";

export interface PartnerCredentialsInput {
  accountId: string;
  apiKey: string;
}

export type PartnerValidation =
  | {
      ok: true;
      /** Número conectado, para a tela confirmar que é o esperado. */
      phoneNumber: string | null;
      displayName: string | null;
      /** Qualidade do número segundo a plataforma (GREEN/YELLOW/RED). */
      qualityRating: string | null;
    }
  | { ok: false; reason: string };

/**
 * A credencial presta, e a conta é mesmo de WhatsApp?
 *
 * Confere as DUAS coisas de propósito. Uma chave válida apontando para uma
 * conta de outra rede autentica bem e falha em todo envio — e o operador veria
 * "conectado" numa tela de WhatsApp que nunca manda nada.
 */
export async function validatePartnerCredentials(
  input: PartnerCredentialsInput,
): Promise<PartnerValidation> {
  const accountId = input.accountId.trim();
  const apiKey = input.apiKey.trim();
  if (!accountId || !apiKey) return { ok: false, reason: "Informe a conta e a chave." };

  let res: Response;
  try {
    // LISTA e não `GET /accounts/{id}`: medido contra a API, o endpoint por id
    // aceita só `PUT` e responde 405 ao GET — e um 405 tratado como "credencial
    // inválida" mandaria o operador trocar uma chave que estava certa. Pior: a
    // primeira versão deste teste "passava" nos casos de recusa porque TODOS
    // recebiam 405, verde afirmando uma validação que não acontecia.
    res = await fetch(`${zernioBaseUrl()}/v1/accounts`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    // Rede caída não é credencial errada, e dizer "chave inválida" mandaria o
    // operador trocar uma chave que estava certa.
    return { ok: false, reason: "Não foi possível falar com o provedor. Tente de novo." };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "Chave recusada pelo provedor." };
  }
  if (!res.ok) {
    return { ok: false, reason: `Provedor respondeu ${res.status}.` };
  }

  const json = (await res.json().catch(() => null)) as {
    accounts?: Record<string, unknown>[];
  } | null;
  const contas = Array.isArray(json?.accounts) ? json.accounts : [];
  const conta = contas.find((c) => String(c._id ?? c.id) === accountId) ?? null;

  if (!conta) {
    // A chave presta, mas não alcança esta conta. É diferente de chave inválida,
    // e a mensagem precisa dizer QUAL das duas para o operador saber o que
    // corrigir.
    return { ok: false, reason: "Conta não encontrada para esta chave." };
  }

  if (conta.platform !== "whatsapp") {
    return {
      ok: false,
      reason: `Esta conta é de ${String(conta.platform ?? "outra rede")}, não de WhatsApp.`,
    };
  }

  const meta = (conta.metadata ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    phoneNumber: typeof meta.displayPhoneNumber === "string" ? meta.displayPhoneNumber : null,
    displayName: typeof conta.displayName === "string" ? conta.displayName : null,
    qualityRating: typeof meta.qualityRating === "string" ? meta.qualityRating : null,
  };
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

/**
 * As colunas da sessão carregam o nome do provider — e é assim que a migration
 * 0117/0118 as criou, porque o CHECK precisa saber qual exigir. Escrevê-las da
 * rota faria a rota nomear o canal, que é o que o `lint:channels` reprovou na
 * primeira versão dela.
 *
 * Então a leitura e a escrita moram aqui, e a rota fala em conceitos: "a conta",
 * "a chave", "o token do webhook".
 */
export interface PartnerSession {
  id: string;
  accountId: string | null;
  phoneNumber: string | null;
  displayName: string | null;
  status: string | null;
  webhookPathToken: string | null;
  hasApiKey: boolean;
  archivedAt: string | null;
}

const COLUNAS =
  "id, zernio_account_id, phone_number, display_name, status, webhook_path_token, zernio_token_encrypted";

function toPartnerSession(row: Record<string, unknown> | null): PartnerSession | null {
  if (!row) return null;
  return {
    id: row.id as string,
    accountId: (row.zernio_account_id as string) ?? null,
    phoneNumber: (row.phone_number as string) ?? null,
    displayName: (row.display_name as string) ?? null,
    status: (row.status as string) ?? null,
    webhookPathToken: (row.webhook_path_token as string) ?? null,
    hasApiKey: !!row.zernio_token_encrypted,
    archivedAt: (row.archived_at as string) ?? null,
  };
}

export async function findPartnerSession(
  admin: SupabaseClient,
  organizationId: string,
): Promise<PartnerSession | null> {
  const buscar = (colunas: string) =>
    admin
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", organizationId)
      .eq("provider", PARTNER_CHANNEL_PROVIDER)
      .maybeSingle();

  const { data } = await queryTolerantToMissingArchived(
    () => buscar(`${COLUNAS}, ${ARCHIVED_AT}`),
    () => buscar(COLUNAS),
  );
  return toPartnerSession(data as Record<string, unknown> | null);
}

/**
 * Grava (ou ressuscita) a sessão.
 *
 * `archived_at: null` sempre: reconectar por cima de um canal excluído precisa
 * trazê-lo de volta. Sem isso o update deixaria a coluna no lugar e o canal
 * "conectado" ficaria invisível para o webhook, o envio e os seletores — todos
 * filtrados por ela.
 */
export async function savePartnerSession(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    existingId: string | null;
    accountId: string;
    apiKeyEncrypted: string;
    webhookPathToken: string;
    webhookSecretEncrypted: string;
    phoneNumber: string | null;
    displayName: string;
  },
): Promise<{ error: string | null }> {
  const linha = {
    organization_id: input.organizationId,
    provider: PARTNER_CHANNEL_PROVIDER,
    zernio_account_id: input.accountId,
    zernio_token_encrypted: input.apiKeyEncrypted,
    webhook_path_token: input.webhookPathToken,
    webhook_secret_encrypted: input.webhookSecretEncrypted,
    phone_number: input.phoneNumber,
    display_name: input.displayName,
    status: "WORKING",
    archived_at: null,
  };

  const { error } = input.existingId
    ? await admin.from("channel_sessions").update(linha).eq("id", input.existingId)
    : await admin
        .from("channel_sessions")
        .insert({ ...linha, metadata: metadataInicialDoCanal() });

  return { error: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Instagram (DM pela Meta Graph, direto) — conexão por credencial própria
// ---------------------------------------------------------------------------

/**
 * O canal de Instagram como valor, para rota e tela não escreverem a string.
 *
 * Diferente do parceiro, aqui a credencial é POR ORGANIZAÇÃO e sem reserva de
 * `.env`: o operador cola o token da SUA conta profissional e o segredo do SEU
 * app Meta. Nada é global — um token global enviaria pela conta errada.
 */
export const INSTAGRAM_CHANNEL_PROVIDER: ChannelProvider = CHANNEL_PROVIDER_INSTAGRAM;

export interface InstagramConnectInput {
  organizationId: string;
  /** O que o operador digitou. Só é aceito se a Graph confirmar o MESMO id. */
  accountId: string;
  accessToken: string;
  /** Segredo do app Meta: é com ele que a assinatura do webhook é conferida. */
  appSecret: string;
  displayName?: string;
}

export type InstagramConnectResult =
  | {
      ok: true;
      /** Token do path do webhook — também é o verify token do handshake GET. */
      webhookPathToken: string;
      username: string | null;
      status: string;
      /**
       * A assinatura dos campos do webhook na Meta (`messages`, `messaging_seen`) foi aceita?
       * Best-effort: `false` NÃO impede a conexão — a tela manda o operador assinar no painel.
       */
      webhookSubscribed: boolean;
      /** ISO de quando o token vence; `null` = desconhecido (token longo colado com menos de 24 h). */
      tokenValidoAte: string | null;
      /** `true` = token de longa duração; `false` = provavelmente curto (~1 h); `null` = não deu para saber. */
      tokenLongo: boolean | null;
    }
  | {
      ok: false;
      /** `rejeitada` = a Meta disse não (422); `indisponivel` = não deu para perguntar (502);
       * `cifra` = sem chave de cifra (422); `banco` = falha ao gravar (500). */
      kind: "rejeitada" | "indisponivel" | "cifra" | "banco";
      /** Mensagem pronta para o operador. NUNCA carrega token, segredo nem texto da Meta. */
      reason: string;
      /** Status HTTP da Meta quando ela respondeu 5xx (a razão é texto FIXO e traduzível). */
      metaStatus?: number;
    };

const GRAPH_TIMEOUT_MS = 8_000;
/** Teto da assinatura do webhook: best-effort, não pode segurar a conexão. */
const SUBSCRIBE_TIMEOUT_MS = 5_000;
/** Campos que o canal precisa receber (Instagram API com Instagram Login). */
const CAMPOS_DO_WEBHOOK = "messages,messaging_seen";

/**
 * A credencial presta e a conta é a que o operador disse?
 *
 * Guarda o id que a GRAPH devolve, e só aceita se for igual ao digitado: o que
 * chega no webhook em `entry.id` é esse id, e a ingestão descarta (em silêncio)
 * evento de conta diferente da gravada. Gravar o digitado sem conferir criaria
 * um canal "conectado" que nunca recebe.
 */
export async function validateInstagramAccount(input: {
  accountId: string;
  accessToken: string;
}): Promise<
  | { ok: true; accountId: string; username: string | null }
  | { ok: false; kind: "rejeitada" | "indisponivel"; reason: string; metaStatus?: number }
> {
  let res: Response;
  try {
    // O token vai no cabeçalho, nunca na URL (URL vai para log de proxy).
    res = await fetch(`${instagramBaseUrl()}/me?fields=user_id,username`, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    });
  } catch {
    return {
      ok: false,
      kind: "indisponivel",
      reason: "Não foi possível falar com a Meta agora. Tente de novo em instantes.",
    };
  }

  // Lido como TEXTO: o id da conta tem 17+ dígitos e, como número JSON, `JSON.parse` perderia
  // precisão (e a comparação com o digitado falharia, ou pior, bateria com outra conta).
  const texto = await res.text().catch(() => "");
  let json: {
    username?: unknown;
    error?: { code?: unknown };
  } | null = null;
  try {
    json = JSON.parse(texto);
  } catch {
    json = null;
  }

  if (res.status >= 500) {
    return {
      ok: false,
      kind: "indisponivel",
      reason: "A Meta está com instabilidade agora. Tente de novo em instantes.",
      metaStatus: res.status,
    };
  }
  if (!res.ok || json?.error) {
    const code = json?.error?.code;
    return {
      ok: false,
      kind: "rejeitada",
      reason:
        code === 190 || res.status === 401
          ? "Token recusado ou expirado pela Meta. Gere um novo e cole de novo."
          : "A Meta recusou o token. Confira se ele tem permissão de mensagens do Instagram.",
    };
  }

  // Com Instagram Login o id da conta profissional é `user_id`; `id` é o reserva (os
  // nomes do /me nesse caminho não estão confirmados na documentação da Meta).
  const idDaMeta = idDoTexto(texto, "user_id") ?? idDoTexto(texto, "id") ?? "";
  if (!idDaMeta) {
    return { ok: false, kind: "rejeitada", reason: "A Meta não devolveu a conta deste token." };
  }
  if (idDaMeta !== input.accountId) {
    return {
      ok: false,
      kind: "rejeitada",
      reason:
        "O ID informado não é o da conta deste token. Use o ID que a Meta associa ao token (o mesmo que chega nos webhooks).",
    };
  }
  return {
    ok: true,
    accountId: idDaMeta,
    username: typeof json?.username === "string" ? json.username : null,
  };
}

/**
 * Assina, na Meta, os campos que o canal recebe. Best-effort: nunca lança e nunca
 * devolve o token; `false` = não deu (o operador assina no painel do app).
 * Token no cabeçalho (nunca na URL). `subscribed_apps` com Instagram Login age sobre
 * `/me` — a própria conta profissional do token.
 */
export async function subscribeInstagramWebhooks(accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${instagramBaseUrl()}/me/subscribed_apps?subscribed_fields=${CAMPOS_DO_WEBHOOK}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: "error",
        signal: AbortSignal.timeout(SUBSCRIBE_TIMEOUT_MS),
      },
    );
    if (!res.ok) return false;
    const json = (await res.json().catch(() => null)) as { success?: unknown; error?: unknown } | null;
    return !json?.error && json?.success !== false;
  } catch {
    return false;
  }
}

/** Id numérico (string ou número JSON) do campo `campo` no texto cru da resposta, sem passar por Number. */
function idDoTexto(texto: string, campo: "user_id" | "id"): string | null {
  const re = campo === "user_id" ? /"user_id"\s*:\s*"?(\d{1,40})"?/ : /"id"\s*:\s*"?(\d{1,40})"?/;
  return re.exec(texto)?.[1] ?? null;
}

export interface InstagramSession {
  id: string;
  accountId: string | null;
  displayName: string | null;
  status: string | null;
  webhookPathToken: string | null;
  hasToken: boolean;
  archivedAt: string | null;
  /** ISO; `null` = desconhecida (ou migration 0277 ainda não aplicada). */
  tokenExpiresAt: string | null;
}

const COLUNAS_INSTAGRAM =
  "id, instagram_account_id, display_name, status, webhook_path_token, instagram_token_encrypted";

/** LANÇA quando a consulta falha: o chamador decide (conectar → `banco`; estado → erro). */
export async function findInstagramSession(
  admin: SupabaseClient,
  organizationId: string,
): Promise<InstagramSession | null> {
  const buscar = (colunas: string) =>
    admin
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", organizationId)
      .eq("provider", INSTAGRAM_CHANNEL_PROVIDER)
      .maybeSingle();

  const tentar = (colunas: string) =>
    queryTolerantToMissingArchived(
      () => buscar(`${colunas}, ${ARCHIVED_AT}`),
      () => buscar(colunas),
    );
  let { data, error } = await tentar(`${COLUNAS_INSTAGRAM}, ${COLUNA_VALIDADE}`);
  // Migration 0277 pendente: repete sem a coluna (validade desconhecida), não quebra o canal.
  if (colunaDeValidadeAusente(error)) ({ data, error } = await tentar(COLUNAS_INSTAGRAM));
  // Erro NÃO é "não achei": tratar como ausente faria o conectar inserir uma linha
  // duplicada (o índice parcial único 0276 a barraria com 23505, tarde e com erro cru).
  if (error) {
    throw new Error(`instagram_session_lookup_failed: ${error.code ?? "sem_codigo"}`);
  }
  const row = data as Record<string, unknown> | null;
  if (!row) return null;
  return {
    id: row.id as string,
    accountId: (row.instagram_account_id as string) ?? null,
    displayName: (row.display_name as string) ?? null,
    status: (row.status as string) ?? null,
    webhookPathToken: (row.webhook_path_token as string) ?? null,
    hasToken: !!row.instagram_token_encrypted,
    archivedAt: (row.archived_at as string) ?? null,
    tokenExpiresAt: (row[COLUNA_VALIDADE] as string) ?? null,
  };
}

const emIso = (segundos: number) => new Date(Date.now() + segundos * 1000).toISOString();

/**
 * Troca por token longo (60 dias); se a Meta recusa (o colado já é longo), tenta renovar
 * para descobrir a validade. Nunca lança; sem sucesso mantém o token colado.
 * `longo=false` só quando as DUAS recusam (provável token curto, ~1 h); falha de rede = `null`.
 */
async function prepararTokenLongo(
  colado: string,
  appSecret: string,
): Promise<{ token: string; validoAte: string | null; longo: boolean | null }> {
  const troca = await trocarPorTokenLongo({ appSecret, tokenCurto: colado });
  if (troca.ok) return { token: troca.accessToken, validoAte: emIso(troca.expiresInSeconds), longo: true };
  const renovado = await renovarToken({ tokenAtual: colado });
  if (renovado.ok) {
    return { token: renovado.accessToken, validoAte: emIso(renovado.expiresInSeconds), longo: true };
  }
  if (renovado.motivo === "token_novo_demais") return { token: colado, validoAte: null, longo: true };
  const recusadas =
    troca.motivo !== "rede" &&
    (renovado.motivo === "recusado" || renovado.motivo === "token_expirado");
  return { token: colado, validoAte: null, longo: recusadas ? false : null };
}

/**
 * Valida na Graph, cifra e grava — nessa ordem, e nada é gravado se um passo falha.
 *
 * Reconectar preserva o `webhook_path_token` (é o verify token já colado na Meta)
 * e ressuscita a linha arquivada, como o parceiro.
 */
export async function connectInstagram(
  admin: SupabaseClient,
  input: InstagramConnectInput,
): Promise<InstagramConnectResult> {
  const v = await validateInstagramAccount({
    accountId: input.accountId,
    accessToken: input.accessToken,
  });
  if (!v.ok) return { ok: false, kind: v.kind, reason: v.reason, metaStatus: v.metaStatus };

  // Token de longa duração: tenta trocar o colado; se já era longo, tenta renovar só para
  // aprender a validade. Best-effort — nada daqui derruba a conexão.
  const longo = await prepararTokenLongo(input.accessToken, input.appSecret);

  const tokenCifrado = await encryptWebhookSecret(admin, longo.token);
  const segredoCifrado = await encryptWebhookSecret(admin, input.appSecret);
  if (!tokenCifrado || !segredoCifrado) {
    // Sem a GUC de cifra, gravar em claro seria pior que recusar.
    return {
      ok: false,
      kind: "cifra",
      reason: "Cifra indisponível nesta instalação — nada foi gravado.",
    };
  }

  let existente: InstagramSession | null;
  try {
    existente = await findInstagramSession(admin, input.organizationId);
  } catch {
    // Sem saber se já há linha, inserir poderia duplicar: não grava nada.
    return { ok: false, kind: "banco", reason: "Não foi possível gravar a conexão. Tente de novo." };
  }
  const webhookPathToken = existente?.webhookPathToken ?? randomBytes(16).toString("hex");
  const status = "WORKING";
  const linha = {
    organization_id: input.organizationId,
    provider: INSTAGRAM_CHANNEL_PROVIDER,
    instagram_account_id: v.accountId,
    instagram_token_encrypted: tokenCifrado,
    instagram_token_expires_at: longo.validoAte,
    webhook_path_token: webhookPathToken,
    webhook_secret_encrypted: segredoCifrado,
    display_name: input.displayName?.trim() || (v.username ? `@${v.username}` : "Instagram"),
    status,
    archived_at: null,
  };

  const gravar = (l: Record<string, unknown>) =>
    existente
      ? admin.from("channel_sessions").update(l).eq("id", existente.id)
      : admin.from("channel_sessions").insert({ ...l, metadata: metadataInicialDoCanal() });
  let { error } = await gravar(linha);
  if (colunaDeValidadeAusente(error)) {
    // Migration 0277 pendente: conecta sem a validade em vez de falhar.
    const { [COLUNA_VALIDADE]: _validade, ...semValidade } = linha;
    void _validade;
    ({ error } = await gravar(semValidade));
  }
  if (error) {
    return { ok: false, kind: "banco", reason: "Não foi possível gravar a conexão. Tente de novo." };
  }
  // Só depois de gravar: uma assinatura sem linha correspondente seria efeito sem conexão.
  const webhookSubscribed = await subscribeInstagramWebhooks(longo.token);
  return {
    ok: true,
    webhookPathToken,
    username: v.username,
    status,
    webhookSubscribed,
    tokenValidoAte: longo.validoAte,
    tokenLongo: longo.longo,
  };
}

export type InstagramEstado = "conectado" | "nao_conectado" | "token_invalido";

export interface InstagramEstadoDaConexao {
  estado: InstagramEstado;
  webhookPathToken: string | null;
  username: string | null;
  /** ISO de quando o token vence; `null` = desconhecido. */
  tokenValidoAte: string | null;
  /** `sem_resposta` = a Meta não respondeu no prazo: o estado vem da existência da conexão, não de um teste. */
  saude: "ok" | "falhou" | "sem_resposta" | "credencial_indisponivel" | null;
}

const SAUDE_TETO_MS = 5_000;

/**
 * Estado da conexão, com UMA ida à Graph (via `checkHealth` do adapter) sob teto de 5 s.
 * Sem sessão → `nao_conectado`, sem chamar a Graph.
 */
export async function estadoDoInstagram(
  admin: SupabaseClient,
  organizationId: string,
): Promise<InstagramEstadoDaConexao> {
  const sessao = await findInstagramSession(admin, organizationId);
  if (!sessao || sessao.archivedAt || !sessao.accountId || !sessao.hasToken) {
    return { estado: "nao_conectado", webhookPathToken: null, username: null, tokenValidoAte: null, saude: null };
  }
  const base = {
    webhookPathToken: sessao.webhookPathToken,
    tokenValidoAte: sessao.tokenExpiresAt,
    username: sessao.displayName?.startsWith("@") ? sessao.displayName.slice(1) : null,
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), SAUDE_TETO_MS);
  });
  try {
    const r = await Promise.race([
      instagramAdapter.checkHealth!({ organizationId, sessionRef: sessao.accountId }),
      prazo,
    ]);
    if (r !== "timeout" && !r.reachable) {
      // Falhas NOSSAS (credencial), não da Meta: não são "Meta não respondeu".
      if (r.detail === "sem_credencial_para_a_sessao") {
        return { estado: "token_invalido", ...base, saude: "falhou" };
      }
      if (r.detail === "credenciais_indisponiveis") {
        return { estado: "conectado", ...base, saude: "credencial_indisponivel" };
      }
    }
    if (r === "timeout" || !r.reachable) {
      return { estado: "conectado", ...base, saude: "sem_resposta" };
    }
    if (r.status === "WORKING") return { estado: "conectado", ...base, saude: "ok" };
    return { estado: "token_invalido", ...base, saude: "falhou" };
  } catch {
    return { estado: "conectado", ...base, saude: "sem_resposta" };
  } finally {
    clearTimeout(timer);
  }
}
