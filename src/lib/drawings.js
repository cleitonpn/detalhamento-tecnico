import { materialLabel, destinationOf } from "../domain/project.js";
import {
  VIEW_DEFS,
  partEdges,
  partTriangles,
  projectSegments,
  detectArcs,
  smoothEdges,
  silhouettes,
} from "./techdraw.js";
import {
  analyzePart,
  buildSheet,
  buildOverview,
  drawSheetPdf,
} from "./sheet.js";
import { overviewImage } from "./hlr.js";
import { groupIdentical } from "./auto/index.js";
import { constructionReport, appendConstructionPdf } from "./construction/report.js";

// Vista cotada de uma peça (usada na tela, nos testes e no PDF).
export function buildDrawing(part, meshMap, sourceUnit, view = "front") {
  const { segments, simplified } = partEdges(part, meshMap, sourceUnit);
  const [width, height] = VIEW_DEFS[view].size(part.dimensions);
  const smooth = simplified
    ? []
    : smoothEdges(partTriangles(part, meshMap, sourceUnit));
  const projected = projectSegments(
    [...segments, ...silhouettes(smooth, view)],
    view,
    part.dimensions,
  );
  const flat = (l) => [l[0], l[1], l[3], l[4]];
  return {
    view,
    width,
    height,
    simplified,
    lines: projected.map(flat),
    arcs: detectArcs(projected.map(flat)),
  };
}
export function formatM(n) {
  return Number(n).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}

// Fora do caderno técnico: o que não é construído pelo stand (TV, equipamentos,
// iluminação de terceiros) e o que a equipe marcou como fora do detalhamento
export const OUTSIDE = new Set(["ignore", "equipment", "light"]);

/**
 * Peças que entram no caderno: só as validadas e não ignoradas. Peças idênticas
 * (mesma impressão digital e mesma decisão) viram uma folha com a quantidade.
 */
export const sheetParts = (project) =>
  groupIdentical(
    project.parts.filter(
      (p) => p.review.confirmed && destinationOf(p) === "technical",
    ),
  ).map((g) => ({
    ...g.part,
    quantity: g.quantity,
    // Todas as cópias, para destacar na vista geral
    allMeshIds: g.parts.flatMap((p) => p.meshIds),
  }));

const analyses = new WeakMap();
/** Análise da peça (vistas, linhas ocultas, raios, 3D), reaproveitada enquanto a peça não mudar. */
export function partAnalysis(part, meshMap, sourceUnit) {
  if (!analyses.has(meshMap)) analyses.set(meshMap, new Map());
  const cache = analyses.get(meshMap);
  const key = `${part.id}|${sourceUnit}|${part.meshIds.join(",")}|${part.dimensions.join(",")}|${JSON.stringify(part.frame)}`;
  if (!cache.has(key)) {
    if (cache.size > 60) cache.delete(cache.keys().next().value);
    cache.set(key, analyzePart(part, meshMap, sourceUnit));
  }
  return cache.get(key);
}

export function partSheet(project, part, meshMap, index, preview, unit = "cm") {
  const find = (id) => project.materials.find((m) => m.id === id);
  return buildSheet({
    project,
    part,
    index,
    preview,
    unit,
    analysis: partAnalysis(part, meshMap, project.sourceUnit),
    material: materialLabel(find(part.review.materialId)) || "A informar",
    finish: materialLabel(find(part.review.finishId)) || "Não informado",
  });
}

let overviewCache = { key: "", value: null };
/** Página de vista geral: stand inteiro com as peças do caderno destacadas e numeradas. */
export function overviewSheet(
  project,
  parts,
  meshMap,
  preview,
  unit = "cm",
  corner = "auto",
) {
  const key = `${corner}|${project.sourceUnit}|${parts.map((p) => `${p.id}:${(p.allMeshIds || p.meshIds).length}`).join(",")}|${meshMap.size}`;
  if (overviewCache.key !== key || overviewCache.meshMap !== meshMap)
    overviewCache = {
      key,
      meshMap,
      value: overviewImage(
        project,
        meshMap,
        parts.map((p) => (p.allMeshIds ? { ...p, meshIds: p.allMeshIds } : p)),
        project.sourceUnit,
        { corner },
      ),
    };
  // `corner`: ângulo usado (0–3), para a tela poder girar a partir dele
  return {
    corner: overviewCache.value?.corner ?? 0,
    ...buildOverview({
      unit,
      project,
      parts,
      overview: overviewCache.value,
      preview,
    }),
  };
}

export async function downloadPdf(
  project,
  parts,
  meshMap,
  { preview = false, unit = "cm", corner = "auto" } = {},
) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  pdf.setTextColor("#173b48");
  pdf.setFontSize(24);
  pdf.text(project.name, 18, 30);
  pdf.setFontSize(13);
  pdf.text("Caderno de detalhamento técnico", 18, 45);
  pdf.setFontSize(10);
  pdf.text(
    `Cliente: ${project.client || "A informar"} | Feira: ${project.fair || "A informar"}`,
    18,
    58,
  );
  pdf.text(
    `${preview ? "PRÉVIA, sem revisão registrada" : `Revisão ${project.revision || 0}`} | ${parts.length} itens (${parts.reduce((n, p) => n + (p.quantity || 1), 0)} peças) | Cotas em ${unit}`,
    18,
    67,
  );
  pdf.setTextColor("#ad413d");
  pdf.text(
    "Não contém dimensionamento estrutural ou liberação de fabricação.",
    18,
    82,
  );
  pdf.setTextColor("#173b48");
  pdf.text(
    "Classificação e medidas conferidas pela equipe. Raios estimados da geometria do modelo.",
    18,
    93,
  );
  pdf.setFontSize(9);
  parts
    .slice(0, 22)
    .forEach((p, i) =>
      pdf.text(
        `${String(i + 1).padStart(2, "0")}  ${p.label}`.slice(0, 70),
        18 + Math.floor(i / 11) * 130,
        108 + (i % 11) * 6,
      ),
    );
  pdf.setFontSize(8);
  pdf.text(`Origem: ${project.file.name}`, 18, 186);
  pdf.text(`SHA-256: ${project.file.hash}`, 18, 193);
  if (parts.length) {
    pdf.addPage();
    drawSheetPdf(
      pdf,
      overviewSheet(project, parts, meshMap, preview, unit, corner),
    );
  }
  for (const [index, part] of parts.entries()) {
    pdf.addPage();
    drawSheetPdf(pdf, partSheet(project, part, meshMap, index, preview, unit));
    appendConstructionPdf(pdf, constructionReport(project, part, partAnalysis(part, meshMap, project.sourceUnit)));
  }
  pdf.save(
    `${project.name.replace(/[^p{L}p{N} _-]/gu, "").slice(0, 80)}-${preview ? "PREVIA" : `R${project.revision || 0}`}.pdf`,
  );
}
