import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Card } from "@/components/ui/card";
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

describe("superfícies compartilhadas no modo escuro", () => {
  it("eleva cartões e integra campos ao carvão azulado", () => {
    render(
      <>
        <Card data-testid="card">Conteúdo</Card>
        <Input aria-label="Nome" />
        <Textarea aria-label="Notas" />
        <Select>
          <SelectTrigger aria-label="Equipe">
            <SelectValue placeholder="Equipe" />
          </SelectTrigger>
        </Select>
      </>,
    );

    expect(screen.getByTestId("card")).toHaveClass("dark:bg-surface-elevated");
    expect(screen.getByRole("textbox", { name: "Nome" })).toHaveClass("dark:bg-surface");
    expect(screen.getByRole("textbox", { name: "Notas" })).toHaveClass("dark:bg-surface");
    expect(screen.getByRole("combobox", { name: "Equipe" })).toHaveClass("dark:bg-surface");
  });

  it("mantém a aba ativa em uma camada legível no escuro", () => {
    render(
      <Tabs defaultValue="geral">
        <TabsList>
          <TabsTrigger value="geral">Geral</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    expect(screen.getByRole("tab", { name: "Geral" })).toHaveClass(
      "dark:data-[state=active]:bg-surface",
    );
  });

  it("usa o overlay semântico e uma superfície elevada no modal", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Detalhes</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    const modal = screen.getByRole("dialog", { name: "Detalhes" });
    const overlay = document.querySelector('[data-state="open"][style*="pointer-events"]');
    expect(modal).toHaveClass("dark:bg-surface-elevated");
    expect(overlay).toHaveClass("bg-overlay");
  });

  it("mantém alertas e painéis laterais na mesma camada elevada", () => {
    render(
      <>
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>Confirmar ação</AlertDialogTitle>
          </AlertDialogContent>
        </AlertDialog>
        <Sheet open>
          <SheetContent>
            <SheetTitle>Filtros</SheetTitle>
          </SheetContent>
        </Sheet>
      </>,
    );

    expect(screen.getByRole("alertdialog", { hidden: true })).toHaveClass(
      "dark:bg-surface-elevated",
    );
    expect(screen.getByRole("dialog", { hidden: true })).toHaveClass("dark:bg-surface-elevated");
    expect(document.querySelectorAll('[class~="bg-overlay"]')).toHaveLength(2);
  });
});
