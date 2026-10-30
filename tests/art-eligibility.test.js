import test from "node:test";
import assert from "node:assert/strict";
import { artEligibility } from "../src/lib/artEligibility.js";
import { destinationOf, semanticRoleOf, partIssues, checkImportWarnings, updateParts } from "../src/domain/project.js";
import { sheetParts } from "../src/lib/drawings.js";
import { groupIdentical, memoryEntries, trainingSamples } from "../src/lib/auto/index.js";
import { importDiagnostics, importNotice } from "../src/lib/importDiagnostics.js";

const part = (kind, extra = {}) => ({ id: "p", label: "Objeto", meshIds: ["mesh"],
  dimensions: [2, 3, 0.1], fingerprint: { exact: "same" },
  review: { kind, confirmed: true, dimensionsConfirmed: true, materialId: "mdf", finishId: "" }, ...extra });

test("candidatos a arte distinguem suporte de mobiliário, vegetação, logo e equipamento", () => {
  for (const kind of ["wall", "fascia", "furniture"]) assert.equal(artEligibility(part(kind)).candidate, true);
  for (const role of ["furniture", "vegetation", "logo", "equipment", "light", "floor"]) {
    const p = part("other"); p.review.semanticRole = role;
    assert.equal(artEligibility(p).candidate, false, role);
    assert.equal(artEligibility(p).blocked, false, "exceções físicas são possíveis");
  }
});

test("luz virtual fica bloqueada mesmo se classificada erroneamente como parede", () => {
  const p = part("wall", { label: "Enscape.PointLight#1" });
  assert.equal(artEligibility(p).blocked, true);
});

test("identidade não se perde ao mudar destino e destino governa o caderno", () => {
  const p = part("other");
  p.review = { ...p.review, semanticRole: "furniture", destination: "furniture" };
  assert.equal(semanticRoleOf(p), "furniture");
  assert.equal(destinationOf(p), "furniture");
  assert.equal(sheetParts({ parts: [p] }).length, 0);
  const q = { ...p, review: { ...p.review, destination: "technical" } };
  assert.equal(sheetParts({ parts: [q] }).length, 1);
  assert.equal(semanticRoleOf(q), "furniture");
  assert.equal(groupIdentical([p, q]).length, 2, "destinos diferentes não se fundem");
  assert.deepEqual(memoryEntries([p, q]), [], "modelo legado não aprende rótulo incompleto de exceções");
  assert.deepEqual(trainingSamples({ parts: [] }, [p, q]), []);
});

test("projetos antigos conservam o destino técnico/excluído sem migração", () => {
  assert.equal(destinationOf(part("wall")), "technical");
  assert.equal(destinationOf(part("ignore")), "excluded");
  assert.equal(sheetParts({ parts: [part("equipment")] }).length, 0);
  assert.equal(semanticRoleOf(part("furniture", { auto: { semanticRole: "furniture" } })), "counter");
  assert.equal(artEligibility(part("furniture", { auto: { semanticRole: "furniture" } })).candidate, true);
});

test("destino pendente ou contraditório e vocabulário inválido impedem confirmar", () => {
  const p = part("ignore");
  p.review.destination = "technical";
  assert.match(partIssues(p).join(" "), /tipo técnico/);
  p.review.destination = "pending";
  assert.match(partIssues(p).join(" "), /destino/);
  p.review.destination = "invalid";
  assert.match(partIssues(p).join(" "), /Destino inválido/);
});

test("alertas de arquivo persistem, exigem conferência técnica e constam no aviso de documento", () => {
  const diagnostics = importDiagnostics({ dtCad: { unitMismatch: true, solidFacesSkipped: 2, solidReadFailures: 1 } });
  assert.equal(diagnostics.warnings.length, 3);
  assert.doesNotThrow(() => checkImportWarnings(diagnostics.warnings));
  const p = part("wall", { importWarnings: diagnostics.warnings });
  assert.match(partIssues(p).join(" "), /alertas/);
  const project = updateParts({ parts: [p] }, ["p"], { review: { importReviewed: true } });
  assert.deepEqual(partIssues(project.parts[0]), []);
  assert.equal(project.parts[0].review.confirmed, false);
  assert.match(importNotice({ importDiagnostics: diagnostics }), /unidade divergente; geometria possivelmente incompleta/);
  assert.equal(importNotice({}), "");
  assert.deepEqual(importDiagnostics({ dtSkp: { failed: 0 } }).warnings, []);
  assert.throws(() => checkImportWarnings([{ code: "arbitrary", message: "x" }]), /inválidos/);
});
