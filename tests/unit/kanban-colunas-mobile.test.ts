import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

/**
 * Sem nenhuma classe responsiva, a coluna de 320px fixos virava scroll
 * horizontal cru no celular — sem indicar onde uma etapa termina e a
 * próxima começa. scroll-snap com largura de ~85vw dá a sensação de
 * "arrastar para a próxima etapa"; a partir de md volta a ser exatamente
 * o board de hoje (w-80, sem snap).
 *
 * Atenção: snap-mandatory engole os micro-scrolls auto do @hello-pangea/dnd,
 * impedindo arrastar um card para a próxima etapa no celular. Agora snap
 * desliga durante o arrasto (data-[arrastando=true]:snap-none) e volta no drop.
 *
 * O board fica dentro do `p-6` da `main`, e a coluna de 85vw é medida contra a
 * TELA, não contra essa caixa: a segunda coluna começava 7,75px além da borda
 * da caixa (375px), sem nenhuma pista de que dá para arrastar. `max-md:-mx-6`
 * no contêiner (e no skeleton) tira os 24px da `main` só no celular; o `p-4`
 * interno fica, então a primeira coluna continua a 16px da borda da tela e a
 * próxima aparece ~28px.
 */
describe("Kanban — colunas no celular", () => {
  it("a coluna real tem ~85vw com snap no celular, 320px a partir de md — sem snap-none (a container o controla)", () => {
    const src = fs.readFileSync(path.join(RAIZ, "components/kanban/StageColumn.tsx"), "utf8");
    expect(src).toContain(
      'className="flex w-[85vw] shrink-0 snap-center flex-col rounded-lg border border-border bg-surface-muted/40 md:w-80"',
    );
  });

  it("o contêiner do board tem snap-x mas desativa no arrasto (data-[arrastando=true]:snap-none)", () => {
    const src = fs.readFileSync(path.join(RAIZ, "components/kanban/KanbanBoard.tsx"), "utf8");
    expect(src).toContain('data-arrastando={arrastando}');
    expect(src).toContain(
      'className="flex h-full snap-x snap-mandatory gap-3 overflow-x-auto p-4 max-md:-mx-6 md:snap-none data-[arrastando=true]:snap-none"',
    );
    expect(src).toContain('onDragStart={() => setArrastando(true)}');
    expect(src).toContain('setArrastando(false);');
  });

  // O `-mx-6` desconta o padding da `main` e SÓ dele. Se a página que renderiza o
  // board ganhar padding horizontal próprio, o desconto passa a ser errado (a
  // borda do board deixa de coincidir com a da tela) — este teste força quem
  // mexer ali a rever o `max-md:-mx-6` do board. (`<KanbanBoard` só é renderizado
  // nessa página: conferido com grep em app/ e components/.)
  it("a página do funil, que renderiza o board, não põe padding horizontal próprio — o -mx-6 desconta só o da main", () => {
    const pagina = fs.readFileSync(path.join(RAIZ, "app/app/pipelines/[id]/_client.tsx"), "utf8");
    expect(pagina).toContain('className="flex h-full flex-col gap-4"');
    expect(pagina.match(/<KanbanBoard/g)).toHaveLength(1);
  });

  it("o skeleton de carregamento usa a mesma largura da coluna real — sem isto o board 'pula' quando os dados chegam", () => {
    const src = fs.readFileSync(path.join(RAIZ, "components/kanban/KanbanBoard.tsx"), "utf8");
    // O skeleton tem a MESMA geometria do contêiner real, `max-md:-mx-6` incluso.
    expect(src).toContain(
      'className="flex snap-x snap-mandatory gap-3 overflow-x-auto p-4 max-md:-mx-6 md:snap-none"',
    );
    expect(src).toContain(
      'className="flex w-[85vw] shrink-0 snap-center flex-col gap-2 rounded-lg border border-border bg-surface-muted/40 p-3 md:w-80"',
    );
  });
});
