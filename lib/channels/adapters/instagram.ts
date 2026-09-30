/**
 * Adapter do Instagram (mensagens diretas pela Graph API) — a volta da resposta do bot.
 *
 * Burro de propósito, como os irmãos: traduz formato e nada mais. A janela de 24h
 * (e a exceção humana de 7 dias) é da cadeia `before_send`, não daqui.
 *
 * ─── O que este adapter não é ────────────────────────────────────────────────
 *
 * - Endereço: `envelope.providerConversationId` (o IGSID). `resolveRecipient` devolve
 *   a MESMA thread (vinda de `RecipientInput.providerConversationId`) e ignora o
 *   contato — não há telefone neste canal. Sem thread, `null`: não há endereço, e o
 *   handler falha a mensagem antes de tocar a rede. Devolver `null` sempre (a versão
 *   anterior) fazia o handler gravar `missing_phone_number` em TODA resposta.
 * - Credencial: SEMPRE por sessão (`resolveInstagramCredentials`), sem `.env`.
 * - O token nunca entra em erro, log ou detalhe de saúde. Mensagens de erro são
 *   montadas só com códigos nossos e o `code` numérico da Meta — nunca o texto da
 *   Meta (que o adapter não controla) e nunca cabeçalho/URL com credencial.
 *
 * `isConfigured()` é `true` pelo mesmo motivo do canal oficial: a resposta depende do
 * banco e o método é síncrono. Quem desiste é `send()`, que lança
 * `instagram_not_configured` (credencial ausente → o handler grava `queued`).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveInstagramCredentials } from "../instagram/credentials";
import type { InstagramCredentials } from "../instagram/credentials";
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelTenantScope,
  OutboundEnvelope,
} from "../types";

const CODES = {
  notConfigured: "instagram_not_configured",
  sendFailed: "instagram_send_failed",
  unknownError: "instagram_unknown_error",
} as const;

const TIMEOUT_MS = 10_000;
const BACKOFF_MS = 400;

/** Falha que vale tentar de novo (`retryable`). Não carrega segredo. */
export class InstagramSendError extends Error {
  constructor(
    detail: string,
    readonly retryable: boolean,
  ) {
    super(`${CODES.sendFailed}: ${detail}`);
    this.name = "InstagramSendError";
  }
}

/** Código de erro da Meta → detalhe nosso. Só os que mudam a ação do operador. */
function detalheDoCodigo(code: number | undefined): string | null {
  if (code === 190) return "token_expirado";
  if (code === 10 || code === 551) return "fora_da_janela";
  if (code === 4 || code === 17 || code === 32 || code === 613) return "limite_de_taxa";
  return null;
}

type GraphBody = {
  message_id?: string;
  error?: { code?: number };
};

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * POST/GET com 10 s de teto e 1 retry com backoff SÓ para 5xx e erro de rede.
 * 4xx nunca re-tenta. Devolve a resposta final; a rede que falha duas vezes lança.
 */
async function chamar(
  url: string,
  init: RequestInit,
): Promise<{ status: number; ok: boolean; body: GraphBody }> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    if (tentativa > 0) await dormir(BACKOFF_MS);
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status >= 500 && tentativa === 0) continue;
      const body = (await res.json().catch(() => ({}))) as GraphBody;
      return { status: res.status, ok: res.ok, body };
    } catch (e) {
      // Timeout: o pedido pode ter chegado à Meta — re-tentar duplicaria a mensagem.
      const nome = (e as { name?: string } | null)?.name;
      if (nome === "TimeoutError" || nome === "AbortError") {
        throw new InstagramSendError("timeout", false);
      }
      // Erro de conexão: tenta de novo uma vez.
    }
  }
  throw new InstagramSendError("rede_indisponivel", true);
}

/** `kind` do envelope → `message` da Send API. `null` = tipo que o canal não entrega. */
function mensagem(env: OutboundEnvelope): Record<string, unknown> | null {
  if (env.kind === "text") return { text: env.body ?? "" };
  const tipo =
    env.kind === "image" ? "image"
    : env.kind === "video" ? "video"
    : env.kind === "audio" ? "audio"
    : env.kind === "document" ? "file"
    : null;
  if (!tipo || !env.media?.url) return null;
  return { attachment: { type: tipo, payload: { url: env.media.url } } };
}

async function credenciais(
  organizationId: string,
  accountId: string,
): Promise<InstagramCredentials> {
  let creds: InstagramCredentials | null;
  try {
    creds = await resolveInstagramCredentials(createAdminClient(), { organizationId, accountId });
  } catch {
    // Falha transitória do banco: distinta de "não conectado" e RE-TENTÁVEL.
    throw new InstagramSendError("credenciais_indisponiveis", true);
  }
  if (!creds) {
    throw new Error(`${CODES.notConfigured}: sem credencial do Instagram para esta sessão.`);
  }
  return creds;
}

export const instagramAdapter: ChannelAdapter = {
  provider: "instagram",

  resolveRecipient: (input) => input.providerConversationId || null,

  isConfigured: () => true,

  codes: CODES,

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    const thread = envelope.providerConversationId;
    if (!thread) throw new InstagramSendError("sem_thread_do_instagram", false);

    const message = mensagem(envelope);
    if (!message) throw new InstagramSendError("kind_nao_suportado", false);

    const creds = await credenciais(envelope.organizationId, envelope.sessionRef);

    await envelope.beforeSend?.();
    const r = await chamar(`${creds.baseUrl}/${creds.accountId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: thread },
        message,
        messaging_type: "RESPONSE",
      }),
    });

    if (!r.ok || r.body.error) {
      const mapeado = detalheDoCodigo(r.body.error?.code);
      const detalhe = mapeado ?? `http_${r.status}`;
      throw new InstagramSendError(detalhe, r.status >= 500);
    }
    return { externalId: r.body.message_id ?? null };
  },

  async checkHealth(
    input: ChannelTenantScope & { sessionRef: string },
  ): Promise<ChannelHealth> {
    let creds: InstagramCredentials | null;
    try {
      creds = await resolveInstagramCredentials(createAdminClient(), {
        organizationId: input.organizationId,
        accountId: input.sessionRef,
      });
    } catch {
      return { reachable: false, status: null, detail: "credenciais_indisponiveis" };
    }
    if (!creds) return { reachable: false, status: null, detail: "sem_credencial_para_a_sessao" };

    let r: Awaited<ReturnType<typeof chamar>>;
    try {
      r = await chamar(`${creds.baseUrl}/${creds.accountId}?fields=username`, {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      });
    } catch {
      return { reachable: false, status: null, detail: "rede_indisponivel" };
    }
    if (r.status >= 500) return { reachable: false, status: null, detail: `http_${r.status}` };
    if (!r.ok || r.body.error) {
      const mapeado = detalheDoCodigo(r.body.error?.code);
      return {
        reachable: true,
        status: mapeado === "token_expirado" ? "token_expirado" : "FAILED",
        detail: mapeado ?? `http_${r.status}`,
      };
    }
    return { reachable: true, status: "WORKING", detail: null };
  },
};
