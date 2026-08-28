/**
 * Quem é levado ao wizard de onboarding, e quem pode abri-lo.
 *
 * O wizard de 6 passos decide o que vale para a organização INTEIRA: o nicho
 * que treina o agente, o fuso que define a janela em que ele pode falar com
 * cliente, o funil em que todo mundo trabalha. Isso é decisão de quem instala
 * e entrega o sistema — não do vendedor que abriu a Inbox para responder um
 * lead.
 *
 * Até aqui o gate era uma linha em `app/app/layout.tsx`:
 *
 *     if (orgRow && !orgRow.onboarded_at) redirect("/onboarding");
 *
 * — incondicional. Toda organização sem `onboarded_at` mandava QUALQUER pessoa
 * para o wizard, e num produto entregue já configurado essa era a primeira
 * tela do cliente: perguntando "o que vocês fazem?" a quem não tem essa
 * resposta e não devia ter esse poder.
 *
 * A regra vive aqui, e não nos layouts, porque são DUAS portas — o desvio de
 * quem chega pelo `/app/*` e a URL digitada direto em `/onboarding` — e regra
 * duplicada em dois arquivos diverge no primeiro conserto. Layout é lugar de
 * desenhar; a decisão é testável e mora fora dele.
 */

/** O que a decisão precisa saber. Nada além disso entra. */
export type QuemChegou = {
  /** `organizations.onboarded_at` — nulo enquanto o wizard não foi concluído. */
  onboardedAt: string | null;
  /** `platform_admins` — quem instalou esta instalação. */
  isPlatformAdmin: boolean;
};

/**
 * O `/app/*` deve desviar esta pessoa para o wizard?
 *
 * Só quem instala é interrompido. Para todo o resto o app abre direto, com o
 * funil que o `bootstrap-owner.ts` já criou — organização sem `onboarded_at`
 * não é organização quebrada, é organização que ainda não passou pelo wizard.
 */
export function deveIrParaOWizard(quem: QuemChegou): boolean {
  if (quem.onboardedAt) return false;
  return quem.isPlatformAdmin;
}

/**
 * Esta pessoa pode abrir `/onboarding` digitando a URL?
 *
 * Separada de `deveIrParaOWizard` de propósito: são perguntas diferentes, e
 * confundi-las é o que deixaria a tela alcançável por quem o desvio não leva.
 * Quem já concluiu o wizard também não volta — para isso existe Configurações.
 */
export function podeAbrirOWizard(quem: QuemChegou): boolean {
  if (quem.onboardedAt) return false;
  return quem.isPlatformAdmin;
}
