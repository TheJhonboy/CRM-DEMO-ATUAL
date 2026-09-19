"use client";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";

import type { Locale } from "date-fns";

import { useT } from "@/hooks/i18n/useT";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { format, formatRelative, isToday, isYesterday } from "date-fns";
import { toast } from "sonner";
import { CaretDown, CaretUp, ChatCircle, Trash } from "@/lib/ui/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { useDeleteContact } from "@/hooks/contacts/useDeleteContact";
import type { ContactOrderBy } from "@/lib/schemas/contacts";
import type { Contact } from "@/lib/types/contacts";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { cn } from "@/lib/utils";

interface Props {
  contacts: Contact[];
  orderBy: ContactOrderBy;
  orderDir: "asc" | "desc";
  onSort: (column: ContactOrderBy) => void;
}

function displayName(c: Contact, t: (texto: string) => string = (texto) => texto): string {
  return rotuloDoContato(c, t);
}

/** Hoje/ontem: relativo ("há 2 horas", "ontem"). Mais antigo: data, não dia da semana. */
// `locale` ANTES de `now`, e não depois: `now` tem default, e um parâmetro
// obrigatório atrás de um opcional obriga todo chamador a passar os dois. O
// codemod acrescentou no fim, que é o certo em 22 dos 23 casos e o errado aqui.
function formatUltimaAtividade(iso: string, locale: Locale, now = new Date()): string {
  const d = new Date(iso);
  if (isToday(d) || isYesterday(d)) {
    return formatRelative(d, now, { locale: locale });
  }
  return format(d, "dd/MM/yyyy", { locale: locale });
}

function SortableHead({
  label,
  column,
  orderBy,
  orderDir,
  onSort,
  className,
}: {
  label: string;
  column: ContactOrderBy;
  orderBy: ContactOrderBy;
  orderDir: "asc" | "desc";
  onSort: (column: ContactOrderBy) => void;
  className?: string;
}) {
  const active = orderBy === column;
  const muted = "text-muted-foreground";
  const emphasis = "text-foreground";

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 font-medium hover:text-foreground"
        aria-sort={active ? (orderDir === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}
        <span className="inline-flex flex-col -space-y-1" aria-hidden>
          <CaretUp
            size={12}
            weight="bold"
            className={active && orderDir === "asc" ? emphasis : muted}
          />
          <CaretDown
            size={12}
            weight="bold"
            className={active && orderDir === "desc" ? emphasis : muted}
          />
        </span>
      </button>
    </TableHead>
  );
}

/**
 * Os selos de estado do contato. Uma definição só para a tabela e para o
 * cartão do celular: as duas vistas mostram o MESMO registro e não podem
 * divergir na regra.
 */
function SelosDoContato({ c, clientesLigado }: { c: Contact; clientesLigado: boolean }) {
  const t = useT();
  return (
    <>
      {c.is_anonymized && <Badge variant="destructive">{t("Anonimizado")}</Badge>}
      {c.is_blocked && <Badge variant="warning">{t("Bloqueado")}</Badge>}
      {/*
        Lê a COLUNA, nunca a tag, e só com a regra ligada: a tag
        `cliente` é removível à mão e pelo PATCH (que substitui `tags`
        por inteiro), e um selo que some porque alguém editou
        etiquetas mentiria sobre um fato. Desligada, a coluna está
        congelada e o selo mentiria do outro lado.
      */}
      {clientesLigado && c.first_service_at && <Badge variant="secondary">{t("Cliente")}</Badge>}
      {!c.is_anonymized && !c.is_blocked && <Badge variant="success">{t("Ativo")}</Badge>}
    </>
  );
}

/**
 * As ações do contato (abrir/iniciar conversa e excluir). `compacta` é a
 * tabela (botão de 32px); o cartão do celular usa o tamanho `icon` padrão do
 * `Button`, que abaixo de `lg` é de 44px — o alvo de toque. Os cartões valem até
 * `xl` (ver o corte no `return`), então também cobrem o iPad em paisagem (1024px,
 * touch): `lg:h-11 lg:w-11` segura os 44px onde o `icon` cairia para 36px. O ícone
 * é de 16 nas duas vistas: o `Button` força `[&_svg]:size-4`, então outro `size`
 * seria letra morta.
 */
function AcoesDoContato({
  c,
  abrindo,
  compacta = false,
  onIniciarConversa,
  onExcluir,
}: {
  c: Contact;
  abrindo: string | null;
  compacta?: boolean;
  onIniciarConversa: (c: Contact) => void;
  onExcluir: (c: Contact) => void;
}) {
  const t = useT();
  const tamanho = compacta ? "h-8 w-8" : "lg:h-11 lg:w-11";
  return (
    <>
      {c.conversa ? (
        <Button variant="ghost" size="icon" className={tamanho} asChild>
          <Link
            href={`/app/inbox?id=${c.conversa.id}`}
            title={t("Abrir conversa no Inbox")}
            aria-label={`${t("Abrir conversa com")} ${displayName(c, t)} ${t("no Inbox")}`}
          >
            <ChatCircle size={16} weight="regular" aria-hidden />
            {c.conversa.unread > 0 && (
              <span className="sr-only">{c.conversa.unread} {t("sem ler")}</span>
            )}
          </Link>
        </Button>
      ) : c.phone_number ? (
        <Button
          variant="ghost"
          size="icon"
          className={tamanho}
          title={t("Iniciar conversa no Inbox")}
          aria-label={`${t("Iniciar conversa com")} ${displayName(c, t)} ${t("no Inbox")}`}
          disabled={abrindo === c.id}
          onClick={() => onIniciarConversa(c)}
        >
          <ChatCircle size={16} weight="regular" aria-hidden />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className={cn(tamanho, "text-muted-foreground hover:text-error-fg")}
        title={t("Excluir contato")}
        aria-label={`${t("Excluir contato")} ${displayName(c, t)}`}
        onClick={() => onExcluir(c)}
      >
        <Trash size={16} weight="regular" aria-hidden />
      </Button>
    </>
  );
}

/**
 * Abaixo de xl a tabela some, e com ela os cabeçalhos ordenáveis — sem isto o
 * celular ficaria preso na ordem padrão. Reusa o mesmo `onSort` da tabela, então
 * a regra de alternar o sentido continua sendo uma só.
 */
function OrdenacaoDoCelular({
  orderBy,
  orderDir,
  onSort,
}: {
  orderBy: ContactOrderBy;
  orderDir: "asc" | "desc";
  onSort: (column: ContactOrderBy) => void;
}) {
  const t = useT();
  const colunas: Array<{ column: ContactOrderBy; label: string }> = [
    { column: "display_name", label: t("Nome") },
    { column: "email", label: t("Email") },
    { column: "phone_number", label: t("Telefone") },
    { column: "last_activity_at", label: t("Última atividade") },
  ];
  return (
    <div
      data-testid="ordenacao-mobile-contatos"
      role="group"
      aria-label={t("Ordenar por")}
      className="flex gap-2 overflow-x-auto p-1"
    >
      {colunas.map(({ column, label }) => {
        const ativa = orderBy === column;
        return (
          <button
            key={column}
            type="button"
            onClick={() => onSort(column)}
            aria-pressed={ativa}
            // A barra é `overflow-x-auto` e recorta o anel de foco padrão (2px + offset de
            // 2px): medido, saía cortado 4px em cima e à esquerda. O offset negativo o
            // desenha para dentro do chip. No contraste forçado do Windows o `outline-offset:
            // 2px !important` global vence esse offset e o anel volta a sair do chip: o `p-1`
            // da barra (4px = 2px de anel + 2px de offset) dá folga nos quatro lados.
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-4 text-sm focus-visible:-outline-offset-2",
              ativa ? "border-accent bg-accent-soft text-foreground" : "text-muted-foreground",
            )}
          >
            {label}
            {ativa && (
              <>
                <span aria-hidden>{orderDir === "asc" ? "↑" : "↓"}</span>
                <span className="sr-only">
                  {orderDir === "asc" ? t("(crescente)") : t("(decrescente)")}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ContactsTable({ contacts, orderBy, orderDir, onSort }: Props) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const clientesLigado = useActiveOrg()?.cliente_pela_agenda === true;
  const del = useDeleteContact();
  const [alvo, setAlvo] = useState<Contact | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const router = useRouter();
  const qc = useQueryClient();

  async function iniciarConversa(c: Contact) {
    if (!c.phone_number || abrindo) return;
    setAbrindo(c.id);
    try {
      const res = await fetch("/api/v1/conversations/open-with-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: c.id, phone_number: c.phone_number }),
      });
      const json = (await res.json()) as {
        data?: { conversation_id: string };
        error?: { message?: string };
      };
      if (!res.ok || !json.data?.conversation_id) {
        throw new Error(json.error?.message ?? t("Não foi possível abrir a conversa."));
      }
      await qc.invalidateQueries({ queryKey: ["contacts"] });
      router.push(`/app/inbox?id=${json.data.conversation_id}`);
    } catch (err) {
      toast.error(err instanceof Error ? t(err.message) : t("Não foi possível abrir a conversa."));
    } finally {
      setAbrindo(null);
    }
  }

  async function confirmarExclusao() {
    if (!alvo) return;
    try {
      await del.mutateAsync(alvo.id);
      toast.success(t("Contato excluído."));
      setAlvo(null);
    } catch {
      // hook handles toast
    }
  }

  // O corte entre cartões e tabela é `xl`, não `md`: medido num Chromium real, a
  // tabela precisa de ~968px e a barra lateral de 240px já aparece a partir de
  // `md`, então de 768 a 1279 ela não cabia (só "Nome" à vista, ações fora da
  // tela). A partir de 1280 ela cabe.
  return (
    <>
    <div data-testid="lista-mobile-contatos" className="space-y-2 xl:hidden">
      <OrdenacaoDoCelular orderBy={orderBy} orderDir={orderDir} onSort={onSort} />
      {contacts.map((c) => (
        <div key={c.id} className="rounded-xl border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/app/contacts/${c.id}`}
              className="min-w-0 flex-1 truncate py-2.5 font-medium hover:underline"
            >
              {displayName(c)}
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              <AcoesDoContato
                c={c}
                abrindo={abrindo}
                onIniciarConversa={(x) => void iniciarConversa(x)}
                onExcluir={setAlvo}
              />
            </div>
          </div>
          <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            {c.phone_number && <p>{phoneForDisplay(c.phone_number)}</p>}
            {c.email && <p className="truncate">{c.email}</p>}
            {c.last_activity_at && (
              <p className="text-xs">{formatUltimaAtividade(c.last_activity_at, localeDaData)}</p>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <SelosDoContato c={c} clientesLigado={clientesLigado} />
            {c.tags.map((tag) => (
              <Badge key={tag} variant="neutral">{tag}</Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
    <div data-testid="tabela-contatos-desktop" className="hidden xl:block">
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead
            label={t("Nome")}
            column="display_name"
            orderBy={orderBy}
            orderDir={orderDir}
            onSort={onSort}
          />
          <SortableHead
            label={t("Email")}
            column="email"
            orderBy={orderBy}
            orderDir={orderDir}
            onSort={onSort}
          />
          <SortableHead
            label={t("Telefone")}
            column="phone_number"
            orderBy={orderBy}
            orderDir={orderDir}
            onSort={onSort}
          />
          <TableHead>{t("Tags")}</TableHead>
          <SortableHead
            label={t("Última atividade")}
            column="last_activity_at"
            orderBy={orderBy}
            orderDir={orderDir}
            onSort={onSort}
          />
          <TableHead>{t("Status")}</TableHead>
          <TableHead className="w-[88px]">
            <span className="sr-only">{t("Ações")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {contacts.map((c) => (
          <TableRow key={c.id} className="cursor-pointer">
            <TableCell className="font-medium">
              <Link href={`/app/contacts/${c.id}`} className="hover:underline">
                {displayName(c)}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {c.email ?? "—"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {c.phone_number ? phoneForDisplay(c.phone_number) : "—"}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {c.tags.length === 0
                  ? <span className="text-muted-foreground text-xs">—</span>
                  : c.tags.map((tag) => (
                      <Badge key={tag} variant="neutral">{tag}</Badge>
                    ))}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {c.last_activity_at
                ? formatUltimaAtividade(c.last_activity_at, localeDaData)
                : "—"}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                <SelosDoContato c={c} clientesLigado={clientesLigado} />
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-0.5">
                <AcoesDoContato
                  c={c}
                  abrindo={abrindo}
                  compacta
                  onIniciarConversa={(x) => void iniciarConversa(x)}
                  onExcluir={setAlvo}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </div>

    <AlertDialog open={alvo !== null} onOpenChange={(open) => { if (!open) setAlvo(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Excluir contato?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {alvo
              ? `${t("Isso remove")} ${displayName(alvo, t)} ${t("e a conversa associada, se houver. Esta ação não pode ser desfeita.")}`
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={del.isPending}>{t("Cancelar")}</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => void confirmarExclusao()}
            disabled={del.isPending}
          >
            {del.isPending ? t("Excluindo…") : t("Excluir")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
