import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/auth/enrollMfa", () => ({ enrollMfa: vi.fn() }));
vi.mock("@/app/actions/auth/confirmMfaEnroll", () => ({ confirmMfaEnroll: vi.fn() }));

import { MfaEnrollModal } from "@/components/auth/MfaEnrollModal";

describe("superfícies de autenticação no modo claro", () => {
  it("usa o overlay semântico e uma superfície branca no modal de MFA", () => {
    render(<MfaEnrollModal motivo="escolha" />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("bg-overlay");
    expect(dialog.firstElementChild).toHaveClass("bg-surface", "shadow-xl");
  });
});
