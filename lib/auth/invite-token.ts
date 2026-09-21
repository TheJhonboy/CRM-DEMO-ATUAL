/**
 * Stateless HMAC-SHA256 invite token. Self-contained payload, signed and
 * base64url-encoded — no DB row required to issue. Verified at accept time.
 *
 * Format: `<body>.<sig>` where
 *   - body = base64url(JSON({invite_id, email, organization_id, role, exp}))
 *   - sig  = base64url(HMAC_SHA256(secret, body))
 *
 * Secret resolution: INVITE_TOKEN_SECRET → INTERNAL_SECRET. There is NO
 * built-in fallback: when neither is set (empty or whitespace-only counts as
 * not set) signing AND verifying throw, so a misconfigured server fails loudly
 * instead of trusting a value that sits in a public repository. Production
 * deployments MUST set one of the two. Verification uses `timingSafeEqual` to
 * avoid timing oracles.
 */
import { z } from "zod";
import { interfaceSettingsSchema, type InterfaceSettings } from "@/lib/navigation/interface";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Resolvido na hora do uso, não no import. Vazio ou só espaços conta como
 * AUSENTE: `??` só cai no próximo em null/undefined, e o `.env.example` entrega
 * `INTERNAL_SECRET=` vazio — `""` passaria e assinaria com chave de comprimento
 * zero. O valor devolvido é o BRUTO (sem trim) de propósito: quem já tem convite
 * assinado com um segredo que tem espaço nas pontas não pode ter a chave mudada.
 * A mensagem do erro nomeia as variáveis, nunca valores.
 */
const SECRET = (): string => {
  for (const candidato of [process.env.INVITE_TOKEN_SECRET, process.env.INTERNAL_SECRET]) {
    if (candidato !== undefined && candidato.trim() !== "") return candidato;
  }
  throw new Error(
    "Segredo de assinatura de convites ausente: defina INVITE_TOKEN_SECRET ou INTERNAL_SECRET (não vazio).",
  );
};

export interface InvitePayload {
  interface_settings?: InterfaceSettings;
  invite_id: string;
  email: string;
  organization_id: string;
  role: string;
  exp: number; // epoch seconds
  iat?: number;
  invited_by?: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signInviteToken(payload: InvitePayload): string {
  const json = JSON.stringify(payload);
  const body = b64url(Buffer.from(json, "utf8"));
  const sig = b64url(createHmac("sha256", SECRET()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyInviteToken(token: string): InvitePayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = b64url(createHmac("sha256", SECRET()).update(body).digest());
  if (sig.length !== expected.length) return null;

  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  let payload: InvitePayload;
  try {
    const json = Buffer.from(body, "base64url").toString("utf8");
    payload = JSON.parse(json) as InvitePayload;
  } catch {
    return null;
  }

  const checked = z
    .object({
      invite_id: z.string().uuid(),
      email: z.string().email(),
      organization_id: z.string().uuid(),
      role: z.enum(["viewer", "agent", "manager", "admin"]),
      exp: z.number().int().positive(),
      iat: z.number().int().positive().optional(),
      invited_by: z.string().uuid().optional(),
      interface_settings: interfaceSettingsSchema.optional(),
    })
    .safeParse(payload);
  if (!checked.success) return null;
  payload = checked.data;

  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}

export const INVITE_TTL_SECONDS = 60 * 60 * 24; // 24h
