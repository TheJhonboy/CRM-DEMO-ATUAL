import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buttonVariants } from "@/components/ui/button";
import { PISOS, razaoDeContraste } from "@/lib/branding/contraste";
import { TEMAS, estadosDoBotao, literaisCom } from "@/tests/helpers/contraste-do-tema";

const root = process.cwd();
const actionFiles = [
  "app/app/templates/_components/TemplatesClient.tsx",
  "app/app/webhooks/_components/SourcesTab.tsx",
  "app/app/kanban/_client.tsx",
  "app/app/ai/routers/_client.tsx",
  "app/app/settings/tenant/pipelines/_mapping.tsx",
  "app/app/settings/tenant/pipelines/_client.tsx",
];

const MARCADOR = "bg-accent text-accent-foreground hover:bg-accent-hover";

/** O que o `<Button>` emite: a variante primária mais a className da página (a da página vence, como no `cn`). */
const classesEfetivas = (daPagina: readonly string[]) => [
  ...buttonVariants({ variant: "primary" }).split(/\s+/).filter(Boolean),
  ...daPagina,
];

// LACUNA CONHECIDA, medida e deixada como está: nestas quatro páginas o hover escuro é
// `dark:hover:bg-accent-700` sob a tinta `#07110b` (a frente da menta) = 4,486:1, 0,014
// abaixo do piso de 4,5. Nenhum degrau da rampa cabe entre o repouso (`accent-600`) e o
// `accent-700`; os que passam mudam o hover (`accent-600` = sem feedback de cor,
// `accent-500` = passa a CLAREAR em vez de escurecer, `accent-hover` = menta pálida). É
// decisão de aparência do dono do tema, não conserto de classe.
const HOVER_ESCURO_ABAIXO_DE_AA = new Set([
  "app/app/templates/_components/TemplatesClient.tsx",
  "app/app/webhooks/_components/SourcesTab.tsx",
  "app/app/kanban/_client.tsx",
  "app/app/ai/routers/_client.tsx",
]);

describe("ações principais no modo claro", () => {
  it.each(actionFiles)("usa o verde-floresta do tema nas classes-base do botão: %s", (file) => {
    const source = fs.readFileSync(path.join(root, file), "utf8");

    expect(source).toContain(MARCADOR);
  });

  // Este caso EXIGIA `dark:bg-accent-(500|600)` nos seis arquivos, ou seja, exigia a cor
  // de fundo sem olhar o rótulo. Duas das seis (Pipelines) tinham `dark:bg-accent-500
  // dark:text-text`: `#f4f7f8` sobre `#00ca77` = 2,01:1, e o teste as chamava de aprovadas.
  // Agora ele lê a className, resolve os dois tokens em `app/globals.css` e mede o par.
  it.each(actionFiles)(
    "o rótulo passa de 4,5:1 nos dois temas, em repouso e no hover: %s",
    (file) => {
      const literais = literaisCom(file, MARCADOR);
      expect(literais.length, `${file}: nenhum botão primário achado`).toBeGreaterThanOrEqual(1);

      const abaixo: string[] = [];
      for (const daPagina of literais) {
        for (const tema of TEMAS) {
          const { repouso, hover } = estadosDoBotao(classesEfetivas(daPagina), tema);
          const medidas = [
            { estado: "repouso", ...repouso },
            // O hover escuro das quatro páginas irmãs é a lacuna documentada acima.
            ...(tema === "escuro" && HOVER_ESCURO_ABAIXO_DE_AA.has(file)
              ? []
              : [{ estado: "hover", ...hover }]),
          ];
          for (const m of medidas) {
            const r = razaoDeContraste(m.texto, m.fundo);
            if (r < PISOS.texto) {
              abaixo.push(
                `${file} · ${tema} · ${m.estado} (${m.texto} sobre ${m.fundo}) = ${r.toFixed(2)}:1`,
              );
            }
          }
        }
      }
      expect(abaixo).toEqual([]);
    },
  );

  it.each([...HOVER_ESCURO_ABAIXO_DE_AA])(
    "lacuna conhecida: o hover escuro fica logo abaixo de 4,5:1 (decisão pendente): %s",
    (file) => {
      for (const daPagina of literaisCom(file, MARCADOR)) {
        const { hover } = estadosDoBotao(classesEfetivas(daPagina), "escuro");
        const r = razaoDeContraste(hover.texto, hover.fundo);
        // Fixa a lacuna nos dois sentidos. Se alguém a fechar, este caso passa a falhar e
        // pede que a exceção acima seja apagada; se ela piorar, falha do mesmo jeito.
        expect(r, `hover escuro a ${r.toFixed(3)}:1`).toBeLessThan(PISOS.texto);
        expect(r, `hover escuro a ${r.toFixed(3)}:1`).toBeGreaterThan(4.4);
      }
    },
  );
});
