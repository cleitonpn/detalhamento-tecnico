// Quantidades de referência separadas do modelo existente. Nunca são lista de
// corte: não descontam encaixes, seções nas extremidades, aberturas ou conexões.
export const CONSTRUCTION_PREVIEW_VERSION = "axes-components-2";
export function constructionPreview(part, proposal, assessment, geometry, { maxMembers = 500 } = {}) {
  const blocked = reason => ({ status: "blocked", reason, members: [], quantities: null, fabricationRelease: false });
  if (!Number.isSafeInteger(maxMembers) || maxMembers < 2) throw Error("Limite de membros inválido.");
  if (!proposal || assessment?.status !== "proposal") return blocked("Complete as pendências da proposta antes de gerar eixos ou quantitativos.");
  if (proposal.previewVersion !== CONSTRUCTION_PREVIEW_VERSION || proposal.geometryVersion !== geometry?.methodVersion)
    return blocked("Método geométrico/gerador não conferido nesta versão. Atualize explicitamente a conferência antes de recalcular a proposta.");
  if (assessment.components?.length) {
    if (proposal.structureSurveyed !== true) return blocked("Confira os componentes já modelados antes de propor outros.");
    const p = proposal.parameters;
    if (![p.widthM, p.heightM, p.depthM].every((n, k) => Number.isFinite(n) && n > 0 && Math.abs(n - part.dimensions[k === 0 ? 0 : k === 1 ? 1 : 2]) <= Math.max(.005, n * .01)))
      return blocked("Largura, altura e profundidade precisam corresponder à geometria para posicionar os componentes.");
    if (!Number.isFinite(p.lossRatio) || p.lossRatio < 0 || p.lossRatio > 1) return blocked("Informe a reserva de perda da proposta.");
    const components = assessment.components;
    if (components.some(c => c.kind === "panel") && geometry?.surfaceSections?.kind !== "prismatic-candidate")
      return blocked("Painéis retangulares exigem referência prismática. Não converter fechamento curvo/livre em balcão retangular automaticamente.");
    const points = components.flatMap(c => c.kind === "panel" ? [-1, 1].map(sign => c.center.map((v, k) => v + sign * c.size[k] / 2)) : c.center ? [c.center] : [c.start, c.end]);
    if (points.some(point => point.some((v, k) => v < -.005 || v > part.dimensions[k] + .005))) return blocked("Componentes fora do envelope de referência: conferir parâmetros e posições.");
    if (components.length > maxMembers) return blocked("Limite de componentes atingido; nenhuma proposta parcial foi gerada.");
    const members = components.filter(c => c.kind === "profile" || c.kind === "brace"), panels = components.filter(c => c.kind === "panel"), connections = components.filter(c => c.kind === "connection");
    const axisLengthM = members.reduce((n, m) => n + m.lengthM, 0);
    return { status: "reference-only", members, panels, connections, fabricationRelease: false,
      reason: "Componentes da receita aprovada, separados do existente. Ligações são marcadores de detalhe, não dimensionamento de fixações.",
      quantities: { kind: "components", proposedOnly: true, count: components.length, panelCount: panels.length, profileCount: members.length, connectionCount: connections.length,
        panelAreaM2: panels.reduce((n, c) => n + c.areaM2, 0), axisLengthM, axisAllowanceM: axisLengthM * p.lossRatio, lossRatio: p.lossRatio,
        notice: "Quantitativos preliminares de componentes propostos. Não descontam usinagens, encaixes ou recortes; não são lista de corte/compra nem se somam automaticamente ao modelo existente." } };
  }
  if (!assessment.recipe?.layout) return blocked("A receita precisa de um método de distribuição explicitamente aprovado em nova versão.");
  if (assessment.recipe.layout.kind !== "vertical-studs" || !["straight", "circular"].includes(assessment.recipe.geometry))
    return blocked("Esta receita ainda não possui geração de componentes compatível.");
  if (proposal.structureSurveyed !== true) return blocked("Confira a estrutura já modelada. A proposta não será somada à estrutura existente.");
  const p = proposal.parameters, structure = assessment.layers?.structure;
  if (![p.heightM, p.spacingM].every(v => Number.isFinite(v) && v > 0) || ![p.clearanceM, p.lossRatio].every(v => Number.isFinite(v) && v >= 0) || p.lossRatio > 1 || !structure)
    return blocked("Faltam parâmetros finitos ou material da estrutura.");
  const profile = geometry?.surfaceSections;
  if (!profile || profile.truncated || !["cylindrical-candidate", "prismatic-candidate"].includes(profile.kind))
    return blocked("Seções de superfície insuficientes para posicionar os eixos da proposta.");
  const heightTolerance = Math.max(.005, part.dimensions[1] * .01);
  if (Math.abs(p.heightM - part.dimensions[1]) > heightTolerance)
    return blocked("A altura informada difere da malha; não posicionar a proposta automaticamente.");
  let length, pointAt, closed = false;
  if (assessment.recipe.geometry === "circular") {
    const d = geometry.development;
    if (!proposal.referenceArc?.representsSurface || d?.basis !== "surface-sections" || !d.path || !Number.isFinite(d.path.startRad) ||
      !Number.isFinite(d.path.sweepRad) || Math.abs(d.path.sweepRad) < 1e-8 || !Array.isArray(d.path.center) || d.path.center.length !== 2 || !d.path.center.every(Number.isFinite) ||
      ![d.path.radiusM, d.lengthM].every(v => Number.isFinite(v) && v > 0)) return blocked("Selecione e confirme uma curva sustentada por seções de superfície.");
    length = d.lengthM;
    closed = Math.abs(Math.abs(d.path.sweepRad) - 2 * Math.PI) < 1e-6 && p.clearanceM === 0;
    pointAt = s => {
      const angle = d.path.startRad + d.path.sweepRad * s / length;
      return [d.path.center[0] + d.path.radiusM * Math.cos(angle), d.path.center[1] + d.path.radiusM * Math.sin(angle)];
    };
  } else {
    if (!(Number.isFinite(p.widthM) && p.widthM > 0)) return blocked("Informe a largura positiva da referência reta.");
    const line = profile.lines.find(line => line.id === proposal.referenceLine?.id);
    if (!line || !proposal.referenceLine.representsSurface) return blocked("Selecione e confirme uma linha reta comum às três seções.");
    if (Math.abs(line.lengthM - p.widthM) > Math.max(.005, line.lengthM * .01)) return blocked("A largura informada difere da referência reta escolhida.");
    length = line.lengthM;
    pointAt = s => line.points[0].map((v, k) => v + (line.points[1][k] - v) * s / length);
  }
  const usable = length - 2 * p.clearanceM;
  if (!(usable > 0)) return blocked("As folgas nas duas extremidades consomem o comprimento da referência.");
  const bays = Math.ceil(usable / p.spacingM), count = bays + (closed ? 0 : 1);
  if (!Number.isSafeInteger(count) || count > maxMembers) return blocked("Limite de eixos atingido. Não foi gerada uma estrutura parcial.");
  const members = Array.from({ length: count }, (_, k) => {
    const [x, z] = pointAt(p.clearanceM + usable * k / bays);
    return { id: `proposed-${part.id}-${k + 1}`, source: "proposed", start: [x, 0, z], end: [x, p.heightM, z],
      material: { id: structure.id, version: structure.version }, sectionMm: [structure.parameters.sectionWidthMm, structure.parameters.sectionHeightMm] };
  });
  return { status: "reference-only", members, fabricationRelease: false,
    reason: "Eixos sobre a referência escolhida, não posição final dos perfis. Não verifica travessas, reforços, conexões ou estabilidade.",
    quantities: { proposedOnly: true, count, axisLengthM: count * p.heightM, referenceAreaM2: length * p.heightM,
      axisAllowanceM: count * p.heightM * p.lossRatio, actualSpacingM: usable / bays, lossRatio: p.lossRatio,
      notice: "Quantitativo preliminar de eixos; não é lista de corte ou compra. Área de referência sem desconto de aberturas. Não somar ao existente sem levantamento próprio." },
  };
}
