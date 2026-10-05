import { Card } from "@/components/ui/card";
import { traduzir } from "@/lib/i18n/dicionario";

// Sem Supabase, sem sessão, sem dicionário: a página de manutenção precisa
// renderizar mesmo com o banco fora do ar. `traduzir` é função pura sobre o
// dicionário em memória (nada de banco); sem sessão, o idioma é o do produto: pt-BR.
export const dynamic = "force-static";

export default function ManutencaoPage() {
  const t = (texto: string) => traduzir(texto, "pt-BR");
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md p-8 text-center">
        <h1 className="text-2xl font-semibold">{t("Estamos em manutenção")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("Atualização sendo feita. Voltamos a partir daqui 1 hora.")}
        </p>
      </Card>
    </main>
  );
}
