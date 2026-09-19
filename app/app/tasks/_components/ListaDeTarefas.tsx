"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import {
  agrupaPorPrazo,
  estaAtrasada,
  estaEncerrada,
  type FaixaDePrazo,
  type PrioridadeDaTarefa,
  type Tarefa,
} from "@/lib/tarefas/tipos";
import { Check, PencilSimple, Trash } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface Props {
  tarefas: Tarefa[];
  podeEditar: boolean;
  aoAlternarConcluida: (tarefa: Tarefa) => Promise<unknown>;
  aoEditar: (tarefa: Tarefa) => void;
  aoApagar: (tarefa: Tarefa) => Promise<unknown>;
}

/** A cor é do TEMA, nunca um hex: ela tem de sobreviver ao claro e ao escuro. */
const COR_DA_PRIORIDADE: Record<PrioridadeDaTarefa, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-primary/10 text-primary",
  high: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  urgent: "bg-destructive/15 text-destructive",
};

/** O toque duplo reflexo cai em `Confirmar`, que nasce no lugar exato do lixo. */
const ATRASO_DO_CONFIRMAR_MS = 500;

/*
 * Os `md:pointer-fine:` desta linha (checkbox, ações, botões) são o comportamento de MOUSE: 16px
 * e ações reveladas no hover. O critério é o ponteiro e não só a largura porque, medido num Chromium
 * real, num tablet ≥768px o Tailwind v4 embrulha o hover de grupo em `@media (hover:hover)` — falso
 * em tela de toque — e a opacidade zero só sob `md` deixava as ações invisíveis para sempre (e ainda
 * tocáveis), com botões de 28px e checkbox de 16px sem área de toque. Sem mouse (celular OU tablet)
 * os controles ficam sempre visíveis e do tamanho de toque, em qualquer largura; de `lg` para cima
 * com MOUSE o tamanho continua vindo das variantes do `Button`. É por isso que a ALTURA dos botões é
 * limitada com `max-lg:`: o Tailwind emite a variante empilhada DEPOIS do `lg:h-9` do Button, então
 * sem o limite o 28px passava por cima do 36px com mouse a partir de 1024px (medido: 28×28 em vez de
 * 36×36; o Confirmar, 28 em vez de 32).
 *
 * Com TOQUE a partir de 1024px (iPad em paisagem) o `lg:h-9 lg:w-9` do Button encolheria o alvo para
 * 36px (o Confirmar, 32px). `pointer-coarse:lg:h-11 pointer-coarse:lg:w-11` o devolve aos 44px, como nos
 * cartões de Contatos: a variante composta é emitida DEPOIS do `lg:` puro (é isso que a faz vencer) e só
 * vale sob `(pointer: coarse)`, então o mouse segue com 36px/32px.
 */

function Linha({
  tarefa,
  podeEditar,
  aoAlternarConcluida,
  aoEditar,
  aoApagar,
}: {
  tarefa: Tarefa;
  podeEditar: boolean;
  aoAlternarConcluida: (t: Tarefa) => Promise<unknown>;
  aoEditar: (t: Tarefa) => void;
  aoApagar: (t: Tarefa) => Promise<unknown>;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const [ocupada, setOcupada] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const armadoEm = useRef(0);

  const encerrada = estaEncerrada(tarefa);
  const atrasada = estaAtrasada(tarefa);

  const rotuloDaPrioridade: Record<PrioridadeDaTarefa, string> = {
    low: t("Baixa"),
    medium: t("Média"),
    high: t("Alta"),
    urgent: t("Urgente"),
  };

  async function comBloqueio(acao: () => Promise<unknown>) {
    setOcupada(true);
    try {
      await acao();
    } finally {
      setOcupada(false);
    }
  }

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/40",
        encerrada && "opacity-60",
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={encerrada}
        aria-label={encerrada ? t("Reabrir a tarefa") : t("Marcar como concluída")}
        disabled={ocupada || !podeEditar}
        onClick={() => comBloqueio(() => aoAlternarConcluida(tarefa))}
        className={cn(
          "relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors after:absolute after:-inset-[11px] after:content-[''] md:pointer-fine:h-4 md:pointer-fine:w-4 md:pointer-fine:after:inset-0",
          encerrada
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/40 hover:border-primary",
        )}
      >
        {encerrada ? <Check size={12} weight="bold" aria-hidden /> : null}
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium",
            encerrada && "text-muted-foreground line-through",
          )}
        >
          {tarefa.title}
        </p>
        {tarefa.description ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{tarefa.description}</p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-medium",
              COR_DA_PRIORIDADE[tarefa.priority],
            )}
          >
            {rotuloDaPrioridade[tarefa.priority]}
          </span>
          <span className={cn("text-muted-foreground", atrasada && "font-semibold text-destructive")}>
            {tarefa.due_date
              ? new Date(tarefa.due_date).toLocaleString(tag, {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : t("Sem prazo")}
          </span>
        </div>
      </div>

      {podeEditar ? (
        <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity md:pointer-fine:opacity-0 md:pointer-fine:focus-within:opacity-100 md:pointer-fine:group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="md:max-lg:pointer-fine:h-7 md:max-lg:pointer-fine:w-7 pointer-coarse:lg:h-11 pointer-coarse:lg:w-11"
            aria-label={t("Editar a tarefa")}
            onClick={() => aoEditar(tarefa)}
          >
            <PencilSimple size={14} aria-hidden />
          </Button>
          {/*
            Confirmação em DOIS TOQUES no lugar de `confirm()`, que era o do
            original: `window.confirm` é bloqueado em iframe, ignora o tema e
            não passa por `t()` — o texto sai no idioma do navegador, não no da
            organização.
          */}
          {confirmando ? (
            <Button
              variant="destructive"
              size="sm"
              className="text-[11px] md:max-lg:pointer-fine:h-7 md:pointer-fine:px-2 pointer-coarse:lg:h-11"
              disabled={ocupada}
              onClick={() => {
                if (Date.now() - armadoEm.current < ATRASO_DO_CONFIRMAR_MS) return;
                return comBloqueio(() => aoApagar(tarefa));
              }}
            >
              {t("Confirmar")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="md:max-lg:pointer-fine:h-7 md:max-lg:pointer-fine:w-7 pointer-coarse:lg:h-11 pointer-coarse:lg:w-11"
              aria-label={t("Apagar a tarefa")}
              onClick={() => {
                armadoEm.current = Date.now();
                setConfirmando(true);
              }}
              onBlur={() => setConfirmando(false)}
            >
              <Trash size={14} aria-hidden />
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ListaDeTarefas({
  tarefas,
  podeEditar,
  aoAlternarConcluida,
  aoEditar,
  aoApagar,
}: Props) {
  const t = useT();
  const grupos = agrupaPorPrazo(tarefas);

  const rotuloDaFaixa: Record<FaixaDePrazo, string> = {
    atrasada: t("Atrasadas"),
    hoje: t("Hoje"),
    esta_semana: t("Esta semana"),
    mais_tarde: t("Mais tarde"),
    sem_prazo: t("Sem prazo"),
    encerrada: t("Encerradas"),
  };

  if (grupos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <p className="text-sm font-medium">{t("Nenhuma tarefa por aqui")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("Enquanto isto estiver vazio, o que foi combinado vive só na memória de alguém.")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {grupos.map((grupo) => (
        <section key={grupo.faixa}>
          <h2
            className={cn(
              "mb-1 px-3 text-xs font-semibold uppercase tracking-wider",
              grupo.faixa === "atrasada" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {rotuloDaFaixa[grupo.faixa]}
          </h2>
          <div className="rounded-xl border bg-card py-1">
            {grupo.tarefas.map((tarefa) => (
              <Linha
                key={tarefa.id}
                tarefa={tarefa}
                podeEditar={podeEditar}
                aoAlternarConcluida={aoAlternarConcluida}
                aoEditar={aoEditar}
                aoApagar={aoApagar}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
