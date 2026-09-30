/**
 * Divide um texto em partes de no máximo 1000 BYTES UTF-8 (limite da Send API do
 * Instagram — bytes, não caracteres: acento custa 2, emoji 4).
 *
 * Preferência de corte, da melhor para a pior: fim de parágrafo, fim de frase,
 * espaço em branco, corte duro. O corte duro acontece só quando não há nenhuma
 * fronteira numa janela útil, e NUNCA no meio de um ponto de código (par
 * substituto incluso): a janela é medida ponto de código a ponto de código.
 *
 * Um texto que já cabe volta intacto, sem `trim`. Nas partes de um texto dividido
 * as bordas são aparadas (a fronteira é espaço/quebra de linha).
 */
export const LIMITE_DE_BYTES = 1000;

/** Fronteira só vale se a parte resultante tiver ao menos 1/4 da janela. */
const MINIMO_DA_JANELA = 0.25;

const enc = new TextEncoder();
export const bytesUtf8 = (s: string): number => enc.encode(s).length;

/** Maior índice UTF-16 `i` tal que `texto.slice(0, i)` tem <= `max` bytes, em fronteira de ponto de código. */
function indiceMaximo(texto: string, max: number): number {
  let bytes = 0;
  let i = 0;
  for (const ch of texto) {
    const n = bytesUtf8(ch);
    if (bytes + n > max) break;
    bytes += n;
    i += ch.length;
  }
  return i;
}

function fronteira(janela: string): number {
  const minimo = Math.floor(janela.length * MINIMO_DA_JANELA);

  const par = janela.lastIndexOf("\n\n");
  if (par >= minimo && par > 0) return par;

  let frase = -1;
  for (const m of janela.matchAll(/[.!?…。](?=\s)/g)) frase = m.index! + 1;
  if (frase >= minimo && frase > 0) return frase;

  let espaco = -1;
  for (const m of janela.matchAll(/\s/g)) espaco = m.index!;
  if (espaco >= minimo && espaco > 0) return espaco;

  return -1;
}

export function dividirTextoEmPartes(texto: string, max: number = LIMITE_DE_BYTES): string[] {
  if (bytesUtf8(texto) <= max) return [texto];

  const partes: string[] = [];
  let resto = texto;
  while (bytesUtf8(resto) > max) {
    const limite = indiceMaximo(resto, max);
    const janela = resto.slice(0, limite);
    const corte = fronteira(janela);
    const ate = corte > 0 ? corte : limite;
    const parte = resto.slice(0, ate);
    const aparada = corte > 0 ? parte.trim() : parte;
    if (aparada) partes.push(aparada);
    resto = corte > 0 ? resto.slice(ate).trimStart() : resto.slice(ate);
  }
  if (resto.trim()) partes.push(corteFinal(resto, partes.length > 0));
  return partes;
}

function corteFinal(resto: string, dividido: boolean): string {
  return dividido ? resto.trim() : resto;
}
