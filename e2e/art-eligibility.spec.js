import { test, expect } from "@playwright/test";

test("arte prioriza suportes, exige exceção para equipamento e preserva gabarito", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Explorar uma demonstração/ }).click();
  await page.getByRole("button", { name: "Caderno de arte", exact: true }).click();
  const list = page.locator(".export-list");
  await expect(list.getByRole("button", { name: /Parede de fundo/ })).toBeVisible();
  await expect(list.getByRole("button", { name: /Samsung TV/ })).toHaveCount(0);
  await expect(list.getByRole("button", { name: /Pilar/ })).toHaveCount(0);
  await list.getByRole("button", { name: /Parede de fundo/ }).click();
  await expect(page.getByLabel("Folhas do caderno de arte").getByRole("tab", { name: "A", exact: true })).toBeVisible();
  await expect(page.locator(".art-preview .technical-sheet > svg")).toBeVisible();
  await page.getByRole("button", { name: "Escolher face no 3D", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Escolher face no modelo 3D" });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Frente", exact: true }).click();
  const canvas = picker.locator("canvas");
  await expect(canvas).toBeVisible();
  // A parede isolada ocupa o centro da vista frontal; clique real no WebGL.
  await expect(async () => {
    if (await picker.isVisible()) await canvas.click();
    await expect(picker).toHaveCount(0);
  }).toPass({ timeout: 15000 });
  const kinds = page.getByRole("combobox", { name: "Tipo de interferência", exact: true });
  await expect(kinds.first()).toBeVisible();
  const zoneCount = await kinds.count();
  expect(zoneCount).toBeGreaterThan(0);
  expect(await kinds.evaluateAll(nodes => nodes.map(n => n.value))).toEqual(Array(zoneCount).fill("obstruction"));
  await kinds.first().selectOption("cutout");
  await page.getByRole("button", { name: "Detectar", exact: true }).click();
  await expect(kinds).toHaveCount(zoneCount);
  expect(await kinds.evaluateAll(nodes => nodes.map(n => n.value))).toContain("cutout");
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await kinds.last().selectOption("safety");
  await expect(page.locator(".technical-sheet")).toContainText("ÁREA DE SEGURANÇA");
  await expect(page.locator(".technical-sheet")).toContainText("RECORTE");
  await page.screenshot({ path: info.outputPath("superficies-para-arte.png") });
  await page.getByLabel("Mostrar todos os objetos").check();
  await list.getByRole("button", { name: /Samsung TV/ }).click();
  await expect(page.getByRole("button", { name: "Confirmar suporte de arte" })).toBeVisible();
  await expect(page.getByLabel("Folhas do caderno de arte").getByRole("tab", { name: "B", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Confirmar suporte de arte" }).click();
  await expect(page.getByLabel("Folhas do caderno de arte").getByRole("tab", { name: "B", exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Baixar.*PDF/ }).click();
  expect((await download).suggestedFilename()).toMatch(/caderno-de-arte\.pdf$/);
  await page.reload();
  await page.getByRole("button", { name: "Projetos", exact: true }).click();
  await page.locator(".library-item").first().click();
  await page.getByRole("button", { name: "Caderno de arte", exact: true }).click();
  await expect(page.getByLabel("Folhas do caderno de arte").getByRole("tab", { name: "B", exact: true })).toBeVisible();
});

test("identidade e destino do mobiliário ficam independentes após salvar", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Explorar uma demonstração/ }).click();
  await page.locator(".part-row").filter({ hasText: "Balcão" }).click();
  await page.getByLabel("Identidade do objeto").selectOption("furniture");
  await page.getByLabel("Destino da peça").selectOption("furniture");
  await page.getByLabel(/Conferi as medidas/).check();
  await page.getByRole("button", { name: "Validar peça", exact: true }).click();
  await page.getByRole("button", { name: "Caderno técnico", exact: false }).click();
  await expect(page.locator(".drawing-item").filter({ hasText: "Balcão" })).toHaveCount(0);
  await page.getByRole("button", { name: /Voltar à validação/ }).click();
  await page.getByRole("button", { name: "Caderno de arte", exact: true }).click();
  await expect(page.locator(".export-list .export-item").filter({ hasText: "Balcão" })).toHaveCount(0);
  await expect(page.getByText("Salvo neste navegador", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Projetos", exact: true }).click();
  await page.locator(".library-item").first().click();
  await page.locator(".part-row").filter({ hasText: "Balcão" }).click();
  await expect(page.getByLabel("Identidade do objeto")).toHaveValue("furniture");
  await expect(page.getByLabel("Destino da peça")).toHaveValue("furniture");
});

test("painel distingue proximidade de contato horizontal sem prometer capacidade estrutural", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Explorar uma demonstração/ }).click();
  await expect(page.locator(".part-row").first()).toBeVisible({ timeout: 20000 });
  await page.locator(".part-row").filter({ hasText: "Parede de fundo" }).click();
  await expect(page.getByLabel("Relações espaciais")).toBeVisible();
  await expect(page.getByLabel("Relações espaciais")).toContainText("não verifica suporte estrutural");
});
