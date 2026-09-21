import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

describe("superfícies compartilhadas no modo claro", () => {
  it("usa cartão branco e campos claros com raios suaves", () => {
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

    expect(screen.getByTestId("card")).toHaveClass("bg-surface", "rounded-xl", "shadow-card");
    expect(screen.getByRole("textbox", { name: "Nome" })).toHaveClass(
      "bg-surface-elevated",
      "rounded-md",
    );
    expect(screen.getByRole("textbox", { name: "Notas" })).toHaveClass(
      "bg-surface-elevated",
      "rounded-md",
    );
    expect(screen.getByRole("combobox", { name: "Equipe" })).toHaveClass(
      "bg-surface-elevated",
      "rounded-md",
    );
  });

  it("diferencia ações primária, secundária e terciária", () => {
    render(
      <>
        <Button>Salvar</Button>
        <Button variant="secondary">Importar</Button>
        <Button variant="ghost">Mais opções</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Salvar" })).toHaveClass(
      "bg-accent",
      "text-accent-foreground",
    );
    expect(screen.getByRole("button", { name: "Importar" })).toHaveClass(
      "bg-surface",
      "border-accent-700",
    );
    expect(screen.getByRole("button", { name: "Mais opções" })).toHaveClass(
      "hover:bg-surface-hover",
    );
  });

  it("mantém aba ativa branca sobre trilho suave", () => {
    render(
      <Tabs defaultValue="geral">
        <TabsList>
          <TabsTrigger value="geral">Geral</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    expect(screen.getByRole("tablist")).toHaveClass("bg-surface-tertiary");
    expect(screen.getByRole("tab", { name: "Geral" })).toHaveClass(
      "data-[state=active]:bg-surface",
    );
  });
});
