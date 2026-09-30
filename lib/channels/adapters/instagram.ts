/**
 * STUB TEMPORÁRIO do adapter do Instagram (Task 2). A Task 6 o substitui pelo
 * transporte real (Meta Graph). Até lá o canal existe no tipo e no registro,
 * mas fail-closed: não configurado e sem envio.
 */
import type { ChannelAdapter } from "../types";

export const instagramAdapter: ChannelAdapter = {
  provider: "instagram",
  resolveRecipient: () => null,
  isConfigured: () => false,
  async send() {
    throw new Error("instagram_adapter_not_implemented");
  },
  codes: {
    notConfigured: "instagram_not_configured",
    sendFailed: "instagram_send_failed",
    unknownError: "instagram_unknown_error",
  },
};
