import test from "node:test";
import assert from "node:assert/strict";
import { benchmarkTemplate, checkBenchmark, evaluateBenchmark } from "../src/lib/classificationBenchmark.js";
const project = { name: "Teste", file: { hash: "a".repeat(64) }, sourceUnit: "m", parts: [
  { id: "p1", label: "Jardim", auto: { kind: "fascia", semanticRole: "fascia" }, review: { kind: "ignore", semanticRole: "vegetation", confirmed: true, confirmationMethod: "batch" } },
  { id: "p2", label: "Sem previsão", review: { kind: "wall" } },
] };
test("gabarito começa vazio e nunca copia a resposta automática ou corrigida", () => {
  const b = benchmarkTemplate(project, "Especialista de teste");
  assert.ok(b.annotations.every(a => a.semanticRole === null && a.destination === null));
  const r = evaluateBenchmark(project, b); assert.equal(r.annotatedParts, 0); assert.equal(r.totals.semanticRole.checked, 0);
});
test("avalia apenas campos anotados e preserva erro automático após correção humana", () => {
  const b = benchmarkTemplate(project, "Especialista de teste"); b.annotations[0].semanticRole = "vegetation";
  const r = evaluateBenchmark(project, b);
  assert.equal(r.annotatedParts, 1); assert.equal(r.totals.semanticRole.checked, 1); assert.equal(r.totals.semanticRole.correct, 0);
  assert.equal(r.batchDisagreements, 1); assert.equal(r.disagreements[0].predicted, "fascia");
  assert.equal(r.totals.destination.checked, 0);
});
test("gabarito de outro arquivo, unidade, rótulo ou IDs duplicados é recusado", () => {
  const b = benchmarkTemplate(project, "Teste");
  for (const value of [{ ...b, fileHash: "b".repeat(64) }, { ...b, sourceUnit: "cm" }, { ...b, reviewer: "" },
    { ...b, annotations: [b.annotations[0], b.annotations[0]] }, { ...b, annotations: [{ ...b.annotations[0], semanticRole: "invented" }] }])
    assert.throws(() => checkBenchmark(value, project));
});
