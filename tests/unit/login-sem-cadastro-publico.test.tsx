import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/LoginForm", () => ({
  LoginForm: () => <form aria-label="Entrar" />,
}));

vi.mock("@/lib/branding", () => ({
  branding: () => ({ name: "Calixto AI CRM" }),
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
