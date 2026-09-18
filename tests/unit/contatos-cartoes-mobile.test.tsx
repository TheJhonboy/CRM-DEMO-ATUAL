/**
 * A lista de Contatos existe em DUAS vistas no DOM: cartões abaixo de md
 * (`md:hidden`) e a tabela a partir de md (`hidden md:block`) — o CSS esconde
 * uma em cada largura; o jsdom não aplica CSS, então aqui as duas estão
 * presentes e cada uma é consultada pelo seu próprio contêiner. A tabela HTML
 * não tinha nenhuma classe responsiva: no celular rolava na horizontal e o
 * nome do contato podia sair da tela.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ContactsTable } from "@/components/contacts/ContactsTable";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import type { Contact } from "@/lib/types/contacts";

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useActiveOrg: () => ({ orgId: "org-1", name: "Clínica", role: "admin", cliente_pela_agenda: true }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const CONTATO = {
  id: "c-1",
  organization_id: "org-1",
  name: "Joana Prado",
  display_name: "Joana Prado",
  email: "joana@example.com",
  email_normalized: "joana@example.com",
  phone_number: "+5511999990000",
  cpf_hash: null,
  birthdate: null,
  is_blocked: false,
  blocked_reason: null,
  is_anonymized: false,
  anonymized_at: null,
  is_merged_into: null,
  merged_at: null,
  consent: {},
  tags: ["vip"],
  source: "whatsapp",
  source_metadata: {},
  custom_fields: {},
  created_at: "2026-01-01T10:00:00.000Z",
  updated_at: "2026-01-01T10:00:00.000Z",
  last_activity_at: null,
  first_service_at: "2025-03-12T14:00:00.000Z",
} satisfies Contact;

function montar(contacts: Contact[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <ContactsTable contacts={contacts} orderBy="last_activity_at" orderDir="desc" onSort={() => {}} />
    </QueryClientProvider>
  );
  return render(ui);
}

describe("Contatos — lista de cartões no celular", () => {
  it("cada vista fica no seu breakpoint: cartões abaixo de md, tabela a partir de md", () => {
    montar([CONTATO]);
    expect(screen.getByTestId("lista-mobile-contatos")).toHaveClass("md:hidden");
    expect(screen.getByTestId("tabela-contatos-desktop")).toHaveClass("hidden", "md:block");
  });

  it("a mesma pessoa, com os mesmos dados e os mesmos selos, aparece nas duas vistas", () => {
    montar([CONTATO]);
    for (const vista of [
      screen.getByTestId("lista-mobile-contatos"),
      screen.getByTestId("tabela-contatos-desktop"),
    ]) {
      expect(within(vista).getByRole("link", { name: "Joana Prado" })).toHaveAttribute(
        "href",
        "/app/contacts/c-1",
      );
      expect(within(vista).getByText("joana@example.com")).toBeInTheDocument();
      expect(within(vista).getByText(phoneForDisplay("+5511999990000"))).toBeInTheDocument();
      expect(within(vista).getByText("vip")).toBeInTheDocument();
      expect(within(vista).getByText("Cliente")).toBeInTheDocument();
      expect(within(vista).getByText("Ativo")).toBeInTheDocument();
    }
  });

  it("contato bloqueado mostra o selo Bloqueado e NÃO o Ativo, nas duas vistas", () => {
    montar([{ ...CONTATO, is_blocked: true }]);
    for (const vista of [
      screen.getByTestId("lista-mobile-contatos"),
      screen.getByTestId("tabela-contatos-desktop"),
    ]) {
      expect(within(vista).getByText("Bloqueado")).toBeInTheDocument();
      expect(within(vista).queryByText("Ativo")).toBeNull();
    }
  });

  it("a lixeira do cartão abre a confirmação de exclusão", () => {
    montar([CONTATO]);
    fireEvent.click(
      within(screen.getByTestId("lista-mobile-contatos")).getByRole("button", {
        name: /Excluir contato/,
      }),
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Excluir contato?");
  });

  it("sem telefone e sem conversa, o cartão não oferece o ícone de conversa — mesma regra da tabela", () => {
    montar([{ ...CONTATO, phone_number: null }]);
    for (const vista of [
      screen.getByTestId("lista-mobile-contatos"),
      screen.getByTestId("tabela-contatos-desktop"),
    ]) {
      expect(within(vista).queryByRole("button", { name: /conversa/i })).toBeNull();
      expect(within(vista).queryByRole("link", { name: /conversa/i })).toBeNull();
    }
  });
});
