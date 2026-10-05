import { Card } from "@/components/ui/card";

// Sem Supabase, sem sessão, sem dicionário: a página de manutenção precisa
// renderizar mesmo com o banco fora do ar. Texto fixo em pt-BR.
export const dynamic = "force-static";

export default function ManutencaoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md p-8 text-center">
        <h1 className="text-2xl font-semibold">Estamos em manutenção</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Atualização sendo feita. Voltamos a partir daqui 1 hora.
        </p>
      </Card>
    </main>
  );
}
