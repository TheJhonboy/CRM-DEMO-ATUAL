/**
 * Rodada diária de renovação dos tokens do Instagram (chamada por
 * `app/api/v1/cron/instagram-token`).
 *
 * Candidatas: sessão do Instagram ativa, com token, não vencida, cuja validade cai
 * nos próximos 10 dias — ou sem validade conhecida e criada há mais de 50 dias (o
 * token colado já longo, de idade ignorada, que a conexão não conseguiu medir).
 * Token já vencido não entra: não dá mais para renovar (o operador gera outro; a
 * tela avisa).
 *
 * A organização vem da LINHA, nunca de entrada externa. Percorre por id (keyset, não
 * offset: renovar tira a linha do filtro e o offset pularia vizinhas), em páginas, e
 * pára de iniciar sessão ao passar de ORCAMENTO - MARGEM, como a rodada do administrador.
 *
 * Falha com 7 dias ou menos (ou token já morto) abre um aviso na Central:
 * `agent_inbox_items`, `kind='other'`, `ref_kind='instagram_token'`, `ref_id` = sessão,
 * dedupe contra item ABERTO — o mesmo molde de `escalarJanelaFechadaSemModelo`
 * (before-send), só que via supabase-js em vez de SQL cru (select + insert: uma
 * rodada simultânea poderia duplicar, risco aceito, a rota roda uma vez por dia).
 * Renovar com sucesso resolve o aviso aberto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ARCHIVED_AT } from "../archived";
import { logger } from "@/lib/logger";
import { DIAS_PARA_AVISAR, renovarTokenDaSessao } from "./token";

export const REF_KIND_TOKEN = "instagram_token";
export const TAMANHO_DA_PAGINA = 200;
export const ORCAMENTO_MS = 90_000;
const MARGEM_MS = 10_000;
const DIA_MS = 86_400_000;
/** Falhou e restam tantos dias ou menos: o operador precisa saber. */
const DIAS_PARA_AVISO_DE_FALHA = 7;
/** Idade a partir da qual um token de validade desconhecida passa a ser tentado. */
const DIAS_SEM_VALIDADE = 50;

export interface ResumoDaRenovacao {
  candidatas: number;
  renovadas: number;
  falhas: number;
  avisos: number;
  interrompidoPorTempo: boolean;
}

interface Candidata {
  id: string;
  organization_id: string;
  instagram_token_expires_at: string | null;
}

export async function renovarTokensDoInstagram(
  admin: SupabaseClient,
  opcoes: { agora?: number; tamanhoDaPagina?: number; relogio?: () => number } = {},
): Promise<ResumoDaRenovacao> {
  const relogio = opcoes.relogio ?? Date.now;
  const inicio = opcoes.agora ?? relogio();
  const pagina = opcoes.tamanhoDaPagina ?? TAMANHO_DA_PAGINA;
  const iso = (ms: number) => new Date(ms).toISOString();
  const esgotado = () => relogio() - inicio >= ORCAMENTO_MS - MARGEM_MS;

  const filtroDeValidade =
    `and(instagram_token_expires_at.gt.${iso(inicio)},instagram_token_expires_at.lte.${iso(inicio + DIAS_PARA_AVISAR * DIA_MS)}),` +
    `and(instagram_token_expires_at.is.null,created_at.lt.${iso(inicio - DIAS_SEM_VALIDADE * DIA_MS)})`;

  const resumo: ResumoDaRenovacao = { candidatas: 0, renovadas: 0, falhas: 0, avisos: 0, interrompidoPorTempo: false };
  let ultimoId = "";

  rodada: for (;;) {
    if (esgotado()) {
      resumo.interrompidoPorTempo = true;
      break;
    }
    let consulta = admin
      .from("channel_sessions")
      .select("id, organization_id, instagram_token_expires_at")
      .eq("provider", "instagram")
      .is(ARCHIVED_AT, null)
      .not("instagram_token_encrypted", "is", null)
      .or(filtroDeValidade);
    if (ultimoId) consulta = consulta.gt("id", ultimoId);
    const { data, error } = await consulta.order("id", { ascending: true }).limit(pagina);
    if (error) throw new Error("instagram_token_cron_lookup_failed");
    const linhas = (data ?? []) as unknown as Candidata[];
    if (linhas.length === 0) break;

    for (const s of linhas) {
      ultimoId = s.id;
      if (esgotado()) {
        resumo.interrompidoPorTempo = true;
        break rodada;
      }
      resumo.candidatas++;
      try {
        const r = await renovarTokenDaSessao(admin, { organizationId: s.organization_id, sessionId: s.id });
        if (r.ok) {
          resumo.renovadas++;
          await resolverAviso(admin, s);
          continue;
        }
        resumo.falhas++;
        const restantes = s.instagram_token_expires_at
          ? (Date.parse(s.instagram_token_expires_at) - inicio) / DIA_MS
          : null;
        const morto = r.motivo === "token_expirado";
        if (morto || (restantes !== null && restantes <= DIAS_PARA_AVISO_DE_FALHA)) {
          if (await abrirAviso(admin, s, morto, restantes)) resumo.avisos++;
        }
      } catch (err) {
        resumo.falhas++;
        // Uma sessão com problema não pode parar as outras. A mensagem pode vir de
        // fora: loga só o nome do erro.
        logger.error("[instagram-token] renovação falhou", {
          organizationId: s.organization_id,
          sessionId: s.id,
          error: err instanceof Error ? err.name : "unknown",
        });
      }
    }
    if (linhas.length < pagina) break;
  }
  return resumo;
}

async function abrirAviso(
  admin: SupabaseClient,
  s: Candidata,
  morto: boolean,
  restantes: number | null,
): Promise<boolean> {
  try {
    const { data } = await admin
      .from("agent_inbox_items")
      .select("id")
      .eq("organization_id", s.organization_id)
      .eq("ref_kind", REF_KIND_TOKEN)
      .eq("ref_id", s.id)
      .eq("status", "open")
      .limit(1);
    if ((data ?? []).length > 0) return false;

    const dias = restantes === null ? null : Math.max(0, Math.ceil(restantes));
    const { error } = await admin.from("agent_inbox_items").insert({
      organization_id: s.organization_id,
      kind: "other",
      // 'warn'/'critical', não 'warning': o CHECK só aceita info/warn/critical.
      severity: morto ? "critical" : "warn",
      title: morto
        ? "Token do Instagram expirou — o canal vai parar"
        : "Token do Instagram perto de vencer — a renovação automática falhou",
      body: morto
        ? "O token do Instagram expirou e a Meta não permite mais renová-lo. Gere um token NOVO no painel do app da Meta e cole em Configurações › Conexões › Instagram › Reconectar."
        : `A renovação automática do token do Instagram falhou${dias === null ? "" : ` e restam ${dias} dia(s)`}. Abra Configurações › Conexões › Instagram e use "Renovar token agora"; se não funcionar, gere um token novo na Meta e use "Reconectar".`,
      ref_kind: REF_KIND_TOKEN,
      ref_id: s.id,
    });
    return !error;
  } catch {
    return false;
  }
}

async function resolverAviso(admin: SupabaseClient, s: Candidata): Promise<void> {
  try {
    await admin
      .from("agent_inbox_items")
      .update({ status: "resolved" })
      .eq("organization_id", s.organization_id)
      .eq("ref_kind", REF_KIND_TOKEN)
      .eq("ref_id", s.id)
      .eq("status", "open");
  } catch {
    // best-effort
  }
}
