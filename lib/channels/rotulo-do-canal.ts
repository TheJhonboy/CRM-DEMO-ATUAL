/**
 * O MEIO por onde a conversa acontece, num rótulo neutro para quem está FORA de
 * `lib/channels/` (MCP, integrações, prompt).
 *
 * `conversations.channel` não responde isso: a coluna tem CHECK que só aceita
 * `'whatsapp'`, e por isso toda conversa do Instagram saía pelo MCP como
 * "whatsapp". O canal real é o da SESSÃO (`channel_sessions.provider`), mas o nome
 * do provider é TRANSPORTE (três deles falam WhatsApp) e o invariante 1 da
 * doutrina proíbe que ele vaze para feature. O rótulo aqui é o meio que o cliente
 * usa, não o encanamento.
 *
 * `Record<ProviderDeMensagem, …>` de propósito: canal de mensagem novo não compila
 * até alguém decidir qual meio ele é.
 */
import type { ProviderDeMensagem } from "./types";

export type RotuloDoCanal = "whatsapp" | "instagram";

const ROTULO: Record<ProviderDeMensagem, RotuloDoCanal> = {
  waha: "whatsapp",
  meta_cloud: "whatsapp",
  zernio: "whatsapp",
  instagram: "instagram",
};

/**
 * O rótulo do meio desta conversa. Sem provider (sessão não embutida) ou com um
 * provider que esta imagem não conhece, devolve `coluna` — o valor que o banco já
 * dizia —, em vez de inventar um meio.
 */
export function canalDaConversa(provider: string | null | undefined, coluna: string): string {
  if (!provider) return coluna;
  return ROTULO[provider as ProviderDeMensagem] ?? coluna;
}
