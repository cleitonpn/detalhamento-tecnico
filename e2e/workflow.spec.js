import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("validação humana, revisão, PDF e persistência local", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: /Explorar uma demonstração/ }).click();
  await expect(page.locator(".part-row")).toHaveCount(10);
  await page.screenshot({
    path: testInfo.outputPath("modelo.png"),
    fullPage: true,
  });
  const rows = page.locator(".part-row");
  const count = await rows.count();
  // Confirmações e medidas explícitas para os tipos da demonstração.
  for (let i = 0; i < count; i++) {
    await rows.nth(i).click();
    const label = await rows.nth(i).innerText();
    const kind = /Pilar/.test(label)
      ? "metalon"
      : /Parede/.test(label)
        ? "wall"
        : /Testeira/.test(label)
          ? "fascia"
          : /Piso/.test(label)
            ? "floor"
            : /Balcão/.test(label)
              ? "furniture"
              : "equipment";
    await page.getByLabel("O que é esta peça?").selectOption(kind);
    if (["wall", "fascia"].includes(kind))
      await page
        .getByLabel("Material de construção", { exact: true })
        .selectOption("custo-492");
    if (kind === "floor")
      await page
        .getByLabel("Material de construção", { exact: true })
        .selectOption("custo-498");
    if (kind === "metalon") {
      await expect(page.getByRole("spinbutton")).toHaveCount(0);
      await expect(page.locator(".measure-card")).toContainText(
        "0,10 × 3,00 × 0,10",
      );
    }
    await page.getByLabel(/Conferi as medidas/).check();
    await page
      .getByRole("button", { name: "Validar peça", exact: true })
      .click();
  }
  await expect(page.locator(".progress-summary")).toContainText("10/10");
  await page
    .getByRole("button", { name: "Caderno técnico", exact: false })
    .click();
  await page.locator(".drawing-item").filter({ hasText: "Pilar 1" }).click();
  await expect(page.locator(".paper-specs")).toContainText("Metalon");
  await expect(page.locator(".paper-specs")).not.toContainText("mm");
  await page.getByRole("button", { name: "Registrar revisão" }).click();
  await expect(
    page.getByText("Revisão 1 registrada", { exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Pacote para integração" }).click();
  const download = await downloadPromise;
  const file = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(file.parts).toHaveLength(10);
  expect(file.constructionRelease).toBe(false);
  for (const part of file.parts.filter((p) => p.review.kind === "metalon")) {
    expect(part.dimensions[0]).toBeCloseTo(0.1);
    expect(part.dimensions[1]).toBeCloseTo(3);
    expect(part.dimensions[2]).toBeCloseTo(0.1);
    expect(part.review.profileWidthMm).toBeUndefined();
    expect(part.review.profileHeightMm).toBeUndefined();
    expect(part.review.wallThicknessMm).toBeUndefined();
  }
  await page.screenshot({
    path: testInfo.outputPath("caderno.png"),
    fullPage: true,
  });
  const pdfPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar caderno PDF" }).click();
  const pdf = await pdfPromise;
  const pdfBytes = await readFile(await pdf.path());
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdfBytes.length).toBeGreaterThan(5000);
  await pdf.saveAs(testInfo.outputPath("caderno-demo.pdf"));
  await page.reload();
  await page.getByRole("button", { name: "Projetos", exact: true }).click();
  await page.locator(".library-item").first().click();
  await expect(page.locator(".progress-summary")).toContainText("10/10");
  await expect(page.getByLabel("Nome do projeto")).toHaveValue(
    "Stand demonstrativo",
  );
  await page
    .getByRole("button", { name: "Caderno técnico", exact: false })
    .click();
  await expect(
    page.getByText("Revisão 1 registrada", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Baixar caderno PDF" }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

test("GLB real ECBR: balcão e quatro testeiras preservam as medidas", async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.DT_GLB_TEST_FILE,
    "Arquivo de cliente não incorporado ao repositório.",
  );
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Enviar arquivo .glb" }),
  ).toBeEnabled();
  await page
    .getByLabel("Arquivo GLB", { exact: true })
    .setInputFiles(process.env.DT_GLB_TEST_FILE);
  await expect(page.locator(".part-row").first()).toBeVisible({
    timeout: 45000,
  });
  await expect(page.locator(".model-stat")).toContainText("808 malhas");
  const counter = page.locator(".part-row").filter({ hasText: "BALCÃO 2M" });
  await counter.click();
  await expect(page.locator(".measure-card")).toContainText(
    "2,00 × 1,00 × 0,53",
  );
  const fascia = page
    .locator(".part-row")
    .filter({ hasText: "3,00 × 1,00 × 0,03" });
  await expect(fascia).toHaveCount(4);
  await page
    .getByRole("button", { name: "Enquadrar seleção", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Isolar seleção", exact: true })
    .click();
  await page.getByRole("button", { name: "Planta", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("ecbr-balcao.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("validação também fica acessível em tela pequena", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Explorar uma demonstração/ }).click();
  await expect(page.locator(".part-row")).toHaveCount(10);
  await page.locator(".part-row").filter({ hasText: "Balcão" }).click();
  await expect(page.getByLabel("O que é esta peça?")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("uma parede requer material, medidas e confirmação; alteração invalida a peça", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Explorar uma demonstração/ }).click();
  await expect(page.locator(".part-row")).toHaveCount(10);
  await page
    .locator(".part-row")
    .filter({ hasText: "Parede de fundo" })
    .click();
  await page.getByLabel("O que é esta peça?").selectOption("wall");
  await expect(
    page.getByRole("button", { name: "Validar peça", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Material de construção", { exact: true })
    .selectOption("custo-492");
  await page.getByLabel(/Conferi as medidas/).check();
  await page.getByRole("button", { name: "Validar peça", exact: true }).click();
  await expect(page.locator(".progress-summary")).toContainText("1/10");
  await page
    .getByLabel("Observações de construção")
    .fill("Reforços a conferir");
  await expect(page.locator(".progress-summary")).toContainText("0/10");
  await page.screenshot({
    path: testInfo.outputPath("validacao.png"),
    fullPage: true,
  });
});
