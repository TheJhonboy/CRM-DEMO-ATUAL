import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/LoginForm", () => ({
  LoginForm: () => <form aria-label="Entrar" />,
}));

vi.mock("@/lib/branding", () => ({
  branding: () => ({ name: "Calixto AI CRM" }),
}));

// A tela passou a resolver o idioma do visitante lendo a sessão (ver
// `app/(public)/login/page.tsx`), e por isso chama `createClient()`, que lê
// cookies — algo que só existe dentro de uma requisição real. Fora do login
// quase nunca há sessão, e o mock reflete exatamente isso: nenhum usuário.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
  })),
}));

// `idiomaDoVisitante` cai no `Accept-Language` via `next/headers` quando não
// há locale salvo (visitante sem sessão) — também só existe numa requisição
// real. Sem cabeçalho nenhum, `parseAcceptLanguage` já degrada pro pt-BR.
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

describe("login sem cadastro público", () => {
  it("não oferece criação de conta para visitantes", async () => {
    const { default: LoginPage } = await import("@/app/(public)/login/page");
    const html = renderToStaticMarkup(
      await LoginPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).not.toContain("Criar conta");
    expect(html).not.toContain('href="/signup"');
    expect(html).toContain("Esqueci minha senha");
  });
});
