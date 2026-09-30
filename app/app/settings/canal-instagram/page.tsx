import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { CanalInstagramForm } from "./_form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Conectar o Instagram" };

/**
 * Conectar o Instagram — mesma porta e mesma guarda de Conexões: só quem pode
 * configurar canal. A API repete a checagem (`requireRole("admin")`); esta aqui
 * só evita mostrar a um atendente uma tela cujos botões responderiam 403.
 */
export default async function CanalInstagramPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const idioma = user.idioma;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <Link
          href="/app/connections"
          className="inline-flex min-h-11 items-center text-sm text-accent underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500"
        >
          {traduzir("← Voltar para Conexões", idioma)}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {traduzir("Conectar o Instagram", idioma)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Conecte a conta profissional do Instagram da empresa para receber e responder mensagens diretas aqui.",
            idioma,
          )}
        </p>
      </header>
      <CanalInstagramForm />
    </div>
  );
}
