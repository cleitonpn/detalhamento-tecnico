import test from "node:test";
import assert from "node:assert/strict";
import { buildOverview, sheetSvg } from "../src/lib/sheet.js";

const part = (label, dims) => ({ id: label, label, dimensions: dims, meshIds: [], bounds: { min: [0, 0, 0], max: dims } });
const project = { name: "Stand teste", revision: 0, file: { name: "teste.dwg" } };

test("vista geral: marcadores numerados como as folhas e legenda das peças", () => {
  const parts = [part("Balcão", [2.8, 1, 1.1]), part("Poltrona", [0.9, 0.75, 0.9])];
  const overview = { url: "data:image/png;base64,AA==", aspect: 4 / 3, labels: [{ n: 1, x: 0.5, y: 0.5 }, { n: 2, x: 0.25, y: 0.75 }] };
  const { items } = buildOverview({ project, parts, overview, preview: true });
  assert.equal(items.filter((i) => i.t === "circle").length, 2);
  const svg = sheetSvg({ items });
  assert.match(svg, /Balcão/);
  assert.match(svg, /2\.800×1\.000×1\.100/);
  assert.match(svg, /PRÉVIA/);
  assert.match(svg, /<image /);
});

test("vista geral sem WebGL avisa em vez de quebrar", () => {
  const { items } = buildOverview({ project, parts: [part("Pilar", [0.1, 3, 0.1])], overview: null, preview: false });
  assert.match(sheetSvg({ items }), /indisponível/);
});
