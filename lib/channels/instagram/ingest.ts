/**
 * Ingestão do Instagram: evento já verificado → contato, conversa, mensagem.
 *
 * A leitura do payload é do parser puro (`./webhook.ts`); aqui moram os EFEITOS.
 *
 * ─── A organização vem da SESSÃO, nunca do payload ──────────────────────────
 *
 * Quem chama (`lib/channels/inbound.ts`) já resolveu o token do caminho para uma
 * sessão e passa `organizationId` e `accountId` DELA. Um evento cujo `accountId`
 * difere do da sessão é de outra conta — pode ser de outra organização — e é
 * ignorado sem escrever nada. O payload assinado por um app Meta compartilhado
 * não autoriza escrever no tenant de quem só conhece o token de outro.
 *
 * ─── Identidade ─────────────────────────────────────────────────────────────
 *
 * O contato é o IGSID (id com escopo do app), guardado em
 * `source_metadata.instagram_igsid`; a coluna `instagram_scoped_id` é GERADA a
 * partir dele e tem índice único por organização, então ela é só para LEITURA e
 * para o banco arbitrar a corrida. Telefone não existe neste canal e não é
 * inventado. A thread da conversa é o próprio IGSID: é o endereço de envio.
 *
 * ─── Idempotência ───────────────────────────────────────────────────────────
 *
 * `(organization_id, external_id)` único no INSERT da mensagem, com captura do
 * `23505`, como o Zernio. O eco do nosso próprio envio cai aí e vira `duplicate`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { pausarIaPorAtendimentoManual } from "@/lib/escalacao/atendimento-manual";
import { logger } from "@/lib/logger";

import { CHANNEL_PROVIDER_INSTAGRAM } from "../capabilities";
import { marcarConversaComMensagem } from "../marcar-conversa";
import { aplicarEfeitosPosEntrada } from "../pos-entrada";

import type { InstagramEvent, InstagramMessage, InstagramRead } from "./webhook";

export interface InstagramIngestResult {
  status: "ingested" | "duplicate" | "ignored";
  conversationId?: string;
  messageId?: string;
  reason?: string;
}

const MAX_ANEXOS = 10;
const MAX_URL = 2048;

type Anexo = { type: string; url?: string };

/**
 * Anexo seguro: a URL só sobrevive se for `https://` e curta. Qualquer outra
 * coisa (`http:`, `javascript:`, `data:`, caminho relativo, texto enorme) fica
 * sem URL — o tipo é guardado, a URL nunca chega ao worker que a baixa.
 */
export function anexosSeguros(brutos: InstagramMessage["attachments"]): Anexo[] {
  return brutos.slice(0, MAX_ANEXOS).map((a) => {
    const ok = typeof a.url === "string" && a.url.startsWith("https://") && a.url.length <= MAX_URL;
    return ok ? { type: a.type, url: a.url as string } : { type: a.type };
  });
}

export async function ingestInstagramInbound(
  admin: SupabaseClient,
  input: { organizationId: string; channelSessionId: string; accountId: string; events: InstagramEvent[]; requestId?: string },
): Promise<InstagramIngestResult[]> {
  const resultados: InstagramIngestResult[] = [];
  for (const ev of input.events) {
    if (!input.accountId || ev.accountId !== input.accountId) {
      resultados.push({ status: "ignored", reason: "conta_de_outra_sessao" });
      continue;
    }
    resultados.push(ev.kind === "read" ? await aplicarLeitura(admin, input, ev) : await ingerirMensagem(admin, input, ev));
  }
  return resultados;
}

type Base = { organizationId: string; channelSessionId: string; requestId?: string };

async function aplicarLeitura(admin: SupabaseClient, input: Base, ev: InstagramRead): Promise<InstagramIngestResult> {
  const { data: conv } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("channel_session_id", input.channelSessionId)
    .eq("provider_conversation_id", ev.senderId)
    .maybeSingle();
  const conversationId = (conv as { id: string } | null)?.id;
  if (!conversationId) return { status: "ignored", reason: "conversa_desconhecida" };

  const { data } = await admin
    .from("messages")
    .update({ status: "read" })
    .eq("organization_id", input.organizationId)
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    // Não rebaixa nem reescreve: a ordem de entrega do webhook não é garantida.
    .not("status", "in", "(read,failed)")
    .select("id");
  return { status: "ingested", conversationId, reason: `status_read_${(data ?? []).length}` };
}

async function ingerirMensagem(admin: SupabaseClient, input: Base, ev: InstagramMessage): Promise<InstagramIngestResult> {
  const anexos = anexosSeguros(ev.attachments);
  if (!ev.text && anexos.length === 0) return { status: "ignored", reason: "mensagem_vazia" };

  // No eco o remetente é a NOSSA conta e o cliente é o destinatário.
  const igsid = ev.isEcho ? ev.recipientId : ev.senderId;
  if (!igsid || igsid === ev.accountId) return { status: "ignored", reason: "cliente_nao_identificado" };

  // Eco de mid conhecido é o nosso próprio envio: nada a fazer, nenhum efeito.
  if (ev.isEcho && (await midJaExiste(admin, input.organizationId, ev.externalId))) {
    return { status: "duplicate" };
  }

  const contactId = await garantirContato(admin, input.organizationId, igsid);
  if (!contactId) return { status: "ignored", reason: "contato_nao_resolvido" };

  const conversationId = await garantirConversa(admin, input, contactId, igsid);
  if (!conversationId) return { status: "ignored", reason: "conversa_nao_resolvida" };

  const inserida = await inserirMensagem(admin, input, { conversationId, contactId, ev, anexos });
  if (inserida === "duplicate") return { status: "duplicate", conversationId };

  const at = ev.timestamp > 0 ? new Date(ev.timestamp).toISOString() : new Date().toISOString();
  await marcarConversaComMensagem(admin, {
    organizationId: input.organizationId,
    conversationId,
    direction: ev.isEcho ? "outbound" : "inbound",
    preview: (ev.text ?? "").slice(0, 200),
    at,
    canal: CHANNEL_PROVIDER_INSTAGRAM,
  });

  if (anexos.some((a) => a.url)) await pedirPersistenciaDaMidia(admin, input.organizationId, conversationId, inserida);

  if (ev.isEcho) {
    // Resposta humana fora do CRM: a IA cala nesta conversa. Nunca acorda o agente.
    await pausarIaPorAtendimentoManual(admin, {
      organizationId: input.organizationId,
      conversationId,
      canal: CHANNEL_PROVIDER_INSTAGRAM,
    });
  } else {
    await aplicarEfeitosPosEntrada(admin as never, {
      organizationId: input.organizationId,
      contactId,
      conversationId,
      messageId: inserida,
      channelSessionId: input.channelSessionId,
      texto: ev.text,
      nomeDoContato: null,
      requestId: input.requestId,
      origem: "instagram_webhook",
    });
  }

  return { status: "ingested", conversationId, messageId: inserida };
}

async function midJaExiste(admin: SupabaseClient, organizationId: string, externalId: string): Promise<boolean> {
  const { data } = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("external_id", externalId)
    .limit(1)
    .maybeSingle();
  return data != null;
}

async function contatoPeloIgsid(admin: SupabaseClient, organizationId: string, igsid: string): Promise<string | null> {
  const { data } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("instagram_scoped_id", igsid)
    .is("is_merged_into", null)
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Upsert por `(organization_id, instagram_scoped_id)`. A coluna é gerada: escreve-se
 * `source_metadata` e lê-se pela coluna. Duas primeiras mensagens simultâneas do
 * mesmo IGSID: a segunda leva `23505` do índice único e relê.
 */
async function garantirContato(admin: SupabaseClient, organizationId: string, igsid: string): Promise<string | null> {
  const existente = await contatoPeloIgsid(admin, organizationId, igsid);
  if (existente) return existente;

  const { data, error } = await admin
    .from("contacts")
    .insert({
      organization_id: organizationId,
      display_name: `Instagram ${igsid.slice(-4)}`,
      source: CHANNEL_PROVIDER_INSTAGRAM,
      source_metadata: { instagram_igsid: igsid },
    })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") return contatoPeloIgsid(admin, organizationId, igsid);
  if (error || !data) {
    logger.warn("[instagram] contato não criado", { organization_id: organizationId, detail: error?.message?.slice(0, 160) });
    return null;
  }
  return (data as { id: string }).id;
}

async function garantirConversa(
  admin: SupabaseClient,
  input: Base,
  contactId: string,
  igsid: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_upsert_wa_conversation", {
    p_org: input.organizationId,
    p_contact: contactId,
    p_session: input.channelSessionId,
  });
  if (error || !data) return null;
  const conversationId = data as string;
  // A thread é o endereço de envio. Gravada SEMPRE, sem `.neq()`: em SQL
  // `NULL <> 'x'` não é TRUE e o update nunca alcançaria a conversa nova.
  await admin.from("conversations").update({ provider_conversation_id: igsid }).eq("id", conversationId);
  return conversationId;
}

async function inserirMensagem(
  admin: SupabaseClient,
  input: Base,
  a: { conversationId: string; contactId: string; ev: InstagramMessage; anexos: Anexo[] },
): Promise<string | "duplicate"> {
  const { ev, anexos } = a;
  const primeiro = anexos[0];
  const comUrl = anexos.find((x) => x.url);
  const { data, error } = await admin
    .from("messages")
    .insert({
      organization_id: input.organizationId,
      conversation_id: a.conversationId,
      contact_id: a.contactId,
      channel_session_id: input.channelSessionId,
      external_id: ev.externalId,
      direction: ev.isEcho ? "outbound" : "inbound",
      // Veio do webhook, não do composer: o default `crm` mentiria.
      sent_via: "external_device",
      status: ev.isEcho ? "sent" : "delivered",
      type: primeiro ? tipoDoAnexo(primeiro.type) : "text",
      body: ev.text,
      ...(comUrl?.url ? { media_url: comUrl.url, media_mime: mimeDoAnexo(comUrl.type) } : {}),
      metadata: anexos.length > 0 ? { provider_attachments: anexos } : {},
      ...(ev.timestamp > 0 ? { sent_at: new Date(ev.timestamp).toISOString() } : {}),
    })
    .select("id")
    .maybeSingle();

  // 23505 = reentrega do mesmo mid: desfecho esperado, não erro.
  if (error?.code === "23505") return "duplicate";
  if (error || !data) throw new Error(`instagram_ingest_insert_failed: ${error?.message ?? "sem id"}`);
  return (data as { id: string }).id;
}

async function pedirPersistenciaDaMidia(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  messageId: string,
): Promise<void> {
  const { error } = await admin.rpc("emit_event" as never, {
    p_event_type: "media.persist_requested",
    p_entity_kind: "message",
    p_entity_id: messageId,
    p_payload: { message_id: messageId, conversation_id: conversationId },
    p_metadata: { source: "instagram_webhook" },
    p_organization_id: organizationId,
  } as never);
  if (error) logger.warn("[instagram] emit media.persist_requested falhou", { messageId, detail: error.message });
}

function mimeDoAnexo(tipo: string): string | null {
  if (tipo === "image") return "image/jpeg";
  if (tipo === "video") return "video/mp4";
  if (tipo === "audio") return "audio/mp4";
  return null;
}

function tipoDoAnexo(tipo: string): string {
  return tipo === "image" || tipo === "video" || tipo === "audio" ? tipo : "document";
}
