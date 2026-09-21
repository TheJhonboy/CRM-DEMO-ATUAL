// @vitest-environment node
import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { INVITE_TTL_SECONDS, signInviteToken, verifyInviteToken } from "@/lib/auth/invite-token";

/**
 * SEGREDO DE ASSINATURA DO CONVITE — SEM FALLBACK PÚBLICO (auditoria 21/09/2026, achado 4).
 *
 * ═══ O defeito que isto fecha ═══
 *
 * `lib/auth/invite-token.ts` resolvia o segredo como
 * `INVITE_TOKEN_SECRET ?? INTERNAL_SECRET ?? "dev-fallback"`. O literal está no
 * repositório público: quem chegasse àquele ramo aceitava como VÁLIDO um token
 * de convite forjado por qualquer pessoa — o payload carrega `organization_id` e
 * `role`, ou seja, admin em qualquer organização.
 *
 * Em produção o app nem sobe sem `INTERNAL_SECRET` (`lib/env.ts` a exige), mas o
 * módulo lê `process.env` CRU: não herda garantia nenhuma do Zod, e em dev/teste
 * a variável vira `""` — e `""` também passava pelo `??`.
 *
 * ═══ O comportamento agora, fixado aqui ═══
 *
 * - `INVITE_TOKEN_SECRET` vence `INTERNAL_SECRET` (precedência inalterada).
 * - Vazio ou só espaços conta como AUSENTE, e cai para o próximo da cadeia. O
 *   `.env.example` entrega `INTERNAL_SECRET=` vazio; `??` deixaria `""` passar e
 *   assinaria com chave de comprimento zero, o que é o mesmo defeito por outra porta.
 * - Nada na cadeia → LANÇA um Error claro (nomes das variáveis, nunca valores).
 *   Assinar E verificar lançam: erro de configuração precisa aparecer como erro,
 *   não como "convite inválido" — este último manda o operador procurar o
 *   convidado quando o defeito é do servidor.
 */

const payload = () => ({
  invite_id: "11111111-1111-4111-8111-111111111111",
  email: "alice@example.com",
  organization_id: "22222222-2222-4222-8222-222222222222",
  role: "agent",
  exp: Math.floor(Date.now() / 1000) + INVITE_TTL_SECONDS,
});

function semNenhumSegredo() {
  vi.stubEnv("INVITE_TOKEN_SECRET", undefined);
  vi.stubEnv("INTERNAL_SECRET", undefined);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("segredo de assinatura do convite", () => {
  it("sem nenhum segredo configurado, ASSINAR lança em vez de usar um valor público", () => {
    semNenhumSegredo();
    expect(() => signInviteToken(payload())).toThrow(/INVITE_TOKEN_SECRET/);
  });

  it("sem nenhum segredo configurado, VERIFICAR também lança (erro de config não vira 'convite inválido')", () => {
    vi.stubEnv("INVITE_TOKEN_SECRET", "segredo-so-para-assinar-o-token");
    const token = signInviteToken(payload());
    semNenhumSegredo();
    expect(() => verifyInviteToken(token)).toThrow(/INTERNAL_SECRET/);
  });

  it("a mensagem do erro nomeia as duas variáveis e não carrega o literal antigo nem valor de segredo", () => {
    vi.stubEnv("INVITE_TOKEN_SECRET", undefined);
    vi.stubEnv("INTERNAL_SECRET", "   ");
    let mensagem = "";
    try {
      signInviteToken(payload());
    } catch (e) {
      mensagem = e instanceof Error ? e.message : String(e);
    }
    expect(mensagem, "não lançou").not.toBe("");
    expect(mensagem).toContain("INVITE_TOKEN_SECRET");
    expect(mensagem).toContain("INTERNAL_SECRET");
    expect(mensagem).not.toContain("dev-fallback");
  });

  it("token forjado com o literal público 'dev-fallback' NÃO é aceito nem com segredo real nem sem segredo", () => {
    const corpo = Buffer.from(JSON.stringify(payload()), "utf8").toString("base64url");
    const assinatura = createHmac("sha256", "dev-fallback").update(corpo).digest("base64url");
    const forjado = `${corpo}.${assinatura}`;

    vi.stubEnv("INTERNAL_SECRET", "segredo-real-de-teste-diferente-do-literal");
    expect(verifyInviteToken(forjado), "aceitou token forjado com o literal público").toBeNull();

    semNenhumSegredo();
    expect(() => verifyInviteToken(forjado), "sem segredo deveria lançar, nunca aceitar").toThrow();
  });

  it("só INVITE_TOKEN_SECRET definido: assina e verifica", () => {
    vi.stubEnv("INVITE_TOKEN_SECRET", "segredo-dedicado-de-convite");
    vi.stubEnv("INTERNAL_SECRET", undefined);
    const p = payload();
    expect(verifyInviteToken(signInviteToken(p))).toEqual(p);
  });

  it("só INTERNAL_SECRET definido: assina e verifica", () => {
    vi.stubEnv("INVITE_TOKEN_SECRET", undefined);
    vi.stubEnv("INTERNAL_SECRET", "segredo-interno-compartilhado");
    const p = payload();
    expect(verifyInviteToken(signInviteToken(p))).toEqual(p);
  });

  it("precedência inalterada: INVITE_TOKEN_SECRET vence INTERNAL_SECRET quando os dois existem", () => {
    vi.stubEnv("INVITE_TOKEN_SECRET", "segredo-dedicado-de-convite");
    vi.stubEnv("INTERNAL_SECRET", "segredo-interno-compartilhado");
    const p = payload();
    const token = signInviteToken(p);

    // Só o dedicado: o token continua válido — foi ELE que assinou.
    vi.stubEnv("INTERNAL_SECRET", undefined);
    expect(verifyInviteToken(token), "o token deveria ter sido assinado com INVITE_TOKEN_SECRET").toEqual(p);

    // Só o interno: o mesmo token NÃO valida — não foi ele que assinou.
    vi.stubEnv("INVITE_TOKEN_SECRET", undefined);
    vi.stubEnv("INTERNAL_SECRET", "segredo-interno-compartilhado");
    expect(verifyInviteToken(token), "o token foi assinado com INTERNAL_SECRET, a precedência inverteu").toBeNull();
  });

  it("INVITE_TOKEN_SECRET vazio ou só espaços conta como ausente e cai para INTERNAL_SECRET", () => {
    vi.stubEnv("INTERNAL_SECRET", "segredo-interno-compartilhado");
    const p = payload();

    vi.stubEnv("INVITE_TOKEN_SECRET", undefined);
    const assinadoSoComInterno = signInviteToken(p);

    for (const vazio of ["", "   ", "\t\n"]) {
      vi.stubEnv("INVITE_TOKEN_SECRET", vazio);
      expect(
        verifyInviteToken(assinadoSoComInterno),
        `INVITE_TOKEN_SECRET=${JSON.stringify(vazio)} deveria cair no INTERNAL_SECRET`,
      ).toEqual(p);
    }
  });

  it("os dois vazios (o que o `.env.example` entrega) lançam: `??` deixaria '' assinar com chave de comprimento zero", () => {
    for (const vazio of ["", "   "]) {
      vi.stubEnv("INVITE_TOKEN_SECRET", vazio);
      vi.stubEnv("INTERNAL_SECRET", vazio);
      expect(() => signInviteToken(payload()), `assinou com ${JSON.stringify(vazio)}`).toThrow(/INVITE_TOKEN_SECRET/);
    }
  });

  it("segredo com espaços em volta continua valendo como está (não muda a chave de quem já tem convite assinado)", () => {
    vi.stubEnv("INVITE_TOKEN_SECRET", undefined);
    vi.stubEnv("INTERNAL_SECRET", "  segredo com espaço nas pontas  ");
    const p = payload();
    const token = signInviteToken(p);
    const corpo = token.split(".")[0]!;
    const esperada = createHmac("sha256", "  segredo com espaço nas pontas  ").update(corpo).digest("base64url");
    expect(token.split(".")[1]).toBe(esperada);
  });
});
