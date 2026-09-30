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
import { baixarMidiaDoInstagram } from "../instagram/midia";
import { dividirTextoEmPartes } from "../instagram/texto";
import type { InstagramCredentials } from "../instagram/credentials";
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelTenantScope,
  OutboundEnvelope,
} from "../types";
import type { FetchedMedia } from "@/lib/messaging/media/types";

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
    readonly detail: string,
    readonly retryable: boolean,
    /**
     * `message_id` das partes JÁ entregues quando um texto longo falha no meio.
     * O handler de envio não tem onde gravá-los (só lê `externalId` do retorno),
     * então hoje é informação de diagnóstico; os ecos dessas partes são tratados
     * como nossos pela ingestão (corpo contido num envio recente nosso).
     */
    readonly externalIdsEnviados: string[] = [],
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

/**
 * `kind` do envelope → lista de `message` da Send API (uma por chamada). Texto acima
 * de 1000 bytes vira várias partes. `null` = tipo que o canal não entrega.
 */
function mensagens(env: OutboundEnvelope): Record<string, unknown>[] | null {
  if (env.kind === "text") {
    return dividirTextoEmPartes(env.body ?? "").map((text) => ({ text }));
  }
  const tipo =
    env.kind === "image" ? "image"
    : env.kind === "video" ? "video"
    : env.kind === "audio" ? "audio"
    : env.kind === "document" ? "file"
    : null;
  if (!tipo || !env.media?.url) return null;
  return [{ attachment: { type: tipo, payload: { url: env.media.url } } }];
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

    const partes = mensagens(envelope);
    if (!partes) throw new InstagramSendError("kind_nao_suportado", false);

    const creds = await credenciais(envelope.organizationId, envelope.sessionRef);

    await envelope.beforeSend?.();
    // Partes em sequência (await de cada uma): a ordem de chegada é a do texto. O único
    // retry é o de `chamar` (5xx/conexão) e é POR PARTE; parte que falha interrompe o
    // envio — as seguintes não saem. O `externalId` devolvido é o da PRIMEIRA parte; o
    // eco das demais é reconhecido pela ingestão (corpo contido no envio recente).
    const enviados: string[] = [];
    let primeiro: string | null = null;
    for (let i = 0; i < partes.length; i++) {
      const sufixo = partes.length > 1 ? ` (parte ${i + 1}/${partes.length})` : "";
      const r = await chamar(`${creds.baseUrl}/${creds.accountId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ recipient: { id: thread }, message: partes[i] }),
      }).catch((e: unknown) => {
        if (e instanceof InstagramSendError && partes.length > 1) {
          // Depois da 1ª parte, re-tentar a mensagem inteira duplicaria o que já chegou.
          throw new InstagramSendError(`${e.detail}${sufixo}`, i === 0 && e.retryable, enviados);
        }
        throw e;
      });

      if (!r.ok || r.body.error) {
        const mapeado = detalheDoCodigo(r.body.error?.code);
        const detalhe = mapeado ?? `http_${r.status}`;
        throw new InstagramSendError(`${detalhe}${sufixo}`, i === 0 && r.status >= 500, enviados);
      }
      if (r.body.message_id) enviados.push(r.body.message_id);
      if (i === 0) primeiro = r.body.message_id ?? null;
    }
    return { externalId: primeiro };
  },

  /**
   * Baixa o anexo que o cliente mandou. As URLs são assinadas do CDN da Meta: sem token, sem
   * redirect, só hosts da allowlist (ver `../instagram/midia.ts`). Não precisa de credencial.
   */
  async fetchInboundMedia(input): Promise<FetchedMedia> {
    return baixarMidiaDoInstagram(input.url, input.hintMime);
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
      r = await chamar(`${creds.baseUrl}/me?fields=user_id,username`, {
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
