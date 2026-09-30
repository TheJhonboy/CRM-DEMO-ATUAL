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
  it("registra o adapter (stub até a Task 6): não configurado e sem endereço", () => {
    const a = getAdapter("instagram");
    expect(a.provider).toBe("instagram");
    expect(a.isConfigured()).toBe(false);
  });
});
