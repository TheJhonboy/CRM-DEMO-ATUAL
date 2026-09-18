import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Sidebar } from "@/components/shell/Sidebar";
import { CLASSES_DE_COR, LogotipoDoProduto, SimboloDoProduto } from "@/components/branding/MarcaDoProduto";
import type { ActiveOrg, AuthUser } from "@/lib/auth/types";
import { DEFAULT_APP_NAME, marcaEhADoProduto, type Branding } from "@/lib/branding";
import { MarcaDaInstalacaoProvider } from "@/lib/branding/contexto";
import { CORES_DA_MARCA } from "@/lib/branding/desenho";

/**
 * A marca do PRODUTO aparece — e SÓ aparece — quando ninguém pôs a sua.
 *
 * O desenho vive em `lib/branding/desenho.ts` e a decisão em `marcaEhADoProduto`.
 * Este arquivo mede as duas metades: a regra pura, e a regra ALCANÇANDO a
 * barra lateral (conferir que a Sidebar importa o componente não bastaria — é
 * evidência de símbolo, não de comportamento).
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/app/inbox" }));
vi.mock("@/app/actions/shell/toggleSidebar", () => ({ toggleSidebar: vi.fn() }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("@/components/connections/ConnectionHealthDot", () => ({
  ConnectionHealthDot: () => null,
}));
vi.mock("@/components/shell/VersionFooter", () => ({ VersionFooter: () => null }));

const usuario = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@exemplo.test",
  is_platform_admin: false,
  organizations: [],
} as unknown as AuthUser;
const org = {
  orgId: "00000000-0000-4000-8000-0000000000aa",
  name: "Loja da Ana",
  role: "admin",
} as ActiveOrg;
let contexto: { user: AuthUser; activeOrg: ActiveOrg | null } = { user: usuario, activeOrg: org };
vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => contexto }));

const PADRAO: Branding = { name: DEFAULT_APP_NAME, logoUrl: null, initial: "C" };

function renderSidebar(marca: Branding, collapsed: boolean) {
  return render(
    <MarcaDaInstalacaoProvider marca={marca}>
      <Sidebar collapsed={collapsed} />
    </MarcaDaInstalacaoProvider>,
  );
}

afterEach(() => {
  cleanup();
  contexto = { user: usuario, activeOrg: org };
});

describe("marcaEhADoProduto", () => {
  it("é verdade só sem logo E com o nome padrão", () => {
    expect(marcaEhADoProduto(PADRAO)).toBe(true);
  });

  it("quem trocou o nome NÃO recebe um logotipo que soletra outro nome", () => {
    expect(marcaEhADoProduto({ name: "Acme CRM", logoUrl: null })).toBe(false);
  });

  it("quem subiu logo já tem o dele", () => {
    expect(marcaEhADoProduto({ name: DEFAULT_APP_NAME, logoUrl: "https://cdn.x/logo.png" })).toBe(
      false,
    );
  });
});

describe("o desenho na barra lateral", () => {
  // Este fork não usa o logotipo SVG do produto original (soletra "DeskcommCRM"
  // em geometria fixa — ver `lib/branding/desenho.ts` — e não acompanha o nome
  // via prop). Sem marca própria, a barra cai no mascote Calixto
  // (`/calixto-assistant.png`), igual em qualquer instalação deste fork.
  it("aberta e sem marca própria, mostra o mascote Calixto e o nome em texto", () => {
    renderSidebar(PADRAO, false);
    const mascote = screen.getByRole("img", { name: "Assistente virtual" });
    expect(mascote.tagName.toLowerCase()).toBe("img");
    expect((mascote as HTMLImageElement).src).toContain("/calixto-assistant.png");
    expect(screen.getByText(DEFAULT_APP_NAME)).toBeTruthy();
    expect(document.querySelector("svg[role=img]")).toBeNull();
  });

  it("recolhida, mostra só o mascote — sem nome nem inicial em texto", () => {
    renderSidebar(PADRAO, true);
    const mascote = screen.getByRole("img", { name: "Assistente virtual" });
    expect(mascote.tagName.toLowerCase()).toBe("img");
    expect(screen.queryByText(DEFAULT_APP_NAME)).toBeNull();
    expect(screen.queryByText("C")).toBeNull();
    expect(document.querySelector("svg[role=img]")).toBeNull();
  });

  it("com nome da instalação, segue em texto — o desenho do produto não vaza", () => {
    renderSidebar({ name: "Sistema do Revendedor", logoUrl: null, initial: "S" }, false);
    expect(screen.getByText("Sistema do Revendedor")).toBeTruthy();
    expect(document.querySelector("svg[role=img]")).toBeNull();
  });

  it("com nome da ORGANIZAÇÃO sobre a instalação padrão, o nome dela vence o desenho", () => {
    contexto = { user: usuario, activeOrg: { ...org, marca: { nome: "Loja da Ana" } } };
    renderSidebar(PADRAO, false);
    expect(screen.getByText("Loja da Ana")).toBeTruthy();
    expect(document.querySelector("svg[role=img]")).toBeNull();
  });

  it("com logo da instalação, a imagem vence o desenho", () => {
    renderSidebar({ ...PADRAO, logoUrl: "https://cdn.exemplo.test/logo.png" }, false);
    expect(screen.getByRole("img").tagName.toLowerCase()).toBe("img");
  });
});

describe("as cores do desenho", () => {
  it("as classes do componente cobrem exatamente a paleta declarada, nos dois temas", () => {
    // O Tailwind só gera utilitário para hex LITERAL no fonte, então o
    // componente repete os valores. Isto é o que impede os dois de divergirem.
    const nasClasses = Object.values(CLASSES_DE_COR).join(" ").match(/#[0-9a-f]{6}/g) ?? [];
    const naPaleta = [...Object.values(CORES_DA_MARCA.claro), ...Object.values(CORES_DA_MARCA.escuro)];
    expect([...nasClasses].sort()).toEqual([...naPaleta].sort());
  });

  it("cada tema tem a sua classe: `dark:` no escuro, nada no claro", () => {
    for (const [papel, classes] of Object.entries(CLASSES_DE_COR)) {
      const chave = papel as keyof typeof CORES_DA_MARCA.claro;
      expect(classes).toContain(`fill-[${CORES_DA_MARCA.claro[chave]}]`);
      expect(classes).toContain(`dark:fill-[${CORES_DA_MARCA.escuro[chave]}]`);
    }
  });

  it("decorativo esconde do leitor de tela; sem isso, nomeia a marca", () => {
    render(<SimboloDoProduto nome="Marca X" decorativo />);
    expect(document.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    cleanup();
    render(<LogotipoDoProduto nome="Marca X" />);
    expect(screen.getByRole("img", { name: "Marca X" })).toBeTruthy();
  });
});

describe("o favicon", () => {
  const icone = fs.readFileSync(path.join(process.cwd(), "app/icon.tsx"), "utf8");

  // Este fork não desenha o símbolo do produto original no favicon (mesmo
  // motivo da barra lateral: soletra "D", de DeskcommCRM, e um "D" na aba de
  // "Calixto AI CRM" seria a marca errada). Sempre cor + inicial, mesmo na
  // marca padrão — ver `app/icon.tsx`.
  it("sempre desenha cor + inicial, mesmo quando a marca é a padrão do produto", () => {
    expect(icone).not.toMatch(/marcaEhADoProduto/);
    expect(icone).not.toMatch(/SIMBOLO/);
    expect(icone).toMatch(/letraDoIcone\(marca\.nome\)/);
  });
});
