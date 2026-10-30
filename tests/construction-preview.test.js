import test from "node:test";
import assert from "node:assert/strict";
import { constructionPreview, CONSTRUCTION_PREVIEW_VERSION } from "../src/lib/construction/preview.js";
import { checkConstructionProposal, BUILTIN_RECIPES, assessConstruction, checkConstructionRecipes } from "../functions/construction.js";

const approval = { approved: true, source: "Ficha sintética para teste", approvedBy: "Testes", approvedAt: "2026-10-30" };
const layout = { kind: "vertical-studs", spacingMeaning: "maximum-axis-distance", clearanceMeaning: "both-path-ends", heightMeaning: "reference-axis-length" };
const material = { id: "perfil", version: 1, name: "Perfil de teste", family: "timber-profile", parameters: { sectionWidthMm: 30, sectionHeightMm: 40 }, ...approval };
const sheet = { id: "chapa", version: 1, name: "Chapa de teste", family: "rigid-sheet", parameters: { thicknessMm: 9 }, ...approval };
const recipe = { ...structuredClone(BUILTIN_RECIPES[0]), version: 2, layout, ...approval };
function fixture() {
  const part = { id: "parede", label: "Parede", dimensions: [3, 3, .1], review: { kind: "wall" } };
  const proposal = { schemaVersion: 1, recipeId: recipe.id, recipeVersion: 2,
    layers: { structure: { id: material.id, version: 1 }, substrate: { id: sheet.id, version: 1 } },
    parameters: { heightM: 3, widthM: 3, spacingM: .5, clearanceM: .05, lossRatio: .1 }, referenceArc: null,
    referenceLine: { id: "L1", representsSurface: true }, structureSurveyed: true, geometryVersion: "triangle-sections-2", previewVersion: CONSTRUCTION_PREVIEW_VERSION };
  const geometry = { kind: "planar-candidate", methodVersion: "triangle-sections-2", surfaceSections: { kind: "prismatic-candidate", lines: [{ id: "L1", lengthM: 3, points: [[0, 0], [3, 0]] }] } };
  const assessment = assessConstruction(proposal, { part, catalog: [material, sheet], recipes: [recipe], geometry });
  return { part, proposal, geometry, assessment };
}
test("receita aprovada gera eixos separados, folgas e espaçamento máximo explícitos", () => {
  const f = fixture(), result = constructionPreview(f.part, f.proposal, f.assessment, f.geometry);
  assert.equal(result.status, "reference-only");
  assert.equal(result.members.length, 7);
  assert.equal(result.quantities.axisLengthM, 21);
  assert.ok(Math.abs(result.members[0].start[0] - .05) < 1e-8);
  assert.ok(Math.abs(result.members.at(-1).start[0] - 2.95) < 1e-8);
  assert.ok(result.quantities.actualSpacingM <= .5);
  assert.equal(result.quantities.proposedOnly, true); assert.equal(result.fabricationRelease, false);
  assert.ok(result.members.every(m => m.source === "proposed"));
  assert.equal(f.part.meshIds, undefined, "não alterou peças existentes");
});
test("pendências, escala, referência e limites impedem estrutura parcial ou suposição", () => {
  const f = fixture();
  for (const [proposal, assessment, geometry] of [
    [{ ...f.proposal, structureSurveyed: false }, f.assessment, f.geometry],
    [f.proposal, { ...f.assessment, status: "incomplete" }, f.geometry],
    [f.proposal, { ...f.assessment, recipe: { ...recipe, layout: null } }, f.geometry],
    [{ ...f.proposal, referenceLine: null }, f.assessment, f.geometry],
    [{ ...f.proposal, parameters: { ...f.proposal.parameters, heightM: 30 } }, f.assessment, f.geometry],
    [f.proposal, f.assessment, { ...f.geometry, surfaceSections: { kind: "insufficient" } }],
  ]) assert.equal(constructionPreview(f.part, proposal, assessment, geometry).status, "blocked");
  assert.equal(constructionPreview(f.part, f.proposal, f.assessment, f.geometry, { maxMembers: 2 }).members.length, 0);
  assert.throws(() => checkConstructionRecipes([{ ...recipe, layout: { ...layout, clearanceMeaning: "guess" } }]), /distribuição/);
  assert.throws(() => checkConstructionProposal({ ...f.proposal, structureSurveyed: "yes" }, { catalog: [material, sheet], recipes: [recipe] }), /Conferência/);
});
test("eixos curvos usam o percurso de seções; arco de aresta isolado é bloqueado", () => {
  const f = fixture(), geometry = { kind: "circular-candidate", methodVersion: "triangle-sections-2", surfaceSections: { kind: "cylindrical-candidate" },
    development: { lengthM: Math.PI, basis: "surface-sections", path: { center: [2, 2], radiusM: 2, startRad: 0, sweepRad: Math.PI / 2 } } };
  const proposal = { ...f.proposal, referenceArc: { id: "S1", view: "top", surface: "internal", representsSurface: true } };
  const assessment = { ...f.assessment, recipe: { ...recipe, geometry: "circular" } };
  const result = constructionPreview(f.part, proposal, assessment, geometry);
  assert.equal(result.status, "reference-only");
  for (const member of result.members) assert.ok(Math.abs(Math.hypot(member.start[0] - 2, member.start[2] - 2) - 2) < 1e-6);
  const circular = { ...geometry, development: { ...geometry.development, lengthM: 4 * Math.PI, path: { ...geometry.development.path, sweepRad: 2 * Math.PI } } };
  const loop = constructionPreview(f.part, { ...proposal, parameters: { ...proposal.parameters, clearanceM: 0 } }, assessment, circular);
  assert.equal(loop.members.length, Math.ceil(4 * Math.PI / proposal.parameters.spacingM));
  assert.equal(new Set(loop.members.map(m => m.start.map(n => n.toFixed(5)).join(","))).size, loop.members.length, "a emenda do círculo não duplica um montante");
  geometry.development.basis = "edge-arcs";
  assert.equal(constructionPreview(f.part, proposal, assessment, geometry).status, "blocked");
});
