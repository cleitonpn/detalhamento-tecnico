import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("hierarquia seleciona peça sem alterar agrupamento e gabarito mede apenas respostas humanas", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: /Explorar uma demonstração/ }).click();
  await page.locator(".part-row").filter({ hasText: "Parede de fundo" }).click();
  await page.getByRole("button", { name: "Explorar hierarquia do modelo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Hierarquia do modelo", exact: true });
  await expect(dialog.getByRole("tree", { name: "Grupos e malhas da cena" })).toBeVisible();
  await dialog.getByLabel("Buscar grupo, caminho ou peça").fill("Parede de fundo");
  await dialog.locator("button:not(:disabled)").filter({ hasText: "Parede de fundo" }).first().click();
  await expect(page.getByLabel("Nome da peça")).toHaveValue("Parede de fundo");
  await expect(page.locator(".part-row")).toHaveCount(8);
  await page.getByRole("button", { name: "Dados do projeto", exact: true }).click();
  await page.getByRole("button", { name: "Revisar gabarito da classificação", exact: true }).click();
  await page.getByLabel("Responsável pelo gabarito").fill("Gabarito sintético de teste");
  await expect(page.getByLabel("Resultado do gabarito")).toContainText("0/10 peças anotadas");
  await page.getByLabel("Buscar peça no gabarito").fill("Parede de fundo");
  await page.getByRole("combobox", { name: "Identidade esperada — Parede de fundo", exact: true }).selectOption("vegetation");
  await expect(page.getByLabel("Resultado do gabarito")).toContainText("1/10 peças anotadas");
  await expect(page.getByLabel("Resultado do gabarito")).toContainText("automático wall");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar gabarito", exact: true }).click();
  const exported = JSON.parse(await readFile(await (await download).path(), "utf8"));
  expect(exported.annotations.filter(a => a.semanticRole !== null)).toHaveLength(1);
  await page.getByRole("button", { name: "Fechar janela", exact: true }).click();
  await expect(page.getByLabel("Identidade do objeto")).toHaveValue("");
});

test("análise de construção pode ser cancelada e reiniciada sem aplicar hipótese", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: /Explorar uma demonstração/ }).click();
  await page.locator(".part-row").filter({ hasText: "Parede de fundo" }).click();
  await page.route("**/construction/worker.js*", async route => { await new Promise(r => setTimeout(r, 1200)); await route.continue().catch(() => {}); });
  await page.locator(".construction-panel summary").click();
  await page.getByRole("button", { name: "Cancelar análise", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Análise cancelada");
  await expect(page.getByLabel("Receita construtiva", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Reanalisar geometria", exact: true }).click();
  await expect(page.getByLabel("Análise de construção em andamento")).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("aceitar identidade contextual registra evidência, sobrevive à reabertura e pode ser descartada", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: /Explorar uma demonstração/ }).click();
  await page.locator(".part-row").filter({ hasText: "Parede de fundo" }).click();
  await page.getByLabel("O que é esta peça?").selectOption("other");
  await page.getByRole("button", { name: "Usar identidade contextual", exact: true }).click();
  await expect(page.getByLabel("Evidência da identidade contextual")).toContainText("context-3");
  await expect(page.getByText("Salvo neste navegador", { exact: true })).toBeVisible();
  await page.reload(); await page.getByRole("button", { name: "Projetos", exact: true }).click();
  await page.locator(".library-item").first().click(); await page.locator(".part-row").filter({ hasText: "Parede de fundo" }).click();
  await expect(page.getByLabel("Evidência da identidade contextual")).toContainText("contato horizontal verificado");
  await page.getByRole("button", { name: "Descartar evidência contextual, mantendo a identidade", exact: true }).click();
  await expect(page.getByLabel("Identidade do objeto")).toHaveValue("wall");
  await expect(page.getByLabel("Evidência da identidade contextual")).toHaveCount(0);
});
