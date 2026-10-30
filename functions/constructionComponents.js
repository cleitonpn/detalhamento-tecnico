// Linguagem declarativa limitada: somas de parâmetros, nunca código executável.
const fields = ["widthM", "heightM", "depthM", "clearanceM", "spacingM", "thicknessM", "sectionWidthM", "sectionHeightM"];
const object = v => v && typeof v === "object" && !Array.isArray(v);
const keys = (v, allowed) => Object.keys(v).every(k => allowed.includes(k));
const finite = n => Number.isFinite(n) && Math.abs(n) <= 10000;
const fail = message => { throw Error(message); };
function expression(e) {
  if (!object(e) || !keys(e, ["terms", "offsetM"]) || !Array.isArray(e.terms) || e.terms.length > 8 ||
    !finite(e.offsetM ?? 0) || e.terms.some(t => !object(t) || !keys(t, ["field", "factor"]) || !fields.includes(t.field) || !finite(t.factor)))
    fail("Expressão de componente inválida: use apenas parâmetros e fatores finitos.");
}
const vector = value => { if (!Array.isArray(value) || value.length !== 3) fail("Vetor de componente inválido."); value.forEach(expression); };
export function checkComponentRules(rules = []) {
  if (!Array.isArray(rules) || rules.length > 100) fail("Limite de componentes da receita excedido.");
  const seen = new Set();
  for (const r of rules) {
    if (!object(r) || !keys(r, ["id", "name", "kind", "layer", "center", "size", "normalAxis", "start", "end", "detail"]) ||
      typeof r.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(r.id) || seen.has(r.id) || typeof r.name !== "string" || !r.name.trim() || r.name.length > 180 ||
      !["panel", "profile", "brace", "connection"].includes(r.kind) || !["structure", "substrate", "finish"].includes(r.layer) ||
      r.detail != null && (typeof r.detail !== "string" || r.detail.length > 1000)) fail("Componente da receita inválido ou duplicado.");
    seen.add(r.id);
    if (r.kind === "panel") { vector(r.center); vector(r.size); if (![0, 1, 2].includes(r.normalAxis)) fail("Eixo de espessura do painel inválido."); }
    else if (r.kind === "connection") vector(r.center);
    else { vector(r.start); vector(r.end); }
  }
  return rules;
}

export function evaluateComponents(recipe, proposal, layers) {
  const components = [], missing = [], seen = new Set();
  for (const r of checkComponentRules(recipe.components)) {
    try {
      const material = layers[r.layer];
      if (!material?.approved) throw Error(`ficha aprovada da camada ${r.layer} ausente`);
      const values = { ...proposal.parameters, thicknessM: material.parameters.thicknessMm / 1000,
        sectionWidthM: material.parameters.sectionWidthMm / 1000, sectionHeightM: material.parameters.sectionHeightMm / 1000 };
      const evaluate = e => e.terms.reduce((sum, t) => {
        if (!finite(values[t.field])) throw Error(`parâmetro ${t.field} ausente`);
        return sum + values[t.field] * t.factor;
      }, e.offsetM ?? 0);
      const vec = v => v.map(evaluate);
      const c = { id: r.id, name: r.name, kind: r.kind, layer: r.layer, source: "proposed",
        material: { id: material.id, version: material.version }, detail: r.detail || "" };
      if (r.kind === "panel") {
        c.center = vec(r.center); c.size = vec(r.size); c.normalAxis = r.normalAxis;
        if (!c.size.every(n => finite(n) && n > 0)) throw Error("dimensões de painel não positivas");
        if (!(values.thicknessM > 0) || Math.abs(c.size[r.normalAxis] - values.thicknessM) > 1e-6) throw Error("espessura difere da ficha de material");
        c.areaM2 = c.size.filter((_, k) => k !== r.normalAxis).reduce((a, b) => a * b, 1);
      } else if (r.kind === "connection") {
        c.center = vec(r.center);
        if (!c.detail.trim()) throw Error("informe documento/detalhe da ligação; marcador não dimensiona fixação");
      } else {
        c.start = vec(r.start); c.end = vec(r.end); c.lengthM = Math.hypot(...c.start.map((v, k) => v - c.end[k]));
        if (!(c.lengthM > 1e-6) || !(values.sectionWidthM > 0 && values.sectionHeightM > 0)) throw Error("comprimento ou seção do perfil ausente");
        c.sectionMm = [values.sectionWidthM * 1000, values.sectionHeightM * 1000];
      }
      if ([c.center, c.size, c.start, c.end].filter(Boolean).some(v => !v.every(finite))) throw Error("coordenadas fora dos limites");
      const signature = JSON.stringify([c.kind, c.material, c.center || [c.start, c.end].sort(), c.size, c.detail]);
      if (seen.has(signature)) throw Error("componente coincidente duplicado; revisar antes de somar");
      seen.add(signature); components.push(c);
    } catch (e) { missing.push(`${r.name}: ${e.message}.`); }
  }
  return { components: missing.length ? [] : components, missing };
}

const e = (...terms) => ({ terms: terms.map(([field, factor]) => ({ field, factor })), offsetM: 0 });
const half = f => e([f, .5]);
// Esboço paramétrico, não padrão aprovado. Materiais, folgas, conexões e reforços
// precisam ser especificados pela empresa antes de qualquer execução.
export function counterComponentTemplate() {
  const sizeSide = [e(["thicknessM", 1]), e(["heightM", 1]), e(["depthM", 1])];
  const sizeHorizontal = [e(["widthM", 1], ["thicknessM", -2]), e(["thicknessM", 1]), e(["depthM", 1])];
  return [
    { id: "left", name: "Lateral esquerda", kind: "panel", layer: "substrate", normalAxis: 0, size: sizeSide, center: [half("thicknessM"), half("heightM"), half("depthM")] },
    { id: "right", name: "Lateral direita", kind: "panel", layer: "substrate", normalAxis: 0, size: sizeSide, center: [e(["widthM", 1], ["thicknessM", -.5]), half("heightM"), half("depthM")] },
    { id: "top", name: "Tampo entre laterais", kind: "panel", layer: "substrate", normalAxis: 1, size: sizeHorizontal, center: [half("widthM"), e(["heightM", 1], ["thicknessM", -.5]), half("depthM")] },
    { id: "base", name: "Base entre laterais", kind: "panel", layer: "substrate", normalAxis: 1, size: sizeHorizontal, center: [half("widthM"), half("thicknessM"), half("depthM")] },
  ];
}
