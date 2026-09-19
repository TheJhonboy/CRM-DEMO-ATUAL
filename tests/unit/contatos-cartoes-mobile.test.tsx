/**
 * A lista de Contatos existe em DUAS vistas no DOM: cartões abaixo de xl
 * (`xl:hidden`) e a tabela a partir de xl (`hidden xl:block`) — o CSS esconde
 * uma em cada largura; o jsdom não aplica CSS, então aqui as duas estão
 * presentes e cada uma é consultada pelo seu próprio contêiner. A tabela HTML
 * não tinha nenhuma classe responsiva: no celular rolava na horizontal e o
 * nome do contato podia sair da tela.
 *
 * O corte é em `xl` e não em `md` porque foi MEDIDO num Chromium real: a tabela
 * precisa de ~968px e a barra lateral de 240px aparece já a partir de `md`, então
 * de 768 a 1279 ela não cabia (em 768: 968px de tabela numa caixa de 430px, só
 * "Nome" visível e as ações fora da tela). A partir de 1280 ela cabe.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ContactsTable } from "@/components/contacts/ContactsTable";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import type { ContactOrderBy } from "@/lib/schemas/contacts";
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

/** O mesmo contato, agora com uma conversa aberta e 3 mensagens sem ler. */
const COM_CONVERSA = {
  ...CONTATO,
  conversa: { id: "conv-1", preview: null, last_message_at: null, unread: 3 },
} satisfies Contact;

function montar(
  contacts: Contact[],
  {
    onSort = () => {},
    orderBy = "last_activity_at",
    orderDir = "desc",
  }: {
    onSort?: (column: ContactOrderBy) => void;
    orderBy?: ContactOrderBy;
    orderDir?: "asc" | "desc";
  } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <ContactsTable contacts={contacts} orderBy={orderBy} orderDir={orderDir} onSort={onSort} />
    </QueryClientProvider>
  );
  return render(ui);
}

/** As duas vistas, cada uma no seu contêiner — o jsdom não aplica o CSS que esconde uma delas. */
function vistas() {
  return [
    screen.getByTestId("lista-mobile-contatos"),
    screen.getByTestId("tabela-contatos-desktop"),
  ];
}

describe("Contatos — lista de cartões no celular", () => {
  it("cada vista fica no seu breakpoint: cartões abaixo de xl, tabela a partir de xl", () => {
    montar([CONTATO]);
    expect(screen.getByTestId("lista-mobile-contatos")).toHaveClass("xl:hidden");
    expect(screen.getByTestId("tabela-contatos-desktop")).toHaveClass("hidden", "xl:block");
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

  // O gêmeo positivo do caso acima: sem ele, "não oferece" passaria também se o
  // botão tivesse sumido das duas vistas por qualquer outro motivo.
  it("com telefone e sem conversa, cada vista oferece o botão de iniciar conversa", () => {
    montar([CONTATO]);
    for (const vista of vistas()) {
      expect(within(vista).getByRole("button", { name: /Iniciar conversa/ })).toBeInTheDocument();
    }
  });

  it("com conversa aberta, cada vista tem o link do Inbox com as não lidas — e não o botão de iniciar", () => {
    montar([COM_CONVERSA]);
    for (const vista of vistas()) {
      const link = within(vista).getByRole("link", { name: /Abrir conversa com Joana Prado/ });
      expect(link).toHaveAttribute("href", "/app/inbox?id=conv-1");
      // O `sr-only` é o que o leitor de tela fala: "3 sem ler".
      expect(link).toHaveTextContent("3 sem ler");
      expect(within(vista).queryByRole("button", { name: /Iniciar conversa/ })).toBeNull();
    }
  });

  it("anonimizado mostra o selo Anonimizado e NÃO o Ativo, nas duas vistas", () => {
    montar([{ ...CONTATO, is_anonymized: true }]);
    for (const vista of vistas()) {
      expect(within(vista).getByText("Anonimizado")).toBeInTheDocument();
      expect(within(vista).queryByText("Ativo")).toBeNull();
    }
  });

  it("a tabela mantém o botão compacto de 32px; o cartão usa o tamanho de toque até o corte em xl e afasta os botões", () => {
    montar([CONTATO]);
    const cartoes = screen.getByTestId("lista-mobile-contatos");
    const tabela = screen.getByTestId("tabela-contatos-desktop");
    const excluirNaTabela = within(tabela).getByRole("button", { name: /Excluir contato/ });
    const excluirNoCartao = within(cartoes).getByRole("button", { name: /Excluir contato/ });

    // Tabela: exatamente o que era antes desta lista de cartões existir.
    expect(excluirNaTabela).toHaveClass("h-8", "w-8");
    expect(excluirNaTabela.parentElement).toHaveClass("gap-0.5");

    // Cartão: não herda o compacto. `h-11 w-11` é o tamanho `icon` do Button
    // abaixo de `lg` (o alvo de toque); sem essa metade, "não tem h-8" passaria
    // também para um botão quebrado. Os cartões aparecem até xl, e o `icon` cai
    // para 36px em `lg` (iPad em paisagem, 1024px, é touch): `lg:h-11 lg:w-11`
    // devolve os 44px até o corte. E dois alvos de 44px lado a lado (conversa e
    // lixeira) não podem ficar a 2px um do outro.
    expect(excluirNoCartao).not.toHaveClass("h-8");
    expect(excluirNoCartao).toHaveClass("h-11", "w-11", "lg:h-11", "lg:w-11");
    expect(excluirNoCartao.parentElement).toHaveClass("gap-2");
    // A tabela (só a partir de xl, com mouse) continua no 36px do `icon` em `lg`.
    expect(excluirNaTabela).not.toHaveClass("lg:h-11");

    // O nome é o alvo principal do cartão: 44px de altura, não os ~24px do texto.
    expect(within(cartoes).getByRole("link", { name: "Joana Prado" })).toHaveClass("py-2.5");
  });

  describe("ordenação no celular", () => {
    // Abaixo de xl a tabela some e com ela os cabeçalhos ordenáveis; a barra de
    // chips devolve a ordenação ao celular reusando o MESMO `onSort`.
    it("a barra tem os quatro critérios, marca só o atual e chama o onSort da tabela", () => {
      const onSort = vi.fn();
      montar([CONTATO], { onSort });
      const barra = screen.getByTestId("ordenacao-mobile-contatos");

      expect(within(barra).getAllByRole("button")).toHaveLength(4);
      expect(within(barra).getByRole("button", { name: /^Última atividade/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      for (const outro of ["Nome", "Email", "Telefone"]) {
        expect(within(barra).getByRole("button", { name: outro })).toHaveAttribute(
          "aria-pressed",
          "false",
        );
      }

      fireEvent.click(within(barra).getByRole("button", { name: "Email" }));
      expect(onSort).toHaveBeenCalledTimes(1);
      expect(onSort).toHaveBeenCalledWith("email");
    });

    it("o critério atual mostra o sentido por extenso para o leitor de tela, e só ele", () => {
      montar([CONTATO], { orderBy: "display_name", orderDir: "asc" });
      const barra = screen.getByTestId("ordenacao-mobile-contatos");

      expect(within(barra).getByRole("button", { name: /^Nome/ })).toHaveTextContent("(crescente)");
      expect(within(barra).queryByText("(decrescente)")).toBeNull();
      // Os outros três não carregam sentido nenhum.
      expect(within(barra).getAllByText(/\((de)?crescente\)/)).toHaveLength(1);
    });

    it("o sentido invertido troca o texto do leitor de tela", () => {
      montar([CONTATO], { orderBy: "display_name", orderDir: "desc" });
      const barra = screen.getByTestId("ordenacao-mobile-contatos");

      expect(within(barra).getByRole("button", { name: /^Nome/ })).toHaveTextContent("(decrescente)");
      expect(within(barra).queryByText("(crescente)")).toBeNull();
    });

    // A barra é `overflow-x-auto` e recorta o que passa da sua caixa: o anel de foco
    // padrão (2px + offset de 2px) saía cortado 4px em cima e à esquerda, medido num
    // Chromium real. O offset negativo desenha o anel para DENTRO do chip.
    it("cada chip desenha o anel de foco para dentro, senão a barra rolável o recorta", () => {
      montar([CONTATO]);
      const chips = within(screen.getByTestId("ordenacao-mobile-contatos")).getAllByRole("button");
      expect(chips).toHaveLength(4);
      for (const chip of chips) {
        expect(chip).toHaveClass("focus-visible:-outline-offset-2");
      }
    });
  });

  // É TEXTO e não render de propósito: `_client.tsx` precisa de uma página
  // inteira de providers (organização, auth, query, filtros) para montar. O que
  // se prende aqui é só a classe do Card que envolve a lista — sem ela, abaixo
  // de md os cartões ficariam dentro de outro cartão, com a borda dobrada — e a
  // raiz da página, que dobrava a margem lateral.
  it("o Card da página perde borda, fundo e sombra abaixo de md (senão: cartão dentro de cartão)", () => {
    const fonte = readFileSync(
      join(__dirname, "..", "..", "app", "app", "contacts", "_client.tsx"),
      "utf8",
    );
    expect(fonte).toContain(
      '<Card className="overflow-hidden max-md:border-0 max-md:bg-transparent max-md:shadow-none">',
    );
  });

  // Medido no celular (375px): `main p-6` + a raiz `p-6` deixavam os cartões com
  // 279px de largura; sem o padding da raiz, 327px. Só abaixo de md — a partir dali
  // a barra lateral ocupa a coluna e a página volta ao respiro de desktop.
  it("a raiz da página não repete o padding da main no celular (senão: margem lateral dobrada)", () => {
    const fonte = readFileSync(
      join(__dirname, "..", "..", "app", "app", "contacts", "_client.tsx"),
      "utf8",
    );
    expect(fonte).toContain('<div className="space-y-4 p-6 max-md:p-0">');
  });
});
