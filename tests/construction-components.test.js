import test from "node:test";
import assert from "node:assert/strict";
import { checkComponentRules, counterComponentTemplate } from "../functions/constructionComponents.js";
import { BUILTIN_RECIPES, assessConstruction, checkConstructionRecipes } from "../functions/construction.js";
import { constructionPreview, CONSTRUCTION_PREVIEW_VERSION } from "../src/lib/construction/preview.js";
const approval = { approved: true, source: "Fonte sintética de teste", approvedBy: "Teste", approvedAt: "2026-10-30" };
const expr = n => ({ terms: [], offsetM: n }), vector = (...v) => v.map(expr);
function fixture(extra = []) {
  const recipe = { ...structuredClone(BUILTIN_RECIPES.find(r => r.id === "counter")), version: 2, components: [...counterComponentTemplate(), ...extra], ...approval };
  const catalog = [{ id: "perfil", version: 1, name: "Perfil", family: "timber-profile", parameters: { sectionWidthMm: 30, sectionHeightMm: 40 }, ...approval },
    { id: "chapa", version: 1, name: "Chapa", family: "rigid-sheet", parameters: { thicknessMm: 9 }, ...approval }];
  const proposal = { schemaVersion: 1, recipeId: "counter", recipeVersion: 2, layers: { structure: { id: "perfil", version: 1 }, substrate: { id: "chapa", version: 1 } },
    parameters: { widthM: 2, heightM: 1, depthM: .5, spacingM: .5, clearanceM: .01, lossRatio: .1 },
    structureSurveyed: true, geometryVersion: "triangle-sections-2", previewVersion: CONSTRUCTION_PREVIEW_VERSION };
  const part = { id: "counter", dimensions: [2, 1, .5], review: { kind: "furniture", semanticRole: "counter" } };
  const geometry = { kind: "planar-candidate", methodVersion: "triangle-sections-2", surfaceSections: { kind: "prismatic-candidate" } };
  const assess = () => assessConstruction(proposal, { catalog, recipes: [recipe], part, geometry });
  return { recipe, catalog, proposal, part, geometry, assess };
}
test("balcão possui quatro painéis dimensionados pela ficha, sem afirmar corte ou construção interna", () => {
  const f = fixture(), result = f.assess();
  assert.equal(result.status, "proposal"); assert.equal(result.components.length, 4);
  const preview = constructionPreview(f.part, f.proposal, result, f.geometry);
  assert.equal(preview.status, "reference-only"); assert.equal(preview.panels.length, 4);
  assert.ok(Math.abs(preview.quantities.panelAreaM2 - 2.982) < 1e-8);
  assert.equal(preview.fabricationRelease, false); assert.equal(result.cutList, null);
  assert.ok(result.components.every(c => c.source === "proposed" && c.size[c.normalAxis] === .009));
});
test("receita pode declarar travessa, reforço e marcador de ligação com detalhe", () => {
  const f = fixture([
    { id: "rail", name: "Travessa", kind: "profile", layer: "structure", start: vector(0, 0, 0), end: vector(2, 0, 0) },
    { id: "brace", name: "Reforço", kind: "brace", layer: "structure", start: vector(0, 0, 0), end: vector(2, 1, 0) },
    { id: "joint", name: "Ligação", kind: "connection", layer: "structure", center: vector(0, 0, 0), detail: "Detalhe técnico de teste J1, não dimensiona parafuso" },
  ]);
  const preview = constructionPreview(f.part, f.proposal, f.assess(), f.geometry);
  assert.equal(preview.members.length, 2); assert.equal(preview.connections.length, 1);
  assert.ok(Math.abs(preview.quantities.axisLengthM - (2 + Math.sqrt(5))) < 1e-8);
  assert.equal(preview.connections[0].detail.includes("J1"), true);
});
test("código, referências desconhecidas e componentes duplicados não são executados nem aceitos", () => {
  const rules = counterComponentTemplate(); rules[0].center[0].terms[0].field = "process.env";
  assert.throws(() => checkComponentRules(rules), /Expressão/);
  const f = fixture(); f.recipe.components.push({ ...structuredClone(f.recipe.components[0]), id: "duplicate" });
  assert.match(f.assess().missing.join(" "), /coincidente duplicado/);
  assert.equal(f.assess().components.length, 0);
  f.recipe.components[0].size[0].offsetM = Infinity;
  assert.throws(() => checkConstructionRecipes([f.recipe]), /Expressão/);
});
test("dados ausentes, espessura errada, ligação sem detalhe e método antigo mantêm pendência", () => {
  const f = fixture([{ id: "joint", name: "Ligação", kind: "connection", layer: "structure", center: vector(0, 0, 0) }]);
  assert.match(f.assess().missing.join(" "), /documento\/detalhe/);
  const good = fixture();
  assert.equal(constructionPreview(good.part, { ...good.proposal, previewVersion: "old" }, good.assess(), good.geometry).status, "blocked");
  assert.equal(constructionPreview(good.part, good.proposal, good.assess(), { ...good.geometry, surfaceSections: { kind: "cylindrical-candidate" } }).status, "blocked");
  good.recipe.components[0].size[0] = expr(.1);
  assert.match(good.assess().missing.join(" "), /espessura difere/);
});
