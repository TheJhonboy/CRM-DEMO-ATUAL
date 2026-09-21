"use client";
import { Droppable } from "@hello-pangea/dnd";
import { useRef, type CSSProperties } from "react";
import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types/leads";
import type { Stage } from "@/lib/kanban/types";
import { buildCardInput } from "@/lib/kanban/card-state";
import { intervaloDaColuna } from "@/lib/kanban/selecao";
import { KanbanCard, type GestoDeSelecao } from "./KanbanCard";

interface StageColumnProps {
  stage: Stage;
  leads: Lead[];
  pipelineId: string;
  /** owner_user_id → nome, resolvido no board. O dono agente vem no lead. */
  ownerNames?: Map<string, string | null>;
  /** ids que o radar classificou como esfriando (fonte única, não recalculada). */
  coolingIds?: Set<string>;
  /** Propostas de retomada vivas, por lead. */
  reactivations?: Map<string, { proposalId: string; expiresAt: string }>;
  /** `settings.canonical_tags` do pipeline — a única tag que fica no card. */
  canonicalTags?: string[];
  selectedLeadIds?: Set<string>;
  /** leadId → quantos eventos remotos já chegaram (muda = pulsa de novo). */
  pulses?: Map<string, number>;
  /**
   * Marca/desmarca um conjunto de uma vez — a etapa inteira, ou o intervalo do
   * shift+clique. Existe separado de `onSelect` porque a coluna é a única que
   * sabe a ordem VISÍVEL dos cards (é ela que recebe a lista já filtrada), e
   * resolver o intervalo no board significaria reconstruir essa ordem lá.
   */
  onSelectMany?: (leadIds: string[], marcar: boolean) => void;
  /** Abrir o dossiê — atravessa o board até o card, como `pulses`. */
  onOpen?: (leadId: string) => void;
}

function formatBRL(cents: number): string {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `R$ ${(cents / 100).toFixed(0)}`;
  }
}

export function StageColumn({
  stage,
  leads,
  pipelineId,
  ownerNames,
  coolingIds,
  reactivations,
  canonicalTags,
  selectedLeadIds,
  pulses,
  onSelectMany,
  onOpen,
}: StageColumnProps) {
  const t = useT();
  const totalCents = leads.reduce((sum, l) => sum + (l.value_cents ?? 0), 0);

  const idsVisiveis = leads.map((l) => l.id);
  const selecionadosAqui = idsVisiveis.filter((id) => selectedLeadIds?.has(id)).length;
  const todosSelecionados = idsVisiveis.length > 0 && selecionadosAqui === idsVisiveis.length;

  // A âncora do shift+clique. `useRef` e não `useState` de propósito: mudar a
  // âncora não muda nada na tela, e um `setState` aqui remontaria a coluna
  // inteira — inclusive o `Droppable` — a cada card marcado.
  const ancora = useRef<string | null>(null);

  const aoSelecionar = (leadId: string, gesto: GestoDeSelecao) => {
    if (gesto === "intervalo") {
      const faixa = intervaloDaColuna(idsVisiveis, ancora.current, leadId);
      ancora.current = leadId;
      onSelectMany?.(faixa, true);
      return;
    }
    ancora.current = leadId;
    onSelectMany?.([leadId], !selectedLeadIds?.has(leadId));
  };

  const alternarEtapa = () => {
    ancora.current = null;
    onSelectMany?.(idsVisiveis, !todosSelecionados);
  };
  // A cor da etapa deixa de ser só um pontinho e passa a tingir o cabeçalho
  // inteiro (borda + fundo em `color-mix`, 28% da cor sobre a superfície), que
  // é o que dá identidade à coluna nos dois temas. `--color-border-strong` é o
  // fallback de etapa sem cor.
  const stageAccent = stage.color ?? "var(--color-border-strong)";
  const accentStyle: CSSProperties = { backgroundColor: stageAccent };
  const headerStyle = {
    "--stage-accent": stageAccent,
    "--stage-header-bg": `color-mix(in srgb, ${stageAccent} 28%, var(--color-surface))`,
  } as CSSProperties;

  return (
    // `w-[85vw] snap-center … md:w-80` é a geometria mobile (coluna larga que
    // encaixa no snap horizontal) e fica; do tema vêm `bg-surface`,
    // `overflow-hidden` (senão o fundo do cabeçalho vaza no canto arredondado)
    // e a borda clara do escuro.
    <div className="flex w-[85vw] shrink-0 snap-center flex-col overflow-hidden rounded-lg border border-border bg-surface dark:border-white/10 md:w-80">
      <div
        className="group/etapa flex items-center gap-2 border-b border-[var(--stage-accent)] bg-[var(--stage-header-bg)] px-3 py-2.5"
        style={headerStyle}
      >
        {/* "Selecionar a etapa inteira" é o gesto que faz a ação em lote valer a
            pena: sem ele, mover trinta cards deixa de ser trinta arrastes e vira
            trinta cliques com modificador. Fica no cabeçalho porque é ali que a
            etapa é um objeto — o mesmo lugar onde já se lê a contagem dela.
            Indeterminado quando a seleção é parcial: "alguns" e "nenhum" não
            podem ter a mesma aparência num controle que o próximo clique
            inverte. */}
        <input
          type="checkbox"
          checked={todosSelecionados}
          ref={(el) => {
            if (el) el.indeterminate = selecionadosAqui > 0 && !todosSelecionados;
          }}
          disabled={idsVisiveis.length === 0}
          onChange={alternarEtapa}
          aria-label={
            todosSelecionados
              ? `${t("Desmarcar todos em")} ${stage.name}`
              : `${t("Selecionar todos em")} ${stage.name}`
          }
          className={cn(
            "h-4 w-4 shrink-0 cursor-pointer accent-accent transition-opacity",
            "focus:opacity-100 disabled:cursor-default",
            selecionadosAqui > 0 ? "opacity-100" : "opacity-0 group-hover/etapa:opacity-100",
          )}
        />
        <span
          className={cn("h-2 w-2 rounded-full", !stage.color && "bg-text-muted/40")}
          style={accentStyle}
          aria-hidden
        />
        <h2 className="flex-1 truncate text-sm font-semibold text-text">{stage.name}</h2>
        <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium tabular-nums text-text-muted">
          {selecionadosAqui > 0 ? `${selecionadosAqui}/${leads.length}` : leads.length}
        </span>
      </div>

      {totalCents > 0 && (
        <div className="border-b border-border px-3 py-1.5 text-[11px] tabular-nums text-text-muted">
          {formatBRL(totalCents)}
        </div>
      )}

      <Droppable droppableId={stage.id} type="LEAD">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              "flex flex-1 flex-col gap-2 p-2 transition-colors",
              snapshot.isDraggingOver && "bg-accent/5",
            )}
          >
            {leads.map((lead, idx) => (
              <KanbanCard
                key={lead.id}
                card={buildCardInput(lead, {
                  stageName: stage.name,
                  ownerNames,
                  coolingIds,
                  reactivations,
                  canonicalTags,
                })}
                lead={lead}
                index={idx}
                pipelineId={pipelineId}
                isSelected={selectedLeadIds?.has(lead.id)}
                isSelecting={(selectedLeadIds?.size ?? 0) > 0}
                pulseCount={pulses?.get(lead.id) ?? 0}
                onSelect={aoSelecionar}
                onOpen={onOpen}
              />
            ))}
            {provided.placeholder}
            {leads.length === 0 && !snapshot.isDraggingOver && (
              <div className="flex h-20 items-center justify-center text-[11px] text-text-muted">
                {t("vazio")}
              </div>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}
