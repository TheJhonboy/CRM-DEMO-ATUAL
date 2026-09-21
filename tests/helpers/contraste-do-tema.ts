import fs from "node:fs";
import path from "node:path";

import { compor, hexParaRgb, normalizarHex, rgbParaHex } from "@/lib/branding/rampa";

/**
 * O instrumento dos testes que MEDEM contraste nos componentes, em vez de conferir
 * nome de classe.
 *
 * Um teste de classe prova que `dark:focus:text-accent-foreground` está no DOM; não
 * prova que a cor que ele carrega dá para ler. Foi por aí que o tema Calixto entrou
 * com menu ilegível, placeholder a 2,6:1 e botão destrutivo a 2,65:1 com toda a
 * suíte de superfícies verde. Aqui o caminho é o do navegador, em miniatura:
 *
 *   classe do componente ─► token de cor ─► valor do tema em `app/globals.css`
 *
 *  - a CLASSE é lida do texto-fonte do componente (ou de `buttonVariants`), não
 *    repetida em tabela: trocar a classe no componente muda o número medido;
 *  - o TOKEN é resolvido como o Tailwind o resolve: bloco do tema primeiro e, se ele
 *    não declara o nome, a ponte `@theme inline` (é por ela que `text-accent-foreground`
 *    chega a `--color-accent-fg`);
 *  - a extração do bloco é a mesma de `tests/unit/mobile-bottom-nav.test.tsx`
 *    (seletor ancorado no começo da linha, corpo até `\n}`); só foi estendida para
 *    seguir `var(--…)` e ler `rgba()`, que aquele caso não precisava.
 */

export type Tema = "claro" | "escuro";
export const TEMAS: readonly Tema[] = ["claro", "escuro"];

const SELETOR: Record<Tema, string> = {
  // `:root` é o bloco claro canônico; `[data-theme="light"]` só o espelha.
  claro: ":root",
  escuro: '[data-theme="dark"]',
};

const RAIZ = process.cwd();
const CSS = fs.readFileSync(path.join(RAIZ, "app/globals.css"), "utf8");

function blocoDe(seletor: string): string {
  const i = CSS.search(new RegExp(`^${seletor.replace(/[[\]"$]/g, "\\$&")}\\s*\\{`, "m"));
  if (i < 0) throw new Error(`não achei o bloco \`${seletor}\` em app/globals.css`);
  return CSS.slice(i, CSS.indexOf("\n}", i));
}

function declarado(bloco: string, nome: string): string | null {
  return new RegExp(`^\\s*${nome}:\\s*([^;]+);`, "m").exec(bloco)?.[1]?.trim() ?? null;
}

type CorComAlfa = { readonly hex: string; readonly alfa: number };

function lerCor(bruto: string): CorComAlfa | null {
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(bruto)) return { hex: normalizarHex(bruto), alfa: 1 };
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(bruto);
  if (!rgba) return null;
  return {
    hex: rgbParaHex({ r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]) }),
    alfa: rgba[4] === undefined ? 1 : Number(rgba[4]),
  };
}

function resolver(tema: Tema, token: string): CorComAlfa {
  const doTema = blocoDe(SELETOR[tema]);
  const ponte = blocoDe("@theme inline");
  let atual = token;
  // Limite contra ciclo: a ponte tem linhas auto-referentes (`--color-bg: var(--color-bg)`)
  // que só nunca valem porque o bloco do tema é consultado primeiro.
  for (let passo = 0; passo < 10; passo += 1) {
    const bruto = declarado(doTema, atual) ?? declarado(ponte, atual);
    if (bruto === null)
      throw new Error(`\`${atual}\` não está no tema ${tema} nem na ponte @theme`);
    const ref = /^var\((--[a-z0-9-]+)\)$/i.exec(bruto);
    if (ref) {
      atual = ref[1]!;
      continue;
    }
    const lida = lerCor(bruto);
    if (!lida)
      throw new Error(`\`${atual}\` = \`${bruto}\` não é uma cor que este instrumento leia`);
    return lida;
  }
  throw new Error(`\`${token}\` não resolveu em 10 passos no tema ${tema}`);
}

/**
 * Hex opaco de um `--color-*` no tema. Cor com alfa (`--color-accent-soft` no escuro é
 * `rgba(131,230,163,.16)`) só existe sobre um fundo: sem `sobre` isto lança, em vez de
 * medir o rgb cru como se fosse opaco.
 */
export function cor(tema: Tema, token: string, sobre?: string): string {
  const { hex, alfa } = resolver(tema, token);
  if (alfa >= 1) return hex;
  if (sobre === undefined)
    throw new Error(`\`${token}\` tem alfa ${alfa}: diga sobre qual fundo ele compõe`);
  // `compor` faz a composição alfa em sRGB gama-codificado, como o navegador.
  return compor(hex, alfa, sobre);
}

/** As duas únicas cores do Tailwind que os componentes usam sem token do produto. */
const DO_TAILWIND: Record<string, string> = { white: "#ffffff", black: "#000000" };

/** `nome` é um utilitário de cor (`accent-800`, `text-subtle`) e não outra família (`sm`, `center`)? */
function ehCor(tema: Tema, nome: string): boolean {
  if (nome in DO_TAILWIND) return true;
  return (
    declarado(blocoDe(SELETOR[tema]), `--color-${nome}`) !== null ||
    declarado(blocoDe("@theme inline"), `--color-${nome}`) !== null
  );
}

/** Hex do que o utilitário `bg-<nome>` / `text-<nome>` pinta no tema. */
export function corDoUtilitario(tema: Tema, nome: string, sobre?: string): string {
  return DO_TAILWIND[nome] ?? cor(tema, `--color-${nome}`, sobre);
}

// ── Classes lidas do texto-fonte do componente ───────────────────────────────

/** Cada literal `"…"` do arquivo que contém `marcador`, já separado em classes. */
export function literaisCom(relativo: string, marcador: string): string[][] {
  const fonte = fs.readFileSync(path.join(RAIZ, relativo), "utf8");
  return [...fonte.matchAll(/"([^"\n]*)"/g)]
    .map((m) => m[1]!)
    .filter((literal) => literal.includes(marcador))
    .map((literal) => literal.split(/\s+/).filter(Boolean));
}

export type Propriedade = "bg" | "text";

/**
 * Nome do token que o utilitário `<prefixo><propriedade>-…` aplica no tema.
 *
 * No escuro a variante `dark:` vence a forma sem prefixo — é a intenção de cada
 * `dark:…` dos componentes —, e no claro só a forma sem prefixo vale. Entre iguais a
 * última vence, como o `cn` (tailwind-merge) deixa. Só conta nome que é cor: sem esse
 * filtro `text-sm` (tamanho) venceria `text-accent-foreground` no botão.
 */
export function utilitario(
  classes: readonly string[],
  tema: Tema,
  prefixo: string,
  propriedade: Propriedade,
): string | null {
  const achar = (p: string): string | null => {
    const alvo = `${p}${propriedade}-`;
    const nomes = classes.filter((c) => c.startsWith(alvo)).map((c) => c.slice(alvo.length));
    return nomes.reverse().find((n) => ehCor(tema, n)) ?? null;
  };
  return (tema === "escuro" ? achar(`dark:${prefixo}`) : null) ?? achar(prefixo);
}

// ── O botão: repouso e hover ─────────────────────────────────────────────────

export type ParDeCores = { readonly texto: string; readonly fundo: string };
export type EstadosDoBotao = { readonly repouso: ParDeCores; readonly hover: ParDeCores };

/** `hover:brightness-95` multiplica cada canal sRGB por 0,95 — no fundo E no rótulo, que é o elemento todo. */
export function escurecer(hex: string, fator: number): string {
  const { r, g, b } = hexParaRgb(hex);
  return rgbParaHex({ r: r * fator, g: g * fator, b: b * fator });
}

export function estadosDoBotao(classes: readonly string[], tema: Tema): EstadosDoBotao {
  const nome = (prefixo: string, propriedade: Propriedade) =>
    utilitario(classes, tema, prefixo, propriedade);
  const fundo = nome("", "bg");
  const texto = nome("", "text");
  if (!fundo || !texto)
    throw new Error(`botão sem bg/text de cor no tema ${tema}: ${classes.join(" ")}`);
  const repouso = { fundo: corDoUtilitario(tema, fundo), texto: corDoUtilitario(tema, texto) };

  const hover = {
    fundo: corDoUtilitario(tema, nome("hover:", "bg") ?? fundo),
    texto: corDoUtilitario(tema, nome("hover:", "text") ?? texto),
  };
  const brilho = classes
    .map((c) => /^hover:brightness-(\d+)$/.exec(c)?.[1])
    .find((n) => n !== undefined);
  if (brilho === undefined) return { repouso, hover };
  const fator = Number(brilho) / 100;
  return {
    repouso,
    hover: { fundo: escurecer(hover.fundo, fator), texto: escurecer(hover.texto, fator) },
  };
}
