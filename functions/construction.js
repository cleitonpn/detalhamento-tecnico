import { checkComponentRules, evaluateComponents } from "./constructionComponents.js";
// Contratos compartilhados pelo navegador e pelas Functions. Apenas propostas:
// receitas e fichas aprovadas não constituem liberação de fabricação ou cálculo estrutural.
export const CONSTRUCTION_SCHEMA_VERSION = 1;
export const MATERIAL_FAMILIES = {
  "timber-profile": "Perfil de madeira / sarrafo",
  "metal-profile": "Perfil metálico",
  "rigid-sheet": "Chapa rígida",
  "flexible-sheet": "Chapa flexível / virola",
  finish: "Acabamento",
};
export const CONSTRUCTION_LAYERS = ["structure", "substrate", "finish"];
const PARAMETER_KEYS = ["heightM", "widthM", "depthM", "spacingM", "clearanceM", "lossRatio"];
const layerNames = { structure: "estrutura", substrate: "fechamento", finish: "acabamento" };
const id = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const object = value => value && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 300) => typeof value === "string" && value.length <= max;
const positive = value => Number.isFinite(value) && value > 0;
const clone = value => JSON.parse(JSON.stringify(value));
const fail = message => { throw Error(message); };
const version = value => Number.isSafeInteger(value) && value >= 1;
const revisionKey = entry => `${entry.id}@${entry.version}`;
const sameKeys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));

function checkApproval(entry) {
  if (entry.approved != null && typeof entry.approved !== "boolean") fail("Aprovação construtiva inválida.");
  for (const key of ["source", "approvedBy", "approvedAt"])
    if (entry[key] != null && !text(entry[key], key === "source" ? 1000 : 180)) fail("Proveniência construtiva inválida.");
  if (entry.approved) {
    if (!entry.source?.trim() || !entry.approvedBy?.trim()) fail("Informe fonte técnica e responsável pela aprovação.");
    const date = entry.approvedAt || "";
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(date) ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date.slice(0, 10))
      fail("Informe a data válida da aprovação técnica.");
  }
}

function checkIdentity(entry) {
  if (!object(entry) || !id(entry.id) || !version(entry.version) || !text(entry.name, 180) || !entry.name.trim())
    fail("Identidade/versão construtiva inválida.");
  checkApproval(entry);
}

export function checkConstructionCatalog(entries = []) {
  if (!Array.isArray(entries) || entries.length > 300) fail("Catálogo construtivo inválido.");
  const seen = new Set();
  return entries.map(entry => {
    checkIdentity(entry);
    if (!Object.hasOwn(MATERIAL_FAMILIES, entry.family)) fail("Família construtiva inválida.");
    if (seen.has(revisionKey(entry))) fail("Versão de material construtivo duplicada.");
    seen.add(revisionKey(entry));
    const p = entry.parameters || {};
    if (!object(p) || !sameKeys(p, ["thicknessMm", "sectionWidthMm", "sectionHeightMm", "minRadiusM", "flexDirection", "radiusReference"]))
      fail("Parâmetros de material construtivo inválidos.");
    for (const key of ["thicknessMm", "sectionWidthMm", "sectionHeightMm", "minRadiusM"])
      if (p[key] != null && !positive(p[key])) fail("Medida técnica de material inválida.");
    if (p.flexDirection != null && (!text(p.flexDirection, 180) || !p.flexDirection.trim()))
      fail("Orientação de flexão inválida.");
    if (p.radiusReference != null && !["internal", "external", "neutral"].includes(p.radiusReference))
      fail("Referência do raio mínimo inválida.");
    return clone({ ...entry, approved: entry.approved === true, parameters: p });
  });
}

const parameter = (key, label, unit, allowZero = false) => ({ key, label, unit, allowZero });
const baseParameters = [
  parameter("heightM", "Altura a conferir", "m"),
  parameter("spacingM", "Espaçamento aprovado da estrutura", "m"),
  parameter("clearanceM", "Folga aprovada", "m", true),
  parameter("lossRatio", "Perda configurada", "ratio", true),
];
const layers = flexible => ({
  structure: { required: true, families: ["timber-profile", "metal-profile"] },
  substrate: { required: true, families: flexible ? ["flexible-sheet"] : ["rigid-sheet", "flexible-sheet"] },
  finish: { required: false, families: ["finish"] },
});
const template = (recipeId, name, semanticRoles, geometry, parameters) => ({
  id: recipeId, version: 1, name, semanticRoles, geometry, layers: layers(geometry === "circular"),
  parameters, approved: false, source: "", approvedBy: "", approvedAt: "",
});
const builtins = [
  template("wall-straight", "Parede reta — padrão a cadastrar", ["wall"], "straight", [
    ...baseParameters, parameter("widthM", "Largura a conferir", "m"),
  ]),
  template("wall-curved", "Parede curva — padrão a cadastrar", ["wall"], "circular", baseParameters),
  template("fascia-curved", "Testeira curva — padrão a cadastrar", ["fascia"], "circular", baseParameters),
  template("counter", "Balcão — padrão a cadastrar", ["counter", "countertop"], "any", [
    ...baseParameters, parameter("widthM", "Largura a conferir", "m"), parameter("depthM", "Profundidade a conferir", "m"),
  ]),
];
function freezeDeep(value) {
  for (const child of Object.values(value)) if (child && typeof child === "object") freezeDeep(child);
  return Object.freeze(value);
}
export const BUILTIN_RECIPES = freezeDeep(builtins);

export function checkConstructionRecipe(entry) {
  checkIdentity(entry);
  for (const key of ["scope", "contraindications"]) if (entry[key] != null && !text(entry[key], 1200)) fail("Escopo/contraindicações da receita inválidos.");
  if (entry.components != null) checkComponentRules(entry.components);
  if (entry.layout != null && (!object(entry.layout) || !sameKeys(entry.layout, ["kind", "spacingMeaning", "clearanceMeaning", "heightMeaning"]) ||
    entry.layout.kind !== "vertical-studs" || entry.layout.spacingMeaning !== "maximum-axis-distance" ||
    entry.layout.clearanceMeaning !== "both-path-ends" || entry.layout.heightMeaning !== "reference-axis-length"))
    fail("Método de distribuição da receita inválido.");
  if (!["straight", "circular", "any"].includes(entry.geometry) || !Array.isArray(entry.semanticRoles) ||
    !entry.semanticRoles.length || entry.semanticRoles.length > 20 || entry.semanticRoles.some(role => !id(role)))
    fail("Condições da receita construtiva inválidas.");
  if (!object(entry.layers) || !sameKeys(entry.layers, CONSTRUCTION_LAYERS)) fail("Camadas construtivas inválidas.");
  for (const role of CONSTRUCTION_LAYERS) {
    const layer = entry.layers[role];
    if (!object(layer) || typeof layer.required !== "boolean" || !Array.isArray(layer.families) ||
      !layer.families.length || layer.families.some(family => !Object.hasOwn(MATERIAL_FAMILIES, family)))
      fail("Camada/compatibilidade construtiva inválida.");
  }
  if (!Array.isArray(entry.parameters) || entry.parameters.length > PARAMETER_KEYS.length) fail("Parâmetros da receita inválidos.");
  const seen = new Set();
  for (const p of entry.parameters) {
    if (!object(p) || !PARAMETER_KEYS.includes(p.key) || seen.has(p.key) || !text(p.label, 180) ||
      !["m", "ratio"].includes(p.unit) || (p.allowZero != null && typeof p.allowZero !== "boolean"))
      fail("Parâmetro da receita inválido.");
    seen.add(p.key);
  }
  return clone({ ...entry, approved: entry.approved === true });
}

export function checkConstructionRecipes(entries = []) {
  if (!Array.isArray(entries) || entries.length > 100) fail("Receitas construtivas inválidas.");
  const seen = new Set();
  return entries.map(entry => {
    const result = checkConstructionRecipe(entry), key = revisionKey(result);
    if (seen.has(key)) fail("Versão de receita construtiva duplicada.");
    seen.add(key);
    return result;
  });
}

export function constructionRecipes(custom = []) {
  const registry = new Map(BUILTIN_RECIPES.map(entry => [revisionKey(entry), entry]));
  for (const entry of checkConstructionRecipes(custom)) {
    const key = revisionKey(entry);
    if (registry.has(key) && JSON.stringify(registry.get(key)) !== JSON.stringify(entry))
      fail("Não substitua uma receita existente: cadastre nova versão.");
    registry.set(key, entry);
  }
  return [...registry.values()];
}

// A gravação remota também protege versões já referenciadas por propostas.
export function checkConstructionHistory(previous, next) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  for (const field of ["constructionCatalog", "constructionRecipes"]) {
    for (const entry of previous?.[field] || []) {
      const saved = (next?.[field] || []).find(e => revisionKey(e) === revisionKey(entry));
      if (!saved || JSON.stringify(canonical(saved)) !== JSON.stringify(canonical(entry)))
        fail("Preserve as versões construtivas existentes; cadastre uma nova versão.");
    }
  }
}

export function preserveConstructionHistory(current, target) {
  const result = { ...target };
  for (const field of ["constructionCatalog", "constructionRecipes"]) {
    result[field] = [...new Map([...(target[field] || []), ...(current[field] || [])]
      .map(entry => [revisionKey(entry), entry])).values()];
  }
  checkConstructionHistory(current, result);
  return result;
}

export function checkConstructionProposal(proposal, { catalog = [], recipes = [] } = {}) {
  if (!object(proposal) || proposal.schemaVersion !== CONSTRUCTION_SCHEMA_VERSION ||
    !sameKeys(proposal, ["schemaVersion", "recipeId", "recipeVersion", "layers", "parameters", "referenceArc", "referenceLine", "structureSurveyed", "geometryVersion", "previewVersion", "notes"]) ||
    !id(proposal.recipeId) || !version(proposal.recipeVersion)) fail("Proposta construtiva inválida.");
  const recipe = constructionRecipes(recipes).find(r => r.id === proposal.recipeId && r.version === proposal.recipeVersion);
  if (!recipe) fail("Receita/versão construtiva não cadastrada.");
  const materials = checkConstructionCatalog(catalog);
  if (!object(proposal.layers) || !sameKeys(proposal.layers, CONSTRUCTION_LAYERS)) fail("Seleção de camadas inválida.");
  for (const role of CONSTRUCTION_LAYERS) {
    const ref = proposal.layers[role];
    if (ref == null) continue;
    if (!object(ref) || !sameKeys(ref, ["id", "version"]) || !id(ref.id) || !version(ref.version))
      fail("Referência de material construtivo inválida.");
    if (!materials.some(m => m.id === ref.id && m.version === ref.version)) fail("Material/versão construtiva não cadastrado.");
  }
  if (!object(proposal.parameters) || !sameKeys(proposal.parameters, PARAMETER_KEYS)) fail("Parâmetros da proposta inválidos.");
  for (const [key, value] of Object.entries(proposal.parameters)) {
    if (!Number.isFinite(value) || value < 0 || (!["clearanceM", "lossRatio"].includes(key) && value === 0) ||
      (key === "lossRatio" && value > 1)) fail("Valor de parâmetro construtivo inválido.");
  }
  if (proposal.referenceArc != null) {
    const arc = proposal.referenceArc;
    if (!object(arc) || !sameKeys(arc, ["id", "view", "surface", "representsSurface"]) || !id(arc.id) ||
      !["front", "top", "side"].includes(arc.view) || !["internal", "external", "neutral"].includes(arc.surface) ||
      (arc.representsSurface != null && typeof arc.representsSurface !== "boolean")) fail("Referência geométrica construtiva inválida.");
  }
  if (proposal.referenceLine != null && (!object(proposal.referenceLine) || !sameKeys(proposal.referenceLine, ["id", "representsSurface"]) ||
    !id(proposal.referenceLine.id) || typeof proposal.referenceLine.representsSurface !== "boolean")) fail("Referência reta inválida.");
  if (proposal.structureSurveyed != null && typeof proposal.structureSurveyed !== "boolean") fail("Conferência da estrutura existente inválida.");
  for (const key of ["geometryVersion", "previewVersion"]) if (proposal[key] != null && !id(proposal[key])) fail("Versão do método construtivo inválida.");
  if (proposal.notes != null && !text(proposal.notes, 1200)) fail("Observação construtiva inválida.");
  return clone(proposal);
}

export function assessConstruction(proposal, { catalog = [], recipes = [], geometry = null, part = null } = {}) {
  const selection = checkConstructionProposal(proposal, { catalog, recipes });
  const recipe = constructionRecipes(recipes).find(r => r.id === selection.recipeId && r.version === selection.recipeVersion);
  const materials = checkConstructionCatalog(catalog), missing = [], alternatives = {}, selectedLayers = {};
  if (part?.review?.constructionNeedsReview) missing.push("Escala alterada: conferir novamente parâmetros e referência geométrica.");
  if (!geometry || geometry.kind === "unknown") missing.push("Análise geométrica suficiente e conferida da peça.");
  if (recipe.geometry === "straight" && geometry?.kind === "circular-candidate")
    missing.push("Há arcos detectados: conferir se a receita reta corresponde ao fechamento.");
  if (!recipe.approved) missing.push("Aprovação técnica e versão do padrão construtivo da empresa.");
  const semanticRole = part?.review?.semanticRole ||
    (part?.review?.kind === "furniture" && part?.auto?.semanticRole === "furniture" ? "counter" : part?.auto?.semanticRole) ||
    ({ furniture: "counter" }[part?.review?.kind] || part?.review?.kind);
  const sourceName = [part?.originalLabel ?? part?.label, part?.hints?.definition, part?.hints?.tag].filter(Boolean).join(" ");
  if (semanticRole === "render" || /enscape|v-?ray|pointlight|point light|ies light|omni light/i.test(sourceName))
    missing.push("Auxiliar de renderização/luz virtual não é componente físico para uma proposta construtiva.");
  if (semanticRole && !recipe.semanticRoles.includes(semanticRole)) missing.push("A receita não corresponde à identidade atual da peça.");
  for (const role of CONSTRUCTION_LAYERS) {
    const spec = recipe.layers[role], ref = selection.layers[role];
    alternatives[role] = materials.filter(m => spec.families.includes(m.family)).map(m => ({ id: m.id, version: m.version, name: m.name, approved: m.approved }));
    const material = ref && materials.find(m => m.id === ref.id && m.version === ref.version);
    selectedLayers[role] = material || null;
    if (!material) { if (spec.required) missing.push(`Material da camada ${layerNames[role]}.`); continue; }
    if (!spec.families.includes(material.family)) missing.push(`Material incompatível com a camada ${layerNames[role]}.`);
    if (!material.approved) missing.push(`Ficha técnica aprovada: ${material.name}.`);
    const p = material.parameters;
    if (role === "structure") {
      if (!positive(p.sectionWidthMm) || !positive(p.sectionHeightMm)) missing.push(`Seção cadastrada da estrutura: ${material.name}.`);
    }
    if (role === "substrate") {
      if (!positive(p.thicknessMm)) missing.push(`Espessura cadastrada do fechamento: ${material.name}.`);
      if (recipe.geometry === "circular" && (!positive(p.minRadiusM) || !p.flexDirection || !p.radiusReference))
        missing.push(`Raio mínimo, referência e orientação de flexão verificados: ${material.name}.`);
    }
  }
  for (const p of recipe.parameters) {
    const value = selection.parameters[p.key];
    if (!Number.isFinite(value) || (p.allowZero ? value < 0 : value <= 0)) missing.push(`${p.label} (${p.unit === "ratio" ? "fração 0–1" : p.unit}).`);
  }
  if (recipe.geometry === "circular") {
    if (!selection.referenceArc) missing.push("Arco circular e superfície de referência (interna/externa/neutra).");
    if (!selection.referenceArc?.representsSurface) missing.push("Confirmar que o arco representa o fechamento, não um canto arredondado.");
    const development = geometry?.development;
    const matches = development && selection.referenceArc &&
      development.arcId === selection.referenceArc.id && development.view === selection.referenceArc.view &&
      development.referenceSurface === selection.referenceArc.surface;
    if (geometry?.kind !== "circular-candidate" || !matches)
      missing.push("Geometria circular suficiente para o desenvolvimento da referência selecionada.");
    const material = selectedLayers.substrate;
    if (material && development && material.parameters.radiusReference !== development.referenceSurface)
      missing.push("A referência do raio mínimo do material difere da superfície escolhida; não converter sem dados técnicos.");
    if (material && development && material.parameters.radiusReference === development.referenceSurface && development.radiusM < material.parameters.minRadiusM)
      missing.push("Raio observado menor que o raio mínimo aprovado do material.");
  }
  if (geometry?.kind === "complex") missing.push("Geometria complexa exige revisão própria; não há planificação exata demonstrada.");
  const componentResult = evaluateComponents(recipe, selection, selectedLayers);
  missing.push(...componentResult.missing);
  return {
    status: missing.length ? "incomplete" : "proposal",
    recipe: clone(recipe), layers: selectedLayers, missing: [...new Set(missing)], alternatives,
    development: recipe.geometry === "circular" ? geometry?.development || null : null,
    components: componentResult.components,
    fabricationRelease: false, cutList: null,
    notice: "Solução proposta para revisão. Não verifica estabilidade, conexões nem libera fabricação.",
  };
}
