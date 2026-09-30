import { describe, expect, it } from "vitest";
import {
  CHANNEL_CAPABILITIES,
  capabilitiesOf,
  getAdapter,
  transportaMensagem,
  PROVIDERS_DE_MENSAGEM,
} from "@/lib/channels";
import { resolveSessionRef, CHANNEL_SESSION_REF_COLUMNS } from "@/lib/channels/session-ref";

describe("canal instagram — matriz", () => {
  it("é canal de mensagem", () => {
    expect(PROVIDERS_DE_MENSAGEM).toContain("instagram");
    expect(transportaMensagem("instagram")).toBe(true);
  });
  it("declara restrição de plataforma sem template e sem ban de auto-restrição", () => {
    const c = capabilitiesOf("instagram");
    expect(c.freeformOutsideWindow).toBe(false); // janela de 24h da Meta
    expect(c.requiresTemplates).toBe(false); // Instagram não tem templates de WhatsApp
    expect(c.canManageTemplates).toBe(false);
    expect(c.banRisk).toBe(false);
    expect(c.groups).toBe("none");
    expect(CHANNEL_CAPABILITIES.instagram).toEqual(c);
  });
  it("resolve o ref pela conta", () => {
    expect(
      resolveSessionRef({ provider: "instagram", instagram_account_id: "17841400000000000" }),
    ).toBe("17841400000000000");
    expect(CHANNEL_SESSION_REF_COLUMNS).toContain("instagram_account_id");
  });
  it("registra o adapter real: sem endereco pelo contato e inutilizavel sem credencial", async () => {
    const a = getAdapter("instagram");
    expect(a.provider).toBe("instagram");
    expect(
      a.resolveRecipient({
        isGroup: false,
        groupChatId: null,
        phoneNumber: "+5511999999999",
        waIdentity: null,
      }),
    ).toBeNull();
    // Sem thread nao ha endereco: lanca antes de qualquer rede ou banco.
    await expect(
      a.send({ organizationId: "org-1", sessionRef: "17841400000000000", to: "x", kind: "text", body: "oi" }),
    ).rejects.toThrow("sem_thread_do_instagram");
  });
});
