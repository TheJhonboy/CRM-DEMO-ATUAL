import { expect, test, type Page } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

/**
 * CONECTAR O INSTAGRAM, NA TELA — o que a pessoa vê e consegue fazer, em celular e PC.
 *
 * ─── O que esta spec prova (e o que NÃO prova) ──────────────────────────────
 *
 * Prova, medindo em Chromium a 390x844 e 1440x900:
 *   1. a página carrega e diz "Não conectado" — sem fingir saúde — com a
 *      consequência escrita;
 *   2. os campos são preenchíveis e o botão de conectar é alcançável POR TECLADO;
 *   3. nada transborda na horizontal (geometria, não presença: elemento cortado
 *      continua "visível" para o Playwright, então a régua é `scrollWidth`);
 *   4. alvos de toque >= 44 px no celular;
 *   5. um token que a Meta não aceita NÃO deixa o canal "conectado": a tela mostra
 *      o erro e continua em "Não conectado" (vale tanto com a Meta recusando quanto
 *      com a instalação sem acesso à rede — nos dois casos nada pode ser gravado).
 *
 * NÃO prova a conexão bem-sucedida: isso exige um token real da Meta. O caminho
 * feliz (grava cifrado, não devolve segredo, isola organizações) é coberto pelos
 * testes unitários de `canal-instagram-conectar` com a Graph simulada.
 */

const CELULAR = { width: 390, height: 844 };
const PC = { width: 1440, height: 900 };
const ROTA = "/app/settings/canal-instagram";

async function abrir(page: Page): Promise<void> {
  await loginComoAdmin(page, lerCreds());
  await page.goto(ROTA);
  await expect(page.getByRole("heading", { level: 1, name: /instagram/i })).toBeVisible();
  // O estado só é afirmado depois de a leitura terminar: "Verificando…" não conta.
  await expect(page.getByText("Não conectado", { exact: true })).toBeVisible({ timeout: 15_000 });
}

async function semRolagemHorizontal(page: Page): Promise<void> {
  const medida = await page.evaluate(() => ({
    documento: document.documentElement.scrollWidth,
    janela: document.documentElement.clientWidth,
    corpo: document.body.scrollWidth,
  }));
  expect(medida.documento, "a página rola na horizontal").toBeLessThanOrEqual(medida.janela);
  expect(medida.corpo, "o corpo é mais largo que a janela").toBeLessThanOrEqual(medida.janela);
}

test.describe("Conexão do Instagram", () => {
  test("PC 1440x900: mostra 'não conectado', passo a passo e formulário sem transbordar", async ({
    page,
  }) => {
    await page.setViewportSize(PC);
    await abrir(page);

    await expect(page.getByTestId("aviso-nao-conectado")).toContainText(/nenhuma mensagem/i);
    await expect(page.getByText("Passo a passo")).toBeVisible();
    await expect(page.getByLabel("ID da conta do Instagram")).toBeVisible();
    await expect(page.getByLabel("Token de acesso")).toBeVisible();
    await expect(page.getByLabel("Segredo do app")).toBeVisible();
    // Sem conexão não há o que testar, nem URL a copiar.
    await expect(page.getByRole("button", { name: /testar conexão/i })).toHaveCount(0);
    await semRolagemHorizontal(page);
  });

  test("celular 390x844: sem rolagem horizontal e alvos de toque de 44 px", async ({ page }) => {
    await page.setViewportSize(CELULAR);
    await abrir(page);
    await semRolagemHorizontal(page);

    for (const alvo of [
      page.getByLabel("ID da conta do Instagram"),
      page.getByLabel("Token de acesso"),
      page.getByLabel("Segredo do app"),
      page.getByRole("button", { name: "Conectar" }),
    ]) {
      await alvo.scrollIntoViewIfNeeded();
      const caixa = await alvo.boundingBox();
      expect(caixa, "elemento sem geometria").not.toBeNull();
      expect(caixa!.height, "alvo de toque abaixo de 44 px").toBeGreaterThanOrEqual(44);
      expect(caixa!.x + caixa!.width, "elemento passa da borda direita").toBeLessThanOrEqual(
        CELULAR.width,
      );
    }
  });

  test("teclado: dá para preencher e chegar ao botão de conectar sem mouse", async ({ page }) => {
    await page.setViewportSize(CELULAR);
    await abrir(page);

    const botao = page.getByRole("button", { name: "Conectar" });
    await expect(botao).toBeDisabled();

    await page.getByLabel("ID da conta do Instagram").focus();
    await page.keyboard.type("17841400000000001");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Token de acesso")).toBeFocused();
    await page.keyboard.type("EAAB_token_de_teste_que_a_meta_nao_conhece_0123456789");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Segredo do app")).toBeFocused();
    await page.keyboard.type("segredo_de_teste_0123456789");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Nome de exibição (opcional)")).toBeFocused();
    await page.keyboard.press("Tab");

    await expect(botao).toBeEnabled();
    await expect(botao).toBeFocused();
  });

  test("token que a Meta não aceita: erro visível e o canal continua 'não conectado'", async ({
    page,
  }) => {
    await page.setViewportSize(PC);
    await abrir(page);

    await page.getByLabel("ID da conta do Instagram").fill("17841400000000001");
    await page.getByLabel("Token de acesso").fill("EAAB_token_de_teste_que_a_meta_nao_conhece_0123456789");
    await page.getByLabel("Segredo do app").fill("segredo_de_teste_0123456789");
    await page.getByRole("button", { name: "Conectar" }).click();

    await expect(page.getByTestId("erro-conectar")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Não conectado", { exact: true })).toBeVisible();
    await expect(page.getByText("Conectado", { exact: true })).toHaveCount(0);
    // O erro não ecoa o que foi colado.
    await expect(page.getByTestId("erro-conectar")).not.toContainText("EAAB_token_de_teste");
    await semRolagemHorizontal(page);
  });
});
