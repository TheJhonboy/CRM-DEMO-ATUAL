/**
 * Endereço público do webhook de um canal — o que o operador cola do outro lado.
 *
 * Mesma regra do canal por credencial existente: `env.*` e NÃO
 * `process.env.NEXT_PUBLIC_APP_URL` direto. Variáveis `NEXT_PUBLIC_` são
 * substituídas no BUILD, e a imagem genérica do self-host é construída com
 * `https://placeholder.invalid` (Dockerfile) — lida direto, a tela mostraria essa
 * URL e o webhook colado apontaria para o nada, sem erro em lugar nenhum.
 * `env.*` parseia em runtime. O host da requisição é o fallback: numa instalação
 * que esqueceu a variável, é a melhor pista que existe.
 */
import type { NextRequest } from "next/server";

import { env } from "@/lib/env";

export function urlDoWebhookDoCanal(req: NextRequest, token: string): string {
  const configurada = env.NEXT_PUBLIC_APP_URL;
  const usavel = configurada && !configurada.includes("placeholder.invalid") ? configurada : null;
  const base = (
    usavel ??
    req.headers.get("origin") ??
    `${req.nextUrl.protocol}//${req.nextUrl.host}`
  ).replace(/\/+$/, "");
  return `${base}/api/v1/webhooks/channel/${token}`;
}
