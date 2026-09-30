/**
 * O CONTRATO do que o webhook do Instagram manda — declarado, e não presumido.
 *
 * Mesma regra dos outros canais: um campo ganha tipo quando o código o consome
 * sem guarda própria. `entry` e `messaging` precisam ser arrays de verdade
 * (o parser itera sobre eles) e `message.mid` precisa ser string (é a chave de
 * idempotência). `attachments` fica `unknown`: o parser já o trata em qualquer
 * forma, e apertar aqui trocaria "anexo ignorado" por "mensagem descartada".
 *
 * A recusa nomeia CAMPOS, nunca VALORES (dado de cliente).
 */
import { z } from "zod";

import { lerEnvelope } from "@/lib/webhooks/contrato";

const texto = z.string().nullish();
const numero = z.number().nullish();

const participante = z.looseObject({ id: texto }).nullish();

const instagramMessagingSchema = z.looseObject({
  sender: participante,
  recipient: participante,
  timestamp: numero,
  message: z
    .looseObject({
      mid: texto,
      text: texto,
      is_echo: z.boolean().nullish(),
      // `.optional()` é obrigatório no Zod 4 para `unknown` dentro de objeto.
      attachments: z.unknown().optional(),
    })
    .nullish(),
  read: z.looseObject({ mid: texto }).nullish(),
});

const instagramEntrySchema = z.looseObject({
  id: texto,
  time: numero,
  messaging: z.array(instagramMessagingSchema).max(50).nullish(),
});

export const instagramEnvelopeSchema = z.looseObject({
  object: texto,
  entry: z.array(instagramEntrySchema).max(20).nullish(),
});

export type InstagramEnvelope = z.infer<typeof instagramEnvelopeSchema>;

export type LeituraEnvelopeInstagram =
  | { ok: true; envelope: InstagramEnvelope }
  | { ok: false; motivo: "json_invalido" }
  | { ok: false; motivo: "contrato_violado"; campos: string[] };

export function lerEnvelopeInstagram(raw: string): LeituraEnvelopeInstagram {
  const r = lerEnvelope(raw, instagramEnvelopeSchema);
  if (r.ok) return r;
  if (r.motivo === "json_invalido") return { ok: false, motivo: "json_invalido" };
  return { ok: false, motivo: "contrato_violado", campos: r.campos };
}
