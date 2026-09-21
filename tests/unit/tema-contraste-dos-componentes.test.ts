import { describe, expect, it } from "vitest";

import { buttonVariants } from "@/components/ui/button";
import { PISOS, razaoDeContraste } from "@/lib/branding/contraste";
import {
  TEMAS,
  cor,
  corDoUtilitario,
  estadosDoBotao,
  literaisCom,
  utilitario,
  type Tema,
} from "@/tests/helpers/contraste-do-tema";

/**
 * O CONTRASTE DOS COMPONENTES, MEDIDO — nos dois temas.
 *
 * Os testes de superfície (`dark-shared-surfaces`, `light-shared-surfaces`, …) provam
 * que a classe certa está no componente. Nenhum deles prova que a COR que a classe
 * carrega dá para ler, e por isso o tema Calixto entrou com cinco defeitos que todos
 * eles deixaram passar (medidos com `razaoDeContraste`, a régua do produto):
 *
 *   - item de menu em foco no escuro: tinta `#07110b` (feita para a menta SÓLIDA) sobre
 *     o verde suave `rgba(131,230,163,.16)` composto sobre o popover = 1,54:1;
 *   - `--color-text-subtle` claro (`#929a95`) a 2,62–2,89:1 em toda superfície clara,
 *     placeholders e rótulos incluídos — é texto, vale WCAG 1.4.3;
 *   - botão destrutivo no escuro: `text-white` sobre `#e78378` = 2,65:1;
 *   - duas ações de página no escuro: `#f4f7f8` sobre `#00ca77` = 2,01:1.
 *
 * Aqui a classe é lida do texto-fonte do componente (ou de `buttonVariants`) e o token
 * é resolvido em `app/globals.css` por `tests/helpers/contraste-do-tema.ts`. Trocar a
 * classe no componente ou o valor no CSS muda o número; a mensagem de falha imprime
 * cada par abaixo do piso com a razão medida.
 */

type Medida = { readonly rotulo: string; readonly razao: number; readonly piso: number };

const razao = razaoDeContraste;

/** Uma linha por medida abaixo do piso, com o número: é o que a falha mostra. */
function abaixoDoPiso(medidas: readonly Medida[]): string[] {
  return medidas
    .filter((m) => m.razao < m.piso)
    .map((m) => `${m.rotulo} = ${m.razao.toFixed(2)}:1 (mínimo ${m.piso}:1)`);
}

function medirBotao(rotulo: string, classes: readonly string[], tema: Tema): Medida[] {
  const { repouso, hover } = estadosDoBotao(classes, tema);
  return [
    {
      rotulo: `${rotulo} · repouso (${repouso.texto} sobre ${repouso.fundo})`,
      razao: razao(repouso.texto, repouso.fundo),
      piso: PISOS.texto,
    },
    {
      rotulo: `${rotulo} · hover (${hover.texto} sobre ${hover.fundo})`,
      razao: razao(hover.texto, hover.fundo),
      piso: PISOS.texto,
    },
  ];
}

const classesDoBotao = (variant: "primary" | "default" | "destructive") =>
  buttonVariants({ variant }).split(/\s+/).filter(Boolean);

describe("menus · item em foco, aberto ou marcado", () => {
  const ESTADOS = ["focus:", "data-[state=open]:", "data-[state=checked]:"] as const;

  it.each(TEMAS)(
    "o texto passa de 4,5:1 sobre o verde suave composto sobre o popover — tema %s",
    (tema) => {
      // O verde suave é translúcido no escuro: o fundo que o olho vê é ele COMPOSTO sobre
      // o popover, e é sobre esse pixel que o texto se mede.
      const popover = cor(tema, "--color-popover");
      const suave = cor(tema, "--color-accent-soft", popover);

      const medidas: Medida[] = [];
      for (const arquivo of ["components/ui/dropdown-menu.tsx", "components/ui/select.tsx"]) {
        for (const classes of literaisCom(arquivo, "bg-accent-soft")) {
          for (const estado of ESTADOS) {
            if (!classes.includes(`${estado}bg-accent-soft`)) continue;
            // Sem cor própria no estado, o item herda o texto do popover.
            const nome = utilitario(classes, tema, estado, "text") ?? "popover-foreground";
            const texto = corDoUtilitario(tema, nome);
            medidas.push({
              rotulo: `${arquivo} ${estado}text-${nome} (${texto} sobre ${suave})`,
              razao: razao(texto, suave),
              piso: PISOS.texto,
            });
          }
        }
      }

      // Vacuidade: SubTrigger (foco e aberto), Item, CheckboxItem, RadioItem e
      // SelectItem (foco e marcado) = 7. Sem este piso, um refactor que renomeie a
      // classe faria o laço medir zero pares e o caso ficaria verde por não olhar nada.
      expect(medidas.length).toBeGreaterThanOrEqual(7);
      expect(abaixoDoPiso(medidas)).toEqual([]);
    },
  );
});

describe("campos · placeholder", () => {
  const CAMPOS = [
    {
      rotulo: "Input",
      arquivo: "components/ui/input.tsx",
      marcador: "",
      placeholder: "placeholder:",
      foco: "focus-visible:",
    },
    {
      rotulo: "Textarea",
      arquivo: "components/ui/textarea.tsx",
      marcador: "",
      placeholder: "placeholder:",
      foco: "focus-visible:",
    },
    // O trigger do Select: o placeholder é o estado `data-[placeholder]` do Radix.
    {
      rotulo: "SelectTrigger",
      arquivo: "components/ui/select.tsx",
      marcador: "data-[placeholder]:",
      placeholder: "data-[placeholder]:",
      foco: "focus:",
    },
  ] as const;

  it.each(TEMAS)(
    "o placeholder passa de 4,5:1 sobre o fundo do campo, em repouso e em foco — tema %s",
    (tema) => {
      const medidas: Medida[] = [];
      for (const campo of CAMPOS) {
        const classes = literaisCom(campo.arquivo, campo.marcador).flat();
        const placeholder = utilitario(classes, tema, campo.placeholder, "text");
        expect(placeholder, `${campo.rotulo}: sem cor de placeholder`).not.toBeNull();
        const texto = corDoUtilitario(tema, placeholder!);
        for (const [estado, prefixo] of [
          ["repouso", ""],
          ["foco", campo.foco],
        ] as const) {
          const fundo = utilitario(classes, tema, prefixo, "bg");
          expect(fundo, `${campo.rotulo}: sem fundo em ${estado}`).not.toBeNull();
          const hexFundo = corDoUtilitario(tema, fundo!);
          medidas.push({
            rotulo: `${campo.rotulo} · ${estado} placeholder:text-${placeholder} (${texto}) sobre bg-${fundo} (${hexFundo})`,
            razao: razao(texto, hexFundo),
            piso: PISOS.texto,
          });
        }
      }
      expect(medidas).toHaveLength(CAMPOS.length * 2);
      expect(abaixoDoPiso(medidas)).toEqual([]);
    },
  );
});

describe("text-subtle · legível em toda superfície", () => {
  // As cinco superfícies do brief mais as duas de hover. `surface-hover` e
  // `sidebar-hover` são as mais escuras do claro (`#f1f3f1`) e, no escuro, brancas a
  // 6% de alfa — só existem sobre a superfície em que acontecem.
  const SUPERFICIES = [
    { nome: "bg", token: "--color-bg" },
    { nome: "surface", token: "--color-surface" },
    { nome: "surface-elevated", token: "--color-surface-elevated" },
    { nome: "surface-tertiary", token: "--color-surface-tertiary" },
    { nome: "sidebar", token: "--color-sidebar" },
    { nome: "surface-hover", token: "--color-surface-hover", sobre: "--color-surface" },
    { nome: "sidebar-hover", token: "--color-sidebar-hover", sobre: "--color-sidebar" },
  ] as const;

  it.each(TEMAS)("passa de 4,5:1 em cada superfície — tema %s", (tema) => {
    const subtle = cor(tema, "--color-text-subtle");
    const medidas: Medida[] = SUPERFICIES.map((s) => {
      const fundo = cor(tema, s.token, "sobre" in s ? cor(tema, s.sobre) : undefined);
      return {
        rotulo: `text-subtle ${subtle} sobre ${s.nome} (${fundo})`,
        razao: razao(subtle, fundo),
        piso: PISOS.texto,
      };
    });
    expect(medidas).toHaveLength(SUPERFICIES.length);
    expect(abaixoDoPiso(medidas)).toEqual([]);
  });

  it.each(TEMAS)("segue uma camada mais discreta que text-muted — tema %s", (tema) => {
    // Subir o subtle até o piso o aproxima do muted; esta guarda impede que ele o
    // ULTRAPASSE (o subtle passaria a ser mais forte que o muted e a hierarquia
    // inverteria). "Mais discreto" = mais perto da superfície = razão menor.
    const bg = cor(tema, "--color-bg");
    const rSubtle = razao(cor(tema, "--color-text-subtle"), bg);
    const rMuted = razao(cor(tema, "--color-text-muted"), bg);
    expect(
      rSubtle,
      `subtle ${rSubtle.toFixed(3)}:1 x muted ${rMuted.toFixed(3)}:1 sobre o bg`,
    ).toBeLessThan(rMuted);
  });
});

describe("botão destrutivo", () => {
  it.each(TEMAS)(
    "o rótulo passa de 4,5:1 sobre o vermelho, em repouso e no hover — tema %s",
    (tema) => {
      const medidas = medirBotao("destructive", classesDoBotao("destructive"), tema);
      expect(medidas).toHaveLength(2);
      expect(abaixoDoPiso(medidas)).toEqual([]);
    },
  );
});

describe("botão primário", () => {
  it.each(TEMAS)(
    "o rótulo passa de 4,5:1 sobre o accent, em repouso e no hover — tema %s",
    (tema) => {
      const medidas = [
        ...medirBotao("primary", classesDoBotao("primary"), tema),
        ...medirBotao("default", classesDoBotao("default"), tema),
      ];
      expect(medidas).toHaveLength(4);
      expect(abaixoDoPiso(medidas)).toEqual([]);
    },
  );
});

describe("ações de página dos funis (Pipelines)", () => {
  const ARQUIVOS = [
    "app/app/settings/tenant/pipelines/_client.tsx",
    "app/app/settings/tenant/pipelines/_mapping.tsx",
  ] as const;

  it.each(TEMAS)("o botão primário passa de 4,5:1 em repouso e no hover — tema %s", (tema) => {
    const medidas: Medida[] = [];
    for (const arquivo of ARQUIVOS) {
      const literais = literaisCom(
        arquivo,
        "bg-accent text-accent-foreground hover:bg-accent-hover",
      );
      expect(literais, `${arquivo}: esperava exatamente um botão primário`).toHaveLength(1);
      // O que o `<Button>` emite é a variante mais a className da página, e a da
      // página vence (o `cn` é tailwind-merge). A ordem daqui reproduz isso.
      medidas.push(...medirBotao(arquivo, [...classesDoBotao("primary"), ...literais[0]!], tema));
    }
    expect(medidas).toHaveLength(ARQUIVOS.length * 2);
    expect(abaixoDoPiso(medidas)).toEqual([]);
  });
});
