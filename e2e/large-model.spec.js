import { test, expect } from "@playwright/test";

test("LOTERIAS: upload acima de 50 MB, modo leve, seleção e reabertura", async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.DT_LARGE_GLB_TEST_FILE,
    "GLB de cliente não incorporado ao repositório.",
  );
  test.setTimeout(240000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.dtImageDecodes = 0;
    window.dtContextLosses = 0;
    if (window.createImageBitmap) {
      const decode = window.createImageBitmap;
      window.createImageBitmap = function (...args) {
        window.dtImageDecodes++;
        return decode.apply(this, args);
      };
    }
    document.addEventListener(
      "webglcontextlost",
      () => window.dtContextLosses++,
      true,
    );
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Enviar arquivo .glb", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("Até 200 MB · Arquivos GLB 2.0", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Arquivo GLB", { exact: true })
    .setInputFiles(process.env.DT_LARGE_GLB_TEST_FILE);
  await expect(page.locator(".part-row")).toHaveCount(106, { timeout: 120000 });
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await expect(page.locator(".model-stat")).toContainText("5356 malhas");
  await expect(page.locator(".model-stat")).toContainText(
    "Modo leve (sem texturas)",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("loterias-conjuntos.png"),
    fullPage: true,
  });
  await page
    .locator(".part-row")
    .filter({ hasText: "Poltrona Julia" })
    .first()
    .click();
  await expect(page.locator(".measure-card")).toContainText(
    "2,184 × 0,921 × 0,768",
  );
  await page
    .getByRole("button", { name: "Isolar seleção", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enquadrar seleção", exact: true })
    .click();
  await page.getByRole("button", { name: "Planta", exact: true }).click();
  await page
    .getByLabel("Observações de construção")
    .fill("Revisar componentes deste conjunto.");
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise((resolve, reject) => {
              const open = indexedDB.open("detalha-workspace", 1);
              open.onerror = () => reject(open.error);
              open.onsuccess = () => {
                const db = open.result;
                const request = db
                  .transaction("projects", "readonly")
                  .objectStore("projects")
                  .getAll();
                request.onsuccess = () => {
                  const project = request.result.find(
                    (p) => p.file.bytes > 50 * 1024 * 1024,
                  );
                  resolve(
                    project?.parts.some(
                      (p) =>
                        p.review.notes ===
                        "Revisar componentes deste conjunto.",
                    ) || false,
                  );
                  db.close();
                };
                request.onerror = () => {
                  db.close();
                  reject(request.error);
                };
              };
            }),
        ),
      { timeout: 30000 },
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("loterias-modo-leve.png"),
    fullPage: true,
  });
  expect(await page.evaluate(() => window.dtImageDecodes)).toBe(0);
  expect(await page.evaluate(() => window.dtContextLosses)).toBe(0);

  await page.reload();
  await page.getByRole("button", { name: "Projetos", exact: true }).click();
  await page.locator(".library-item").first().click();
  await expect(page.locator(".part-row")).toHaveCount(106, { timeout: 120000 });
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await expect(page.locator(".model-stat")).toContainText(
    "Modo leve (sem texturas)",
  );
  await page
    .locator(".part-row")
    .filter({ hasText: "Poltrona Julia" })
    .first()
    .click();
  await expect(page.getByLabel("Observações de construção")).toHaveValue(
    "Revisar componentes deste conjunto.",
  );
  expect(await page.evaluate(() => window.dtImageDecodes)).toBe(0);
  expect(await page.evaluate(() => window.dtContextLosses)).toBe(0);
  expect(errors).toEqual([]);
});
