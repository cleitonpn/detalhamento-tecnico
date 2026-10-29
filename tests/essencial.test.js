import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { partitionScene } from "../src/lib/model.js";
import {
  classifyPart,
  standContext,
  plausible,
} from "../src/lib/auto/rules.js";
import { autoReview } from "../src/lib/auto/index.js";
import { isLibraryCode } from "../src/lib/auto/fingerprint.js";
import { sheetParts } from "../src/lib/drawings.js";
import catalog from "../src/data/materials.json" with { type: "json" };

// Monta uma peça (grupo) com várias caixas [w, h, d, x, y, z] em metros
const box = ([w, h, d, x, y, z]) =>
  new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d).translate(x + w / 2, y + h / 2, z + d / 2),
    new THREE.MeshStandardMaterial({ name: "Padrão" }),
  );
// Letra "curva": cilindro fino com muitas faces (contorno curvo)
const letter = (x, y, r) =>
  new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, 0.015, 64)
      .rotateX(Math.PI / 2)
      .translate(x + r, y + r, 0.0075),
    new THREE.MeshStandardMaterial({ name: "Acrílico" }),
  );
function scene(groups) {
  const root = new THREE.Group();
  for (const [name, meshes, at = [0, 0, 0]] of groups) {
    const g = new THREE.Group();
    g.name = name;
    meshes.forEach((m) => g.add(m));
    g.position.set(...at);
    root.add(g);
  }
  return partitionScene(root, "m").parts;
}
const STAND = [
  ["Piso", [box([6, 0.1, 6, 0, -0.1, 0])]],
  ["Peça P", [box([6, 3, 0.1, 0, 0, 0])]],
];

test("logo em letras 3D, arte com ícones e mesa sobre pés ficam fora; balcão fechado entra", () => {
  const letters = Array.from({ length: 6 }, (_, i) => letter(i * 0.3, 0, 0.08));
  // Ícones de contorno curvo espalhados (um tubo seria uma caixa de 12 faces)
  const icons = Array.from({ length: 8 }, (_, i) =>
    letter((i % 4) * 0.6, Math.floor(i / 4) * 0.9, 0.03),
  );
  const table = [
    box([1.4, 0.03, 1.4, 0, 0.72, 0]), // tampo
    ...[0, 1.35].flatMap((x) =>
      [0, 1.35].map((z) => box([0.05, 0.72, 0.05, x, 0, z])),
    ), // pés
  ];
  const counter = [box([2, 1.05, 0.6, 0, 0, 0])];
  const parts = scene([
    ...STAND,
    ["Peça L", letters, [1, 2.5, 0.1]],
    ["Peça A", icons, [1, 1, 0.1]],
    ["Peça M", table, [2, 0, 2]],
    ["Peça B", counter, [3, 0, 4]],
  ]);
  const ctx = standContext(parts);
  const of = (label) =>
    classifyPart(
      parts.find((p) => p.label === label),
      ctx,
    );
  const logo = of("Peça L");
  assert.equal(logo.kind, "ignore");
  assert.match(logo.reasons[0], /Letras ou logo em 3D/);
  const art = of("Peça A");
  assert.equal(art.kind, "ignore");
  assert.match(art.reasons[0], /Arte ou ícones|Letras ou logo/); // comunicação visual
  const mesa = of("Peça M");
  assert.equal(mesa.kind, "ignore");
  assert.match(mesa.reasons[0], /Mesa/);
  assert.equal(of("Peça B").kind, "furniture"); // balcão: frente fechada
});

test("leitura da forma: partes soltas e preenchimento da face", () => {
  const [plate] = scene([["Chapa", [box([1, 1, 0.02, 0, 0, 0])]]]);
  assert.equal(plate.shape.parts, 1);
  assert.ok(plate.shape.main > 0.9);
  // Duas peças na cena (uma peça sozinha é aberta em suas malhas)
  const [, logo] = scene([
    ["Chapa", [box([1, 1, 0.02, 0, 0, 0])]],
    ["Logo", Array.from({ length: 5 }, (_, i) => letter(i * 0.3, 0, 0.05))],
  ]);
  assert.equal(logo.shape.parts, 5);
  assert.ok(logo.shape.main < 0.55, `${logo.shape.main}`);
  assert.ok(logo.shape.trisPerPart > 150);
});

test("código de biblioteca é item pronto; nome automático não é", () => {
  assert.ok(isLibraryCode("CENNO_M0001473_000"));
  assert.ok(isLibraryCode("MDD7010.dwg"));
  assert.ok(!isLibraryCode("Box193494"));
  assert.ok(!isLibraryCode("piso00501"));
  assert.ok(!isLibraryCode("Balcão Recepção"));
});

test("sugestão implausível volta para as regras (TV de 14 cm)", () => {
  const parts = scene([
    ...STAND,
    ["Peça S", [box([0.08, 0.14, 0.07, 1, 1.5, 0.1])]],
  ]);
  const small = parts.find((p) => p.label === "Peça S");
  assert.ok(!plausible("equipment", small));
  // Memória antiga dizendo "TV" para essa peça (só pelas medidas)
  const memory = new Map([
    [
      small.fingerprint.size,
      { kind: "equipment", materialId: "", finishId: "", n: 3 },
    ],
  ]);
  const out = autoReview(parts, memory, catalog).find((p) => p.id === small.id);
  assert.notEqual(out.auto.kind, "equipment");
});

test("caderno técnico só com o essencial: TV, iluminação e itens fora não entram", () => {
  const mk = (id, kind) => ({
    id,
    label: id,
    meshIds: [id],
    fingerprint: { exact: id },
    review: { kind, confirmed: true, materialId: "", finishId: "" },
  });
  const sheets = sheetParts({
    parts: [
      mk("parede", "wall"),
      mk("tv", "equipment"),
      mk("spot", "light"),
      mk("logo", "ignore"),
      mk("balcao", "furniture"),
    ],
  });
  assert.deepEqual(sheets.map((s) => s.id).sort(), ["balcao", "parede"]);
});

test("quadro de metalon feito de tubos não é arte, mesmo vazado", () => {
  // Moldura 1 × 2,4 m de tubos 4 × 4 cm: 4 partes, quase nada da face preenchida
  const frame = [
    box([0.04, 2.4, 0.04, 0, 0, 0]),
    box([0.04, 2.4, 0.04, 0.96, 0, 0]),
    box([0.92, 0.04, 0.04, 0.04, 0, 0]),
    box([0.92, 0.04, 0.04, 0.04, 2.36, 0]),
    box([0.92, 0.04, 0.04, 0.04, 1.2, 0]),
  ];
  const parts = scene([...STAND, ["Peça Q", frame, [2, 0, 1]]]);
  const q = parts.find((p) => p.label === "Peça Q");
  const r = classifyPart(q, standContext(parts));
  assert.notEqual(r.kind, "ignore", r.reasons.join(" "));
});

test("peça com o nome da marca do cliente é o logo", async () => {
  const { brandOf, brandMatch } = await import("../src/lib/auto/rules.js");
  assert.equal(brandOf("Lintec"), "lintec");
  assert.ok(brandMatch("LINTECH", "lintec"));
  assert.ok(!brandMatch("Parede", "lintec"));
  assert.equal(brandOf("FAZZUP-BASE - Copia"), "fazzup");
});
