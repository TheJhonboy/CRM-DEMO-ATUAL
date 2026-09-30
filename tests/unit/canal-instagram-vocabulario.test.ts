import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Vocabulário do canal Instagram (DM via Meta Graph, direto) — o que entra no
 * banco ANTES do transporte. Molde: canal-zernio-vocabulario.test.ts.
 * O `pnpm test:db` prova contra Postgres real; aqui é a leitura dos artefatos
 * (migration versionada e baseline aplicado por quem instala).
 */
const MIGRATION = "supabase/migrations/20260930120000_0275_canal_instagram_vocabulario.sql";
const sql = readFileSync(MIGRATION, "utf8");
const baseline = readFileSync("supabase/baseline.sql", "utf8");

const checkBlock = (src: string, nome: string) => {
  const i = src.lastIndexOf(`add constraint ${nome}`);
  expect(i, `não achei add constraint ${nome}`).toBeGreaterThan(-1);
  return src.slice(i, i + 1200);
};

describe("migration 0275", () => {
  it("o CHECK de provider aceita instagram e mantém os providers vigentes", () => {
    const b = checkBlock(sql, "channel_sessions_provider_check");
    for (const p of ["waha", "meta_cloud", "zernio", "wacalls", "instagram"]) {
      expect(b).toContain(`'${p}'::text`);
    }
  });

  it("o CHECK de ref exige instagram_account_id e preserva o ramo wacalls", () => {
    const b = checkBlock(sql, "channel_sessions_provider_ref_check");
    expect(b).toMatch(/provider = 'instagram'\s+and instagram_account_id\s+is not null/);
    expect(b).toMatch(/provider = 'wacalls'\s+and wacalls_session_id\s+is not null/);
    expect(b).toMatch(/provider = 'waha'\s+and waha_session_name\s+is not null/);
    expect(b).toMatch(/provider = 'meta_cloud'\s+and meta_phone_number_id\s+is not null/);
    expect(b).toMatch(/provider = 'zernio'\s+and zernio_account_id\s+is not null/);
  });

  it("cria as colunas novas", () => {
    expect(sql).toContain("add column if not exists instagram_account_id");
    expect(sql).toContain("instagram_token_encrypted bytea");
    expect(sql).toContain("add column if not exists instagram_scoped_id");
    expect(sql).toContain("source_metadata->>'instagram_igsid'");
    expect(sql).toMatch(/create unique index if not exists uniq_contacts_org_instagram_scoped_id[\s\S]*\(organization_id, instagram_scoped_id\)/);
  });

  it("é idempotente e não tem resíduo de instrução", () => {
    expect(sql).toContain("drop constraint if exists channel_sessions_provider_check");
    expect(sql).toContain("drop constraint if exists channel_sessions_provider_ref_check");
    expect(sql).not.toMatch(/AJUSTAR|ramo do wacalls exatamente/);
  });

  it("é aditiva: não apaga nada", () => {
    expect(sql).not.toMatch(/drop table|delete from|truncate/i);
  });

  it("a coluna nasce antes do CHECK que a referencia", () => {
    expect(sql.indexOf("add column if not exists instagram_account_id")).toBeLessThan(
      sql.indexOf("provider = 'instagram'"),
    );
  });
});

describe("baseline espelha a 0275", () => {
  it("CHECKs do baseline conhecem instagram e mantêm wacalls", () => {
    expect(checkBlock(baseline, "channel_sessions_provider_check")).toContain("'instagram'::text");
    const ref = checkBlock(baseline, "channel_sessions_provider_ref_check");
    expect(ref).toMatch(/provider = 'instagram'\s+and instagram_account_id\s+is not null/);
    expect(ref).toContain("wacalls_session_id");
  });

  it("colunas e índice do baseline", () => {
    expect(baseline).toContain("add column if not exists instagram_account_id");
    expect(baseline).toContain("instagram_token_encrypted bytea");
    expect(baseline).toContain("add column if not exists instagram_scoped_id");
    expect(baseline).toContain("uniq_contacts_org_instagram_scoped_id");
  });

  it("a migration está no MANIFEST", () => {
    expect(readFileSync("supabase/migrations/MANIFEST.md", "utf8")).toContain(
      "0275_canal_instagram_vocabulario",
    );
  });
});
