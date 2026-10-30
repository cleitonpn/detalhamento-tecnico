import { SEMANTIC_ROLES, DESTINATIONS, semanticRoleOf, destinationOf } from "../domain/project.js";
export function benchmarkTemplate(project, reviewer = "") {
  return { contract: "detalha.classification-benchmark", schemaVersion: 1, fileHash: project.file.hash, sourceUnit: project.sourceUnit,
    modelName: project.name, reviewer, annotations: project.parts.map(p => ({ partId: p.id, semanticRole: null, destination: null, notes: "" })) };
}
export function checkBenchmark(value, project) {
  if (value?.contract !== "detalha.classification-benchmark" || value.schemaVersion !== 1 || value.fileHash !== project.file.hash || value.sourceUnit !== project.sourceUnit)
    throw Error("Gabarito incompatível com o arquivo ou a unidade do projeto.");
  if (typeof value.reviewer !== "string" || !value.reviewer.trim() || value.reviewer.length > 180 || !Array.isArray(value.annotations) || value.annotations.length > project.parts.length)
    throw Error("Informe responsável e anotações válidas do gabarito.");
  const parts = new Set(project.parts.map(p => p.id)), seen = new Set();
  for (const a of value.annotations) {
    if (!a || !parts.has(a.partId) || seen.has(a.partId) || a.semanticRole != null && !Object.hasOwn(SEMANTIC_ROLES, a.semanticRole) ||
      a.destination != null && !Object.hasOwn(DESTINATIONS, a.destination) || typeof a.notes !== "string" || a.notes.length > 1200) throw Error("Anotação inválida, duplicada ou peça desconhecida.");
    seen.add(a.partId);
  }
  return value;
}
export function evaluateBenchmark(project, benchmark) {
  checkBenchmark(benchmark, project);
  const parts = new Map(project.parts.map(p => [p.id, p])), rows = [], totals = { semanticRole: { checked: 0, correct: 0 }, destination: { checked: 0, correct: 0 } };
  for (const a of benchmark.annotations) {
    const p = parts.get(a.partId);
    // Não usa a classificação humana atual como previsão automática.
    const automatic = p.auto ? { ...p, review: { kind: p.auto.kind }, auto: p.auto } : null;
    const predicted = automatic ? { semanticRole: semanticRoleOf(automatic), destination: destinationOf(automatic) } : { semanticRole: null, destination: null };
    for (const field of ["semanticRole", "destination"]) if (a[field] != null) {
      totals[field].checked++; const correct = predicted[field] === a[field];
      if (correct) totals[field].correct++;
      rows.push({ partId: p.id, label: p.label, field, expected: a[field], predicted: predicted[field], correct,
        batchConfirmed: p.review?.confirmed === true && p.review.confirmationMethod === "batch" });
    }
  }
  return { fileHash: project.file.hash, reviewer: benchmark.reviewer, totalParts: project.parts.length,
    annotatedParts: new Set(rows.map(r => r.partId)).size, totals, disagreements: rows.filter(r => !r.correct),
    batchDisagreements: rows.filter(r => !r.correct && r.batchConfirmed).length,
    notice: "Resultado apenas sobre campos anotados pelo responsável. Não mede acerto das peças não revisadas, estabilidade nem projetos novos." };
}
