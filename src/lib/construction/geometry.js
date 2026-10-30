// O detalhamento existente detecta arcos de arestas. Um arco de aresta sozinho
// não demonstra que toda a parede/superfície tenha aquele raio.
const finitePositive = value => Number.isFinite(value) && value > 0;

export function summarizeConstructionGeometry(analysis, {
  part = null, selectedArcId = null, selectedView = null, referenceSurface = null,
} = {}) {
  if (!analysis) return { kind: "unknown", candidates: [], warnings: ["Análise geométrica ainda não executada."], development: null };
  const warnings = [];
  const profile = analysis.surfaceSections;
  const sourceArcs = profile ? profile.kind === "cylindrical-candidate" ? profile.arcs : [] : analysis.arcs;
  const candidates = (Array.isArray(sourceArcs) ? sourceArcs : []).filter(a =>
    typeof a.id === "string" && ["front", "top", "side"].includes(a.view) && finitePositive(a.r) &&
    finitePositive(Math.abs(a.sweep)) && Math.abs(a.sweep) <= 2 * Math.PI + 1e-6 &&
    Number.isFinite(a.deviation) && a.deviation >= 0 && a.segments >= 3,
  ).map(a => ({ id: a.id, view: a.view, radiusM: a.r, sweepRad: Math.abs(a.sweep),
    segments: a.segments, deviationM: a.deviation, confidence: a.confidence || "não calibrada",
    basis: a.basis || "edge-arcs", path: a.path || null,
    sectionHeights: a.sectionHeights || [], wholeSurfaceConfirmed: false }));
  let kind = "unknown";
  if (analysis.organic || (analysis.curves?.length || 0) > 0 || (analysis.freeCurves || 0) > 0) {
    kind = "complex";
    warnings.push(profile ? "O desenho contém curvas livres ou forma orgânica. As seções são uma análise independente e não comprovam a continuidade entre elas." :
      "Curvas livres ou forma orgânica: não atribuir raio único nem planificação circular exata.");
  } else if (candidates.length) {
    kind = "circular-candidate";
    warnings.push(profile?.kind === "cylindrical-candidate" ? "Arcos encontrados nas seções; confirme a superfície útil, pois cantos também podem atravessar toda a altura." :
      "Arcos detectados em arestas; confirme quais descrevem a superfície e quais são cantos arredondados.");
  } else if (Object.keys(analysis.views || {}).length) {
    kind = "planar-candidate";
    warnings.push("Sem arco relevante detectado; isso não comprova planaridade ou espessura de chapa.");
  }
  if (analysis.simplified) {
    kind = "unknown";
    warnings.push(profile ? "Arestas do desenho simplificadas; a análise construtiva usa seções independentes da malha." :
      "Geometria simplificada: insuficiente para justificar um desenvolvimento construtivo.");
  }
  if (profile) {
    warnings.push(profile.reason);
    if (profile.variation === "linear-radius-candidate") warnings.push("Raio variando aproximadamente de forma linear: possível superfície cônica. Não desenvolver como cilindro nem converter em corte sem método próprio validado.");
    if (profile.variation === "nonlinear-radius") warnings.push("Raio varia de forma não linear: possível dupla curvatura. Não há planificação exata demonstrada.");
    if (profile.kind === "cylindrical-candidate") {
      kind = "circular-candidate";
      warnings.push("Candidato sustentado por três seções de triângulos. Ainda exige confirmação da superfície útil e de continuidade entre cortes.");
    } else if (["multi-radius", "varying-section", "irregular"].includes(profile.kind)) kind = "complex";
    else if (profile.kind === "prismatic-candidate") kind = "planar-candidate";
    else if (profile.kind === "insufficient") kind = "unknown";
    // O método construtivo depende da completude das seções, não dos limites
    // de arestas/linhas ocultas do desenho. Mesma regra no Worker e no PDF.
  }
  if (part?.measurementBasis === "world-assembly") warnings.push("Envelope global: orientação e medida da peça exigem conferência.");
  let development = null;
  if (selectedArcId != null) {
    const found = candidates.filter(a => a.id === selectedArcId && (!selectedView || a.view === selectedView));
    if (found.length !== 1) warnings.push("Arco selecionado ausente ou ambíguo na análise atual.");
    else if (!["internal", "external", "neutral"].includes(referenceSurface)) warnings.push("Selecione a superfície de referência interna, externa ou neutra.");
    else if (kind !== "circular-candidate") warnings.push("A análise atual não permite desenvolvimento circular confiável.");
    else {
      const arc = found[0];
      development = { arcId: arc.id, view: arc.view, referenceSurface,
        radiusM: arc.radiusM, sweepRad: arc.sweepRad,
        lengthM: arc.radiusM * arc.sweepRad, deviationM: arc.deviationM,
        basis: arc.basis, path: arc.path,
        cutLength: false, label: "Desenvolvimento geométrico do arco escolhido (não é comprimento de corte)",
      };
    }
  }
  return { kind, candidates, warnings, development, surfaceSections: profile || null, methodVersion: profile?.methodVersion || "edge-arcs-1" };
}
