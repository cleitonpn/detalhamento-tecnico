import test from "node:test";
import assert from "node:assert/strict";
import { buildOverview, sheetSvg } from "../src/lib/sheet.js";

const part = (label, dims) => ({
  id: label,
  label,
  dimensions: dims,
  meshIds: [],
  bounds: { min: [0, 0, 0], max: dims },
});
const project = {
  name: "Stand teste",
  revision: 0,
  file: { name: "teste.dwg" },
};

test("vista geral: marcadores numerados como as folhas e legenda das peças", () => {
  const parts = [
    part("Balcão", [2.8, 1, 1.1]),
    part("Poltrona", [0.9, 0.75, 0.9]),
  ];
  const overview = {
    url: "data:image/png;base64,AA==",
    aspect: 4 / 3,
    labels: [
      { n: 1, x: 0.5, y: 0.5 },
      { n: 2, x: 0.25, y: 0.75 },
    ],
  };
  const { items } = buildOverview({ project, parts, overview, preview: true });
  assert.equal(items.filter((i) => i.t === "circle").length, 2);
  const svg = sheetSvg({ items });
  assert.match(svg, /Balcão/);
  assert.match(svg, /280×100×110/);
  assert.match(svg, /PRÉVIA/);
  assert.match(svg, /<image /);
});

test("vista geral sem WebGL avisa em vez de quebrar", () => {
  const { items } = buildOverview({
    project,
    parts: [part("Pilar", [0.1, 3, 0.1])],
    overview: null,
    preview: false,
  });
  assert.match(sheetSvg({ items }), /indisponível/);
});

test("alertas de unidade e geometria acompanham a folha, não apenas a interface", () => {
  const warned = { ...project, importDiagnostics: { source: "cad", warnings: [
    { code: "unit-mismatch", message: "Unidade a conferir" },
    { code: "missing-faces", message: "Faces omitidas" },
  ] } };
  const sheet = buildOverview({ project: warned, parts: [], overview: null, preview: true });
  assert.match(sheetSvg(sheet), /ALERTA DO ARQUIVO: unidade divergente; geometria possivelmente incompleta/);
});

test("cotas em centímetros por padrão e em milímetros quando escolhido", async () => {
  const { fmtLen } = await import("../src/lib/techdraw.js");
  assert.equal(fmtLen(1.612), "161,2");
  assert.equal(fmtLen(0.75), "75");
  assert.equal(fmtLen(0.0171, "cm", true), "1,71");
  assert.equal(fmtLen(1.612, "mm"), "1.612");
  const parts = [part("Balcão", [2.8, 1, 1.1])];
  const cm = sheetSvg(
    buildOverview({ project, parts, overview: null, preview: true }),
  );
  assert.match(cm, /280×100×110/);
  assert.match(cm, /cm \(L×A×P\)/);
  const mm = sheetSvg(
    buildOverview({
      project,
      parts,
      overview: null,
      preview: true,
      unit: "mm",
    }),
  );
  assert.match(mm, /2\.800×1\.000×1\.100/);
});

test("cota em cadeia: passo repetido (brise, ripado) vira uma cota só", async () => {
  const { chainRuns } = await import("../src/lib/techdraw.js");
  // Régua 7,2 + vão 6,5 (passo 13,7) vinte vezes, com sobras nas pontas
  const st = [0, 0.03];
  for (let i = 0; i < 20; i++) st.push(st.at(-1) + 0.072, st.at(-1) + 0.072 + 0.065);
  st.push(st.at(-1) + 0.04);
  const runs = chainRuns(st);
  assert.ok(runs.length <= 4, JSON.stringify(runs));
  const big = runs.find((r) => r.n >= 19);
  assert.ok(big && Math.abs(big.step - 0.137) < 1e-6);
  // Cotas comuns continuam uma por trecho
  assert.equal(chainRuns([0, 0.3, 1, 1.2]).length, 3);
});
