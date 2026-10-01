/**
 * Mídia que o cliente manda no Instagram: quais URLs são aceitas e como o anexo é baixado.
 *
 * A URL vem do PAYLOAD do webhook (assinado, mas o conteúdo é do remetente). Por isso a
 * mesma função decide em dois momentos: na ingestão (a URL só é gravada se passar) e no
 * download (revalidada, porque a linha pode ter sido gravada por outra versão do código).
 * O download NÃO leva credencial: são URLs assinadas de CDN, e mandar o token a um host
 * escolhido pelo payload seria entregar a credencial.
 */
import { MAX_MEDIA_BYTES, MediaTooLargeError, type FetchedMedia } from "@/lib/messaging/media/types";

export const MAX_URL_DE_MIDIA = 2048;
/** Hosts de mídia da Meta: o host precisa ser igual ao domínio ou terminar em `.domínio`. */
export const DOMINIOS_DE_MIDIA = ["cdninstagram.com", "fbcdn.net", "fbsbx.com"];
export const TIMEOUT_DA_MIDIA_MS = 15_000;
/** O lookaside da Meta costuma responder 302 para o CDN: seguimos poucos saltos, cada um revalidado. */
export const MAX_SALTOS_DA_MIDIA = 3;

export function urlDeMidiaPermitida(url: unknown): url is string {
  if (typeof url !== "string" || url.length > MAX_URL_DE_MIDIA || !url.startsWith("https://")) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return DOMINIOS_DE_MIDIA.some((d) => host === d || host.endsWith(`.${d}`));
}

const ehMidia = (mime: string) => /^(image|audio|video)\//.test(mime) || mime === "application/pdf";

/** Erros com texto nosso: nunca a URL (assinada) nem a mensagem do runtime. */
export class InstagramMediaError extends Error {
  constructor(detail: string) {
    super(`instagram_media_${detail}`);
    this.name = "InstagramMediaError";
  }
}

export async function baixarMidiaDoInstagram(url: string, hintMime?: string | null): Promise<FetchedMedia> {
  if (!urlDeMidiaPermitida(url)) throw new InstagramMediaError("url_nao_permitida");

  // Um prazo só para a cadeia inteira de saltos.
  const signal = AbortSignal.timeout(TIMEOUT_DA_MIDIA_MS);
  let atual = url;
  let res: Response;
  for (let saltos = 0; ; saltos++) {
    try {
      // Sem Authorization nunca. `manual`: quem decide se o salto vale é a allowlist, não o fetch.
      res = await fetch(atual, { redirect: "manual", signal });
    } catch {
      throw new InstagramMediaError("failed");
    }
    if (res.status < 300 || res.status >= 400) break;
    await res.body?.cancel().catch(() => undefined);
    const local = res.headers.get("location");
    if (!local || saltos >= MAX_SALTOS_DA_MIDIA) throw new InstagramMediaError("redirects");
    let proximo: string;
    try {
      proximo = new URL(local, atual).toString();
    } catch {
      throw new InstagramMediaError("redirects");
    }
    // Cada Location passa pela MESMA allowlist da URL inicial.
    if (!urlDeMidiaPermitida(proximo)) throw new InstagramMediaError("url_nao_permitida");
    atual = proximo;
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new InstagramMediaError(`failed: http_${res.status}`);
  }

  const declarado = res.headers.get("content-length")?.trim();
  if (declarado && /^\d+$/.test(declarado) && Number(declarado) > MAX_MEDIA_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new MediaTooLargeError();
  }

  // O content-type do CDN manda; octet-stream/ausente cai na dica do webhook.
  const doCdn = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  const dica = (hintMime ?? "").split(";")[0]!.trim().toLowerCase();
  const mime = doCdn && doCdn !== "application/octet-stream" ? doCdn : dica || doCdn;
  if (!mime || !ehMidia(mime)) {
    await res.body?.cancel().catch(() => undefined);
    throw new InstagramMediaError("not_media");
  }

  // Teto imposto DURANTE a leitura: content-length mente ou falta.
  const pedacos: Uint8Array[] = [];
  let total = 0;
  // Sem corpo não é mídia vazia de sucesso: é falha (um persistido vazio esconderia o defeito).
  const reader = res.body?.getReader();
  if (!reader) throw new InstagramMediaError("sem_corpo");
  try {
    {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_MEDIA_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new MediaTooLargeError();
        }
        pedacos.push(value);
      }
    }
  } catch (e) {
    if (e instanceof MediaTooLargeError) throw e;
    throw new InstagramMediaError("failed");
  }
  return { buffer: Buffer.concat(pedacos), mime };
}
