import test from "node:test";
import assert from "node:assert/strict";
import { trainModel, predict, featuresOf } from "../src/lib/auto/learn.js";
import { autoReview } from "../src/lib/auto/index.js";
import catalog from "../src/data/materials.json" with { type: "json" };

// Exemplo de treino sintético (metros), como sampleOf grava
const sample = (o) => ({
  key: Math.random().toString(36),
  project: "Teste",
  label: o.label || "Peça",
  w: 1,
  h: 1,
  d: 0.02,
  y0: 0,
  y1: 1,
  dist: 1,
  standSize: 5,
  tris: 12,
  area: 2,
  text: "",
  small: 0,
  materialId: "",
  finishId: "",
  edited: false,
  ...o,
});
const rnd = (a, b) => a + Math.random() * (b - a);

// Convenção desta equipe: painel baixo (1–1,3 m) que nasce no chão e veste o balcão
// com Bagum é REVESTIMENTO, não parede nem lateral — as regras não sabem disso.
function workspaceHistory(n = 60) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(
      sample({
        label: "Saia do balcão",
        w: rnd(0.8, 2.4),
        h: rnd(1.0, 1.3),
        d: 0.003,
        y1: 1.1,
        text: "BAGUM AREIA",
        kind: "finish",
        materialId: "bagum",
        edited: true,
      }),
      sample({
        label: "Parede",
        w: rnd(1, 6),
        h: rnd(2.4, 4.4),
        d: rnd(0.1, 0.3),
        y1: 3,
        text: "MDF branco",
        kind: "wall",
        materialId: "custo-498",
      }),
      sample({
        label: "Testeira",
        w: rnd(1.5, 5),
        h: rnd(0.3, 1),
        d: rnd(0.02, 0.1),
        y0: rnd(2.5, 4),
        y1: 4,
        kind: "fascia",
        materialId: "custo-499",
      }),
    );
  }
  return out;
}

test("modelo só nasce com exemplos suficientes e mais de um tipo", () => {
  assert.equal(trainModel([]), null);
  assert.equal(trainModel(Array.from({ length: 30 }, () => sample({ kind: "wall" }))), null);
});

test("aprende a convenção da equipe a partir das correções e estima o próprio acerto", () => {
  const model = trainModel(workspaceHistory());
  assert.ok(model, "modelo treinado");
  assert.equal(model.size, 180);
  assert.equal(model.corrections, 60);
  assert.ok(model.accuracy > 0.9, `acerto estimado ${model.accuracy}`);
  // Peça nova, de tamanho que não estava no histórico
  const p = predict(
    model,
    sample({ w: 1.7, h: 1.15, d: 0.003, y1: 1.15, text: "BAGUM AREIA", label: "Peça 88" }),
  );
  assert.equal(p.kind, "finish");
  assert.ok(p.probability > 0.8);
  assert.equal(p.materialId, "bagum"); // material que a equipe usa nessa peça
  assert.equal(p.nearest.label, "Saia do balcão");
  assert.equal(predict(model, sample({ w: 3, h: 0.6, d: 0.05, y0: 3.2, y1: 3.8 })).kind, "fascia");
});

test("o aprendizado corrige a regra na sugestão da peça e explica de onde veio", () => {
  const model = trainModel(workspaceHistory());
  // Peça do projeto novo: chapa de 3 mm, 1,2 m de altura, no chão, com Bagum
  const part = {
    id: "p1",
    label: "Peça 12",
    dimensions: [1.6, 1.2, 0.003],
    bounds: { min: [0, 0, 0], max: [1.6, 1.2, 0.003] },
    materialsOriginal: ["BAGUM AREIA"],
    surface: { tris: 12, area: 3.84 },
    fingerprint: {},
    review: { kind: "unclassified", materialId: "", finishId: "", notes: "", dimensionsConfirmed: false, confirmed: false },
  };
  const floor = {
    ...part,
    id: "piso",
    label: "Piso",
    dimensions: [6, 0.1, 6],
    bounds: { min: [-2, -0.1, -2], max: [4, 0, 4] },
    materialsOriginal: [],
  };
  const [p] = autoReview([part, floor], new Map(), catalog, { model });
  assert.equal(p.auto.kind, "finish");
  assert.match(p.auto.source, /learning/);
  assert.match(p.auto.reasons.join(" "), /Aprendido de 180 peças validadas/);
  assert.equal(p.review.materialId, "bagum");
});

test("treina rápido com milhares de exemplos", () => {
  const many = [];
  for (let i = 0; i < 17; i++) many.push(...workspaceHistory(100));
  const t0 = Date.now();
  const model = trainModel(many);
  const ms = Date.now() - t0;
  assert.equal(model.size, 5100);
  assert.ok(ms < 8000, `${ms} ms`);
  assert.equal(featuresOf(many[0]).length, model.X[0].length);
});
