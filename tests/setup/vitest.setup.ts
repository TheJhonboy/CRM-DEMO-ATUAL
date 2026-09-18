import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Remove um par de aspas (simples ou duplas) que envolva o valor inteiro —
 * mesma convenção que `hostgator-setup-kit/install.sh` grava no `.env` de
 * TODA instalação self-host (`NEXT_PUBLIC_APP_URL="https://${DOMAIN}"`).
 * Sem isto, um self-hoster que rode `pnpm test:unit` na própria VPS antes de
 * atualizar vê a suíte inteira falhar com "Variáveis de ambiente inválidas"
 * (a URL vira `"https://…"` — aspas incluídas — e falha a validação Zod de
 * `lib/env.ts`), mesmo com o `.env` real e correto. `.env.example` (o
 * convívio local, sem instalador) não usa aspas — por isso o bug nunca
 * apareceu em desenvolvimento, só em VPS instalada pelo kit.
 */
function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

// Load .env and .env.local before importing any app code that validates env vars
for (const envFile of [".env", ".env.local"]) {
  try {
    const path = resolve(process.cwd(), envFile);
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (key && !process.env[key]) {
        process.env[key] = stripQuotes(rest.join("=").trim());
      }
    }
  } catch {
    // File doesn't exist, skip
  }
}

/**
 * Placeholders para as vars que `lib/env.ts` exige na IMPORTAÇÃO.
 *
 * Sem isto, qualquer arquivo de teste que importe (mesmo transitivamente) um
 * módulo que toque `@/lib/env` **não carrega** onde não há `.env` — e o CI é
 * exatamente esse lugar. O sintoma é cruel: some o arquivo inteiro em vez de
 * falhar um teste, então a contagem cai e ninguém vê que a cobertura evaporou.
 * Foi o que aconteceu no PR #58: 4 arquivos com 0 testes rodados, e o número
 * verde de 1322 escondendo que 3 deles eram novos.
 *
 * É o mesmo remédio que `lib/env.ts:155` já aplica na fase de build da imagem
 * ("semeia placeholders pras vars que faltam e revalida"), aqui restrito ao
 * setup de teste — a lógica de produção não é tocada.
 *
 * `??=` de propósito: valor real de `.env`/`.env.local` SEMPRE vence, então
 * localmente nada muda. E o host `.invalid` é reservado por RFC 2606: se algum
 * teste tentar usar isto como URL de verdade, a chamada falha alto em vez de
 * bater em algum lugar existente.
 */
const PLACEHOLDERS: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://test-placeholder.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-placeholder-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-placeholder-service-role-key",
};
for (const [chave, valor] of Object.entries(PLACEHOLDERS)) {
  process.env[chave] ??= valor;
}

import "@testing-library/jest-dom/vitest";

// jsdom substitui `File` global pelo seu próprio, e o parser de multipart do
// `undici` (usado por `NextRequest.formData()`) faz um webidl-brand-check que
// só reconhece a classe `File` NATIVA do Node — o `File` do jsdom reprova a
// checagem, com um erro que não nomeia a causa.
//
// `Blob`/`FormData`/`Headers` NÃO entram nesta troca, de propósito: código de
// produção que monta `new FormData() + new Blob(...)` para uma chamada de
// SAÍDA (ex.: `lib/messaging/media/transcription.ts`) usa os dois globais do
// jsdom juntos, e são compatíveis ENTRE SI — só `File` isolado do jsdom é que
// reprova o brand-check de quem lê uma requisição de ENTRADA. E o `FormData`
// global precisa continuar sendo o do jsdom por outro motivo: é ele quem o
// próprio jsdom usa por baixo do capô ao despachar o evento `submit` de um
// `<form>` de verdade — o `FormData` do `undici` não sabe ler um elemento DOM
// e derruba esse fluxo com "Argument 1 could not be converted to: undefined".
// Testes que MONTAM a FormData à mão para bater com o brand-check do `undici`
// (rota que faz `instanceof File`/`instanceof FormData` sobre uma requisição
// de entrada) importam `FormData` do pacote `undici` localmente, só naquele
// arquivo — não aqui.
import { File } from "node:buffer";
globalThis.File = File as unknown as typeof globalThis.File;

// jsdom não implementa ResizeObserver; Radix (ex.: Switch) usa em layout effects.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
