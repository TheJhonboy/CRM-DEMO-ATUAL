/**
 * Parser PURO do webhook do Instagram (sem banco, sem rede): assinatura HMAC
 * do app Meta, handshake GET e leitura dos eventos de mensagem.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import type { InstagramEnvelope } from "./envelope";

export { lerEnvelopeInstagram } from "./envelope";
export type { InstagramEnvelope } from "./envelope";

export type InstagramMessage = {
  kind: "message";
  externalId: string;
  accountId: string;
  senderId: string;
  /** Quem recebe. No eco (is_echo) o remetente e a NOSSA conta e o cliente e este. */
  recipientId: string | null;
  text: string | null;
  attachments: { type: string; url: string | null }[];
  timestamp: number;
  isEcho: boolean;
};

export type InstagramRead = {
  kind: "read";
  accountId: string;
  senderId: string;
  timestamp: number;
};

export type InstagramEvent = InstagramMessage | InstagramRead;

export function verifyInstagramSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const [algo, received] = header.split("=");
  if (algo !== "sha256" || !received) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  if (received.length !== expected.length) return false;
  if (!/^[0-9a-f]+$/i.test(received)) return false;
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

export function instagramChallenge(params: URLSearchParams, expectedToken: string): string | null {
  if (params.get("hub.mode") !== "subscribe") return null;
  if (!expectedToken) return null;
  const given = params.get("hub.verify_token") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expectedToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null; // tempo constante
  // O challenge é ecoado no corpo: só o formato que a Meta manda (números) e com teto.
  const challenge = params.get("hub.challenge");
  return challenge !== null && /^[0-9A-Za-z_-]{1,256}$/.test(challenge) ? challenge : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function anexos(raw: unknown): InstagramMessage["attachments"] {
  if (!Array.isArray(raw)) return [];
  const out: InstagramMessage["attachments"] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const { type, payload } = a as { type?: unknown; payload?: unknown };
    if (typeof type !== "string") continue;
    const url = payload && typeof payload === "object" ? str((payload as { url?: unknown }).url) : null;
    out.push({ type, url });
  }
  return out;
}

export function parseInstagramInbound(envelope: InstagramEnvelope): InstagramEvent[] {
  const eventos: InstagramEvent[] = [];
  try {
    if (envelope?.object !== "instagram") return eventos;
    for (const entry of envelope.entry ?? []) {
      const accountId = str(entry?.id);
      if (!accountId) continue;
      for (const m of entry.messaging ?? []) {
        const senderId = str(m?.sender?.id);
        if (!senderId) continue;
        const timestamp = typeof m.timestamp === "number" ? m.timestamp : 0;
        const mid = str(m.message?.mid);
        if (m.message && mid) {
          eventos.push({
            kind: "message",
            externalId: mid,
            accountId,
            senderId,
            recipientId: str(m?.recipient?.id),
            text: str(m.message.text),
            attachments: anexos(m.message.attachments),
            timestamp,
            isEcho: m.message.is_echo === true,
          });
        } else if (m.read) {
          eventos.push({ kind: "read", accountId, senderId, timestamp });
        }
      }
    }
  } catch {
    // Nunca lança: forma desconhecida é ignorada.
  }
  return eventos;
}
