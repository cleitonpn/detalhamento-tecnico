import { test, expect } from "@playwright/test";
import { basename } from "node:path";

// Opt-in: caminhos locais autorizados, sem incorporar arquivos de clientes no Git.
const paths = JSON.parse(process.env.DT_MODEL_TEST_FILES || "[]");
for (const [i, path] of paths.entries()) {
  test(`modelo autorizado ${i + 1}: importação, seleção e evidências`, async ({ page }, info) => {
    test.setTimeout(180000);
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Enviar modelo (.skp, .dwg ou .glb)" })).toBeEnabled();
    await page.getByLabel("Arquivo do modelo (SKP, GLB, DWG, DXF ou ZIP)", { exact: true }).setInputFiles(path);
    const rows = page.locator(".part-row");
    await expect(rows.first()).toBeVisible({ timeout: 120000 });
    await rows.first().click();
    await expect(page.locator(".measure-card")).toBeVisible();
    await expect(page.locator(".suggestion.auto")).toContainText("evidência de tipo");
    await expect(page.locator(".suggestion.auto")).toContainText("não é uma probabilidade");
    if (/ODEEN|RIPADO/i.test(basename(path))) {
      await expect(page.getByLabel("Alertas da importação")).toBeVisible();
      await page.locator(".part-row").filter({ hasText: "Parede" }).first().click();
      await expect(page.getByLabel("Conferi os alertas do arquivo e a geometria das peças selecionadas.")).not.toBeChecked();
    }
    if (/Lintec/i.test(basename(path))) {
      await page.getByRole("button", { name: "Caderno de arte", exact: true }).click();
      await expect(page.locator(".export-list")).not.toContainText("Enscape.PointLight");
      await page.getByLabel("Mostrar todos os objetos").check();
      await expect(page.locator(".export-item").filter({ hasText: "Enscape.PointLight" }).first()).toBeDisabled();
      await page.getByRole("button", { name: /Voltar à validação/ }).click();
    }
    await page.screenshot({ path: info.outputPath("importacao.png") });
    expect(errors, basename(path)).toEqual([]);
  });
}
