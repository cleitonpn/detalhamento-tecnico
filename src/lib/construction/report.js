import { assessConstruction, summarizeConstructionGeometry, constructionPreview } from "./index.js";

const names = { structure: "Estrutura", substrate: "Fechamento", finish: "Acabamento" };
export function constructionReport(project, part, analysis) {
  const proposal = part.review?.construction;
  if (!proposal) return null;
  const geometry = summarizeConstructionGeometry(analysis, { part, selectedArcId: proposal.referenceArc?.id,
    selectedView: proposal.referenceArc?.view, referenceSurface: proposal.referenceArc?.surface });
  const result = assessConstruction(proposal, { part, geometry, catalog: project.constructionCatalog, recipes: project.constructionRecipes });
  const lines = ["SOLUÇÃO CONSTRUTIVA PROPOSTA — NÃO LIBERA FABRICAÇÃO",
    `Peça: ${part.label}`, `Receita: ${result.recipe.name} · v${result.recipe.version}`,
    `Situação: ${result.missing.length ? "INCOMPLETA / PENDENTE DE REVISÃO" : "PROPOSTA PARA REVISÃO TÉCNICA"}`,
    result.notice];
  lines.push(`Método geométrico conferido: ${proposal.geometryVersion || "não registrado"}; gerador conferido: ${proposal.previewVersion || "não registrado"}.`);
  if (result.recipe.scope) lines.push(`Escopo de uso: ${result.recipe.scope}`);
  if (result.recipe.contraindications) lines.push(`Contraindicações / verificações manuais: ${result.recipe.contraindications}`);
  for (const [role, material] of Object.entries(result.layers)) {
    lines.push(`${names[role]}: ${material ? `${material.name} · v${material.version} · ${material.approved ? "aprovação declarada pela equipe" : "rascunho"}` : "não informado"}`);
    if (material) {
      lines.push(`  Dados cadastrados: ${JSON.stringify(material.parameters)}`);
      if (material.source) lines.push(`  Fonte: ${material.source}`);
      if (material.approved) lines.push(`  Responsável: ${material.approvedBy} · ${material.approvedAt}`);
    }
  }
  if (result.recipe.source) lines.push(`Fonte da receita: ${result.recipe.source} · ${result.recipe.approvedBy} · ${result.recipe.approvedAt}`);
  for (const p of result.recipe.parameters)
    lines.push(`${p.label}: ${proposal.parameters[p.key] ?? "pendente"} ${p.unit}`);
  lines.push(`Geometria: ${geometry.kind}`, ...geometry.warnings);
  if (geometry.development) {
    const d = geometry.development;
    lines.push(`Referência ${d.arcId} / ${d.view} / ${d.referenceSurface}: R=${d.radiusM.toFixed(4)} m; ângulo=${d.sweepRad.toFixed(4)} rad; R×ângulo=${d.lengthM.toFixed(4)} m.`,
      "Desenvolvimento geométrico da referência selecionada, NÃO é comprimento de corte.");
  }
  if (proposal.notes) lines.push(`Notas: ${proposal.notes}`);
  if (result.recipe.layout || result.recipe.components?.length) {
    const preview = constructionPreview(part, proposal, result, geometry);
    lines.push(`Estrutura proposta: ${preview.reason}`);
    if (preview.quantities) {
      const q = preview.quantities;
      if (q.kind === "components") {
        lines.push(`${q.panelCount} painéis; ${q.profileCount} perfis/reforços; ${q.connectionCount} marcadores de ligação.`,
          `Área dos painéis ${q.panelAreaM2.toFixed(3)} m²; eixos ${q.axisLengthM.toFixed(3)} m.`,
          ...result.components.map(c => `${c.name}: ${c.kind} · ${c.material.id} v${c.material.version}${c.detail ? ` · detalhe: ${c.detail}` : ""}`), q.notice);
      } else lines.push(`${q.count} montantes propostos; ${q.axisLengthM.toFixed(3)} m de eixos; reserva declarada ${q.axisAllowanceM.toFixed(3)} m.`,
          `Espaçamento efetivo ${q.actualSpacingM.toFixed(3)} m; área de referência ${q.referenceAreaM2.toFixed(3)} m².`, q.notice);
    }
  }
  if (result.missing.length) lines.push("PENDÊNCIAS:", ...result.missing.map(m => `- ${m}`));
  return { ...result, lines };
}

export function appendConstructionPdf(pdf, report) {
  if (!report) return;
  let y = 18;
  const newPage = () => { pdf.addPage(); pdf.setTextColor("#173b48"); pdf.setFontSize(9); y = 18; };
  newPage();
  for (const line of report.lines) {
    for (const row of pdf.splitTextToSize(line, 260)) {
      if (y > 190) newPage();
      pdf.text(row, 18, y); y += 5;
    }
    y += 2;
  }
}
