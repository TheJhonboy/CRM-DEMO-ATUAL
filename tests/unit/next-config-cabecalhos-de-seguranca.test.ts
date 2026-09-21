// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * CABEÇALHOS DE SEGURANÇA DO `next.config.ts` (auditoria de 21/09/2026, achados 1 e 3).
 *
 * ═══ O que o app passa a mandar em toda resposta ═══
 *
 * 1. `Content-Security-Policy: base-uri 'self'; object-src 'none'; frame-ancestors 'none'`
 *    — ENFORCED, e de propósito SEM `script-src`/`style-src`/`default-src`. O
 *    script inline de inicialização do tema, o script do `window.__PUBLIC_ENV__`
 *    e o `<style>` da marca dependem de um nonce por requisição; esse refactor
 *    não existe ainda, e um `default-src 'self'` quebraria a tela inteira. Este
 *    subconjunto é seguro: fecha injeção de `<base>`, plugin (`<object>`/
 *    `<embed>`) e clickjacking sem tocar em nenhum script.
 *
 * 2. `Strict-Transport-Security` — SÓ quando `NEXT_PUBLIC_APP_URL` é `https://`.
 *    Self-host por HTTP em porta alta não pode receber o cabeçalho (mesma razão
 *    de `lib/supabase/cookie-secure.ts`: o protocolo da URL pública decide, não
 *    o NODE_ENV). Sem `preload`: entrar na lista de preload do navegador é
 *    irreversível na prática e não é decisão que o código possa tomar sozinho.
 *
 * ═══ Por que o env é lido DENTRO de `headers()` ═══
 *
 * O teste alterna `NEXT_PUBLIC_APP_URL` entre as chamadas. Se a leitura fosse no
 * topo do módulo, a primeira avaliação congelaria o valor e os ramos http/https
 * nunca seriam exercitados.
 */

type Cabecalho = { key: string; value: string };
type Regra = { source: string; headers: Cabecalho[] };

async function cabecalhosGlobais(): Promise<Map<string, string>> {
  const { default: config } = await import("@/next.config");
  const regras = (await config.headers!()) as Regra[];
  const global = regras.find((r) => r.source === "/(.*)");
  expect(global, "a regra `source: \"/(.*)\"` sumiu do headers() do next.config.ts").toBeDefined();
  return new Map(global!.headers.map((h) => [h.key, h.value]));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config.ts — cabeçalhos de segurança", () => {
  it("mantém os quatro cabeçalhos que já existiam, com ou sem https", async () => {
    for (const url of ["https://crm.exemplo.com.br", "http://192.0.2.10:3000", undefined]) {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", url);
      const h = await cabecalhosGlobais();
      expect(h.get("X-Frame-Options"), `X-Frame-Options com url=${String(url)}`).toBe("DENY");
      expect(h.get("X-Content-Type-Options"), `nosniff com url=${String(url)}`).toBe("nosniff");
      expect(h.get("Referrer-Policy"), `Referrer-Policy com url=${String(url)}`).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(h.get("Permissions-Policy"), `Permissions-Policy com url=${String(url)}`).toContain(
        "microphone=(self)",
      );
    }
  });

  it("manda CSP ENFORCED (não Report-Only) com base-uri, object-src e frame-ancestors", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://crm.exemplo.com.br");
    const h = await cabecalhosGlobais();
    expect(h.has("Content-Security-Policy-Report-Only")).toBe(false);
    const csp = h.get("Content-Security-Policy");
    expect(csp, "Content-Security-Policy ausente").toBeDefined();
    const diretivas = csp!.split(";").map((d) => d.trim());
    expect(diretivas).toContain("base-uri 'self'");
    expect(diretivas).toContain("object-src 'none'");
    expect(diretivas).toContain("frame-ancestors 'none'");
  });

  it("a CSP vale também sem https (não depende do protocolo)", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://192.0.2.10:3000");
    const h = await cabecalhosGlobais();
    expect(h.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("a CSP NÃO tem script-src/style-src/default-src: o script inline do tema e o <style> da marca precisam de nonce antes", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://crm.exemplo.com.br");
    const csp = (await cabecalhosGlobais()).get("Content-Security-Policy") ?? "";
    for (const proibida of ["script-src", "style-src", "default-src"]) {
      expect(
        csp,
        `${proibida} na CSP quebraria o script inline de tema / o <style> da marca (sem nonce) e deixaria a tela em branco`,
      ).not.toContain(proibida);
    }
  });

  it("manda HSTS de 2 anos com includeSubDomains e SEM preload quando a URL pública é https", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://crm.exemplo.com.br");
    const hsts = (await cabecalhosGlobais()).get("Strict-Transport-Security");
    expect(hsts).toBe("max-age=63072000; includeSubDomains");
    expect(hsts).not.toContain("preload");
  });

  it("NÃO manda HSTS quando a URL pública é http (self-host em porta alta)", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://192.0.2.10:3000");
    expect((await cabecalhosGlobais()).has("Strict-Transport-Security")).toBe(false);
  });

  it("NÃO manda HSTS quando a URL pública não está definida ou está vazia", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    expect((await cabecalhosGlobais()).has("Strict-Transport-Security"), "env ausente").toBe(false);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect((await cabecalhosGlobais()).has("Strict-Transport-Security"), "env vazia").toBe(false);
  });

  it("o mesmo módulo reavalia o env a cada headers() (a leitura não está congelada no import)", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://crm.exemplo.com.br");
    expect((await cabecalhosGlobais()).has("Strict-Transport-Security")).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://192.0.2.10:3000");
    expect((await cabecalhosGlobais()).has("Strict-Transport-Security")).toBe(false);
  });
});
