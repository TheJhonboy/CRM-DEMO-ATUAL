import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  isServiceRoleConfigured: () => false,
}));

import {
  CHANNEL_PROVIDER_INSTAGRAM,
  CHANNEL_PROVIDER_META,
  CHANNEL_PROVIDER_WAHA,
  CHANNEL_PROVIDER_ZERNIO,
} from "@/lib/channels/capabilities";
import { canalDaConversa } from "@/lib/channels/rotulo-do-canal";
import { crmGetConversation, crmListConversations } from "@/lib/mcp/tools/conversations";
import type { McpContext } from "@/lib/mcp/types";

/**
 * O CANAL QUE O MCP DIZ É O CANAL DA SESSÃO — não a coluna que só conhece um valor.
 *
 * `conversations.channel` tem CHECK que só aceita 'whatsapp'. O MCP devolvia essa
 * coluna, então uma conversa do Instagram chegava à IA (e a qualquer integração)
 * como "whatsapp" — e a IA que lê isso oferece "te mando no WhatsApp" a quem está
 * no Direct. O canal real mora em `channel_sessions.provider`; quem traduz para um
 * rótulo NEUTRO (de meio, não de transporte) é `lib/channels/`, e o MCP não escreve
 * nome de provider nenhum.
 */

const ORG = "22222222-2222-4222-8222-222222222222";
const CONV = "aaaaaaaa-0000-4000-8000-000000000001";

function linha(provider: string | null) {
  return {
    id: CONV,
    organization_id: ORG,
    contact_id: "c0000000-0000-4000-8000-000000000001",
    channel_session_id: "s0000000-0000-4000-8000-000000000001",
    channel: "whatsapp",
    status: "claimed",
    assigned_to_user_id: null,
    assignee_kind: null,
    assigned_at: null,
    last_inbound_at: null,
    last_outbound_at: null,
    last_message_at: null,
    last_message_preview: "oi",
    unread_count_for_assignee: 0,
    is_group: false,
    group_chat_id: null,
    tags: [],
    metadata: {},
    comando_da_conversa: "humano",
    channel_sessions: provider === null ? null : { phone_number: null, display_name: null, provider },
  };
}

function ctx(row: Record<string, unknown>): McpContext {
  const from = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    for (const m of ["select", "eq", "is", "in", "or", "contains", "ilike", "order", "limit", "not", "neq", "gte", "lte", "lt", "gt"]) {
      chain[m] = () => chain;
    }
    chain.maybeSingle = () => Promise.resolve({ data: row, error: null });
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [row], error: null }).then(res);
    return chain;
  };
  return {
    organizationId: ORG,
    role: "agent",
    actor: { type: "ai_agent", id: "run_1", role: "agent", api_token_id: "tok" },
    apiTokenId: "tok",
    requestId: "req",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: { from, auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } } } as any,
  } as McpContext;
}

describe("canalDaConversa — rótulo neutro a partir do provider da sessão", () => {
  it("os três transportes de WhatsApp dizem 'whatsapp'; o Direct diz 'instagram'", () => {
    expect(canalDaConversa(CHANNEL_PROVIDER_WAHA, "whatsapp")).toBe("whatsapp");
    expect(canalDaConversa(CHANNEL_PROVIDER_META, "whatsapp")).toBe("whatsapp");
    expect(canalDaConversa(CHANNEL_PROVIDER_ZERNIO, "whatsapp")).toBe("whatsapp");
    expect(canalDaConversa(CHANNEL_PROVIDER_INSTAGRAM, "whatsapp")).toBe("instagram");
  });

  it("sem sessão resolvida (ou provider desconhecido) cai na coluna — não inventa", () => {
    expect(canalDaConversa(null, "whatsapp")).toBe("whatsapp");
    expect(canalDaConversa("provider_do_futuro", "whatsapp")).toBe("whatsapp");
  });
});

describe("MCP — o canal exposto vem da sessão", () => {
  it("crm_get_conversation: conversa do Instagram sai como 'instagram'", async () => {
    const res = (await crmGetConversation.handler(
      { conversation_id: CONV },
      ctx(linha(CHANNEL_PROVIDER_INSTAGRAM)),
    )) as Record<string, unknown>;
    expect(res.channel).toBe("instagram");
  });

  it("crm_get_conversation: conversa de WhatsApp continua 'whatsapp'", async () => {
    const res = (await crmGetConversation.handler(
      { conversation_id: CONV },
      ctx(linha(CHANNEL_PROVIDER_META)),
    )) as Record<string, unknown>;
    expect(res.channel).toBe("whatsapp");
  });

  it("crm_list_conversations: mesmo rótulo por linha", async () => {
    const res = (await crmListConversations.handler(
      { limit: 10 } as Parameters<typeof crmListConversations.handler>[0],
      ctx(linha(CHANNEL_PROVIDER_INSTAGRAM)),
    )) as { conversations: Array<Record<string, unknown>> };
    expect(res.conversations[0]?.channel).toBe("instagram");
  });

  it("a tool do MCP não nomeia provider — pergunta a lib/channels", () => {
    const fonte = readFileSync("lib/mcp/tools/conversations.ts", "utf8");
    expect(fonte).toMatch(/canalDaConversa\(/);
    expect(fonte).not.toMatch(/"instagram"|"meta_cloud"|"zernio"|"waha"/);
  });
});
