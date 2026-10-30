import test from "node:test";
import assert from "node:assert/strict";
import { autoReview, acceptGreen, greenPending, trainingSamples, memoryEntries } from "../src/lib/auto/index.js";
import { classifyPart, standContext } from "../src/lib/auto/rules.js";
import { sampleOf } from "../src/lib/auto/learn.js";
import catalog from "../src/data/materials.json" with { type: "json" };

const part = (label, dimensions, y = 0, extra = {}) => ({
  id: "p", label, dimensions,
  bounds: { min: [0, y, 0], max: [dimensions[0], y + dimensions[1], dimensions[2]] },
  materialsOriginal: [], meshIds: ["mesh"],
  fingerprint: { exact: "0123456789abc" },
  review: { kind: "unclassified", materialId: "", finishId: "", confirmed: false, dimensionsConfirmed: false },
  ...extra,
});
const ctx = { floorY: 0, outliers: new Set(), distance: new Map(), size: 5, center: [0, 0] };

test("jardim elevado não vira testeira; mobiliário ripado não vira arte", () => {
  const garden = classifyPart(part("JARDIM VERTICAL", [3, 0.6, 0.1], 2.5), ctx);
  assert.equal(garden.kind, "ignore");
  assert.equal(garden.semanticRole, "vegetation");
  const chair = classifyPart(part("Poltrona", [0.8, 0.8, 0.7], 0, {
    shape: { parts: 10, main: 0.1, front: 0.3, top: 0.4, trisPerPart: 200 },
  }), ctx);
  assert.equal(chair.semanticRole, "furniture");
  assert.doesNotMatch(chair.reasons.join(" "), /ícones|Arte/);
  assert.match(chair.reasons[0], /Confirme/);
});

test("parede em caixa mantém identificação, mas não inventa MDF nem confiança de material", () => {
  const [p] = autoReview([part("Parede", [3, 3, 0.1])], new Map(), catalog);
  assert.equal(p.review.kind, "wall");
  assert.equal(p.auto.materialId, "");
  assert.equal(p.review.materialId, "");
  assert.ok(p.auto.scores.type >= 0.85);
  assert.equal(p.auto.scores.material, null);
  assert.equal(p.auto.scores.construction, null);
  assert.notEqual(p.auto.level, "green");
  assert.doesNotMatch(p.auto.reasons.join(" "), /MDF 15/);
});

test("nome automático não reforça regras nem texto de treinamento após reabrir", () => {
  const input = part("Peça 12", [3, 3, 0.1]);
  const [first] = autoReview([input], new Map(), catalog);
  const [again] = autoReview([JSON.parse(JSON.stringify(first))], new Map(), catalog);
  assert.equal(first.auto.scores.type, again.auto.scores.type);
  const sample = sampleOf(again, standContext([again]));
  assert.doesNotMatch(sample.text, /Parede/);
  const edited = sampleOf({ ...again, label: "Parede confirmada pelo projetista" }, standContext([again]));
  assert.match(edited.text, /Parede confirmada/);
});

test("lote exige medidas conferidas e não vira fonte de treino ou memória", () => {
  const raw = part("Metalon", [0.04, 3, 0.04]);
  const [p] = autoReview([raw], new Map(), catalog);
  assert.equal(p.auto.level, "green");
  assert.equal(greenPending({ parts: [p] }), 0);
  assert.equal(acceptGreen({ parts: [p] }).count, 0);
  const ready = { ...p, review: { ...p.review, dimensionsConfirmed: true } };
  const done = acceptGreen({ id: "test", parts: [ready] });
  assert.equal(done.count, 1);
  assert.equal(done.project.parts[0].review.confirmationMethod, "batch");
  assert.deepEqual(trainingSamples(done.project, done.project.parts), []);
  assert.deepEqual(memoryEntries(done.project.parts), []);
});

test("conflito de memória usa identificação forte mesmo sem material conhecido", () => {
  const input = part("Parede", [3, 3, 0.1]);
  const memory = new Map([[input.fingerprint.exact, { kind: "equipment", materialId: "", label: "TV", n: 1 }]]);
  const [p] = autoReview([input], memory, catalog);
  assert.notEqual(p.auto.level, "green");
  assert.ok(p.auto.conflicts.length);
});

test("projeto antigo confirmado conserva decisão e material após evolução das regras", () => {
  const old = part("Parede antiga", [3, 3, 0.1]);
  old.review = { ...old.review, kind: "wall", materialId: "custo-498", confirmed: true, dimensionsConfirmed: true };
  assert.deepEqual(autoReview([old], new Map(), catalog)[0], old);
});

test("trocar sugestão preserva a decisão anterior e não duplica histórico ao recalcular", () => {
  const p = part("Parede", [3, 3, 0.1]);
  p.auto = { kind: "wall", materialId: "custo-498", finishId: "", source: "rules", confidence: 0.85, reasons: ["Padrão antigo MDF 15 mm"] };
  p.review = { ...p.review, kind: "wall", materialId: "custo-498" };
  const [next] = autoReview([p], new Map(), catalog);
  assert.equal(next.review.materialId, "");
  assert.equal(next.decisionHistory.length, 1);
  assert.equal(next.decisionHistory[0].materialId, "custo-498");
  assert.deepEqual(p.auto.reasons, ["Padrão antigo MDF 15 mm"]);
  const [again] = autoReview([next], new Map(), catalog);
  assert.equal(again.decisionHistory.length, 1);
});
