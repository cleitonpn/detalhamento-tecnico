import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_RECIPES, checkConstructionCatalog, checkConstructionRecipes,
  checkConstructionProposal, constructionRecipes, assessConstruction, checkConstructionHistory, preserveConstructionHistory } from "../functions/construction.js";
import { summarizeConstructionGeometry } from "../src/lib/construction/geometry.js";
import { constructionReport, appendConstructionPdf } from "../src/lib/construction/report.js";
import * as THREE from "three";
import { partitionScene } from "../src/lib/model.js";
import { analyzePart } from "../src/lib/sheet.js";

const approval = { approved: true, source: "Ficha verificada pelo responsável", approvedBy: "Responsável técnico", approvedAt: "2026-10-29" };
const catalog = [
  { id: "sarrafo", version: 1, name: "Perfil aprovado", family: "timber-profile", parameters: { sectionWidthMm: 30, sectionHeightMm: 40 }, ...approval },
  { id: "chapa", version: 1, name: "Chapa aprovada", family: "rigid-sheet", parameters: { thicknessMm: 9 }, ...approval },
  { id: "flexivel", version: 1, name: "Fechamento flexível aprovado", family: "flexible-sheet", parameters: { thicknessMm: 4, minRadiusM: 0.5, flexDirection: "Conforme ficha do fornecedor", radiusReference: "internal" }, ...approval },
  { id: "pintura", version: 1, name: "Acabamento", family: "finish", parameters: {}, ...approval },
];
const approvedRecipe = id => ({ ...structuredClone(BUILTIN_RECIPES.find(r => r.id === id)), version: 2, ...approval });
const selection = (recipeId = "wall-straight") => ({ schemaVersion: 1, recipeId, recipeVersion: 2,
  layers: { structure: { id: "sarrafo", version: 1 }, substrate: { id: "chapa", version: 1 }, finish: null },
  parameters: { heightM: 3, widthM: 2, spacingM: 0.5, clearanceM: 0, lossRatio: 0.1 },
  referenceArc: null, notes: "Valores sintéticos de teste; não são padrões do produto.",
});
const analysis = { arcs: [{ id: "R1", view: "top", r: 2, sweep: Math.PI / 2, segments: 12, deviation: 0.0002, confidence: "alta" }], views: { top: {} }, curves: [], organic: false, freeCurves: 0, simplified: false };

test("receitas integradas começam incompletas e nunca inventam seção, espaçamento ou corte", () => {
  assert.deepEqual(BUILTIN_RECIPES.map(r => r.id), ["wall-straight", "wall-curved", "fascia-curved", "counter"]);
  const proposal = { ...selection(), recipeVersion: 1, layers: {}, parameters: {} };
  const result = assessConstruction(proposal);
  assert.equal(result.status, "incomplete");
  assert.ok(result.missing.some(m => /Aprovação técnica/.test(m)));
  assert.ok(result.missing.some(m => /Espaçamento/.test(m)));
  assert.equal(result.fabricationRelease, false);
  assert.equal(result.cutList, null);
  assert.deepEqual(result.layers, { structure: null, substrate: null, finish: null });
  assert.deepEqual(proposal.parameters, {});
});

test("camadas e parâmetros aprovados completam uma proposta, mas não liberam fabricação", () => {
  const result = assessConstruction(selection(), { catalog, recipes: [approvedRecipe("wall-straight")], geometry: { kind: "planar-candidate" }, part: { review: { kind: "wall" } } });
  assert.equal(result.status, "proposal");
  assert.deepEqual(result.missing, []);
  assert.equal(result.layers.structure.id, "sarrafo");
  assert.equal(result.layers.substrate.id, "chapa");
  assert.equal(result.layers.finish, null);
  assert.equal(result.fabricationRelease, false);
  assert.equal(result.cutList, null);
});

test("versões salvas não são alteradas ou removidas e a ordem de propriedades não altera identidade", () => {
  const old = { constructionCatalog: catalog, constructionRecipes: [approvedRecipe("wall-straight")] };
  checkConstructionHistory(old, { ...old, constructionCatalog: [...catalog, { ...catalog[0], version: 2 }] });
  checkConstructionHistory(old, { ...old, constructionCatalog: catalog.map(({ name, ...rest }) => ({ ...rest, name })) });
  assert.throws(() => checkConstructionHistory(old, { ...old, constructionCatalog: [] }), /Preserve/);
  const undone = preserveConstructionHistory(old, { parts: [], constructionCatalog: [] });
  checkConstructionHistory(old, undone);
  assert.equal(undone.constructionCatalog.length, catalog.length);
  assert.throws(() => checkConstructionHistory(old, { ...old, constructionCatalog: catalog.map(m => ({ ...m, name: "alterado" })) }), /Preserve/);
});

test("escala alterada e análise insuficiente permanecem como pendências", () => {
  const result = assessConstruction(selection(), { catalog, recipes: [approvedRecipe("wall-straight")], part: { review: { kind: "wall", constructionNeedsReview: true } } });
  assert.equal(result.status, "incomplete");
  assert.match(result.missing.join(" "), /Escala alterada/);
  assert.match(result.missing.join(" "), /Análise geométrica/);
});

test("anexo de documento mostra dados, proveniência e pendências sem produzir corte e pagina textos longos", () => {
  const part = { label: "Parede sintética", review: { kind: "wall", construction: selection(), constructionNeedsReview: true } };
  const report = constructionReport({ constructionCatalog: catalog, constructionRecipes: [approvedRecipe("wall-straight")] }, part, { views: { front: {} } });
  assert.match(report.lines.join("\n"), /NÃO LIBERA FABRICAÇÃO/);
  assert.match(report.lines.join("\n"), /Responsável técnico/);
  assert.match(report.lines.join("\n"), /Escala alterada/);
  let pages = 0; const texts = [];
  const pdf = { addPage: () => pages++, setTextColor() {}, setFontSize() {}, splitTextToSize: line => [line], text: (text, x, y) => { assert.ok(y <= 190); texts.push(text); } };
  appendConstructionPdf(pdf, { lines: Array(150).fill("linha") });
  assert.ok(pages > 1); assert.equal(texts.length, 150);
  assert.equal(report.cutList, null);
});

test("conflitos de identidade/família e valores técnicos ausentes impedem proposta completa", () => {
  const proposal = selection();
  proposal.layers.substrate = { id: "pintura", version: 1 };
  const result = assessConstruction(proposal, { catalog, recipes: [approvedRecipe("wall-straight")], part: { review: { semanticRole: "vegetation" } } });
  assert.match(result.missing.join(" "), /identidade atual/);
  assert.match(result.missing.join(" "), /incompatível/);
  assert.match(result.missing.join(" "), /Espessura/);
  assert.equal(result.status, "incomplete");
  const virtual = assessConstruction(selection(), { catalog, recipes: [approvedRecipe("wall-straight")], geometry: { kind: "planar-candidate" }, part: { label: "Enscape.PointLight", review: { semanticRole: "wall", kind: "wall" } } });
  assert.match(virtual.missing.join(" "), /não é componente físico/);
});

test("catálogos/receitas exigem proveniência e versões preservadas", () => {
  assert.throws(() => checkConstructionCatalog([{ ...catalog[0], approvedBy: "" }]), /responsável/);
  assert.throws(() => checkConstructionCatalog([{ ...catalog[0], approvedAt: "2026-02-30" }]), /data válida/);
  assert.throws(() => checkConstructionCatalog([catalog[0], catalog[0]]), /duplicada/);
  assert.throws(() => constructionRecipes([{ ...structuredClone(BUILTIN_RECIPES[0]), approved: true, ...approval }]), /nova versão/);
  assert.equal(constructionRecipes([approvedRecipe("wall-straight")]).length, 5);
  assert.throws(() => checkConstructionRecipes([{ ...approvedRecipe("wall-straight"), parameters: [{ key: "invented", label: "x", unit: "m" }] }]), /Parâmetro/);
});

test("proposta recusa IDs desconhecidos, parâmetros hostis e referências inválidas", () => {
  const options = { catalog, recipes: [approvedRecipe("wall-straight")] };
  assert.throws(() => checkConstructionProposal({ ...selection(), recipeId: "unknown" }, options), /não cadastrada/);
  assert.throws(() => checkConstructionProposal({ ...selection(), layers: { structure: { id: "unknown", version: 1 } } }, options), /não cadastrado/);
  assert.throws(() => checkConstructionProposal({ ...selection(), parameters: { spacingM: -1 } }, options), /Valor/);
  assert.throws(() => checkConstructionProposal({ ...selection(), parameters: { spacingM: Infinity } }, options), /Valor/);
  assert.throws(() => checkConstructionProposal({ ...selection(), fabricationRelease: true }, options), /inválida/);
});

test("arco circular explícito fornece R×theta na superfície escolhida, nunca comprimento de corte", () => {
  const unselected = summarizeConstructionGeometry(analysis);
  assert.equal(unselected.kind, "circular-candidate");
  assert.equal(unselected.development, null);
  assert.equal(unselected.candidates[0].wholeSurfaceConfirmed, false);
  const geometry = summarizeConstructionGeometry(analysis, { selectedArcId: "R1", selectedView: "top", referenceSurface: "internal" });
  assert.equal(geometry.development.lengthM, Math.PI);
  assert.equal(geometry.development.referenceSurface, "internal");
  assert.equal(geometry.development.cutLength, false);
  assert.match(geometry.development.label, /não é comprimento de corte/);
});

test("malha cilíndrica de raio conhecido atravessa a análise real sem inventar uma superfície inteira", () => {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 3, 48, 1, false, 0, Math.PI / 2), new THREE.MeshStandardMaterial()));
  const imported = partitionScene(scene), part = imported.parts[0];
  const analysis = analyzePart(part, imported.meshMap, "m");
  const summary = summarizeConstructionGeometry(analysis);
  assert.equal(summary.kind, "circular-candidate");
  assert.ok(Math.abs(summary.candidates[0].radiusM - 2) < .00001);
  const selected = summarizeConstructionGeometry(analysis, { selectedArcId: summary.candidates[0].id, selectedView: "top", referenceSurface: "internal" });
  assert.ok(Math.abs(selected.development.lengthM - Math.PI) < .00001);
  assert.equal(selected.development.cutLength, false);
  assert.equal(summary.candidates[0].wholeSurfaceConfirmed, false);
  scene.children[0].geometry.dispose(); scene.children[0].material.dispose();
});

test("canto arredondado não vira raio de parede e curva livre/simplificação não recebe desenvolvimento circular", () => {
  const corner = { ...analysis, arcs: [{ ...analysis.arcs[0], r: 0.01 }] };
  const summary = summarizeConstructionGeometry(corner);
  assert.equal(summary.candidates[0].wholeSurfaceConfirmed, false);
  assert.equal(summary.development, null);
  for (const extra of [{ organic: true }, { curves: [{}] }, { simplified: true }]) {
    const geometry = summarizeConstructionGeometry({ ...analysis, ...extra }, { selectedArcId: "R1", referenceSurface: "internal" });
    assert.equal(geometry.development, null);
  }
  assert.equal(summarizeConstructionGeometry(null).kind, "unknown");
});

test("receita curva exige confirmação de superfície, ficha flexível e referência compatível", () => {
  const proposal = selection("wall-curved");
  proposal.layers.substrate = { id: "flexivel", version: 1 };
  proposal.referenceArc = { id: "R1", view: "top", surface: "internal", representsSurface: false };
  const options = { catalog, recipes: [approvedRecipe("wall-curved")], geometry: summarizeConstructionGeometry(analysis, { selectedArcId: "R1", selectedView: "top", referenceSurface: "internal" }) };
  assert.match(assessConstruction(proposal, options).missing.join(" "), /canto arredondado/);
  proposal.referenceArc.representsSurface = true;
  assert.equal(assessConstruction(proposal, options).status, "proposal");
  const external = summarizeConstructionGeometry(analysis, { selectedArcId: "R1", selectedView: "top", referenceSurface: "external" });
  assert.match(assessConstruction(proposal, { ...options, geometry: external }).missing.join(" "), /referência/);
  const tight = summarizeConstructionGeometry({ ...analysis, arcs: [{ ...analysis.arcs[0], r: 0.1 }] }, { selectedArcId: "R1", selectedView: "top", referenceSurface: "internal" });
  assert.match(assessConstruction(proposal, { ...options, geometry: tight }).missing.join(" "), /menor/);
});
