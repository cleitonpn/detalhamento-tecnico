import * as THREE from "three";
import { materialLabel, SCALE } from "../domain/project.js";

const cachedEdges = new WeakMap();
const VIEWS = { front: [0, 1], top: [0, 2], side: [2, 1] };
export function buildDrawing(part, meshMap, sourceUnit, view = "front") {
  const [u, v] = VIEWS[view],
    scale = SCALE[sourceUnit],
    lines = [];
  const origin = new THREE.Vector3(...(part.frame?.origin || part.bounds.min));
  const axes = (
    part.frame?.axes || [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
  ).map((a) => new THREE.Vector3(...a));
  let simplified = false;
  for (const id of part.meshIds) {
    const mesh = meshMap.get(id);
    if (!mesh) continue;
    let edges = cachedEdges.get(mesh.geometry);
    if (!edges) {
      const geometry = new THREE.EdgesGeometry(mesh.geometry, 30);
      edges = Array.from(geometry.attributes.position.array);
      geometry.dispose();
      cachedEdges.set(mesh.geometry, edges);
    }
    if (edges.length / 6 + lines.length > 8000) {
      simplified = true;
      break;
    }
    for (let i = 0; i < edges.length; i += 6) {
      const points = [0, 3].map((j) => {
        const point = new THREE.Vector3(
          edges[i + j],
          edges[i + j + 1],
          edges[i + j + 2],
        )
          .applyMatrix4(mesh.matrixWorld)
          .multiplyScalar(scale)
          .sub(origin);
        return [point.dot(axes[u]), point.dot(axes[v])];
      });
      if (
        Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) >
        1e-7
      )
        lines.push(points.flat());
    }
  }
  const width = part.dimensions[u],
    height = part.dimensions[v];
  return {
    view,
    width,
    height,
    simplified,
    lines: simplified
      ? [
          [0, 0, width, 0],
          [width, 0, width, height],
          [width, height, 0, height],
          [0, height, 0, 0],
        ]
      : lines,
  };
}
export function formatM(n) {
  return Number(n).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}

export function drawingSvg(part, drawing) {
  const margin = Math.max(drawing.width, drawing.height, 0.1) * 0.17;
  const width = Math.max(drawing.width, 0.03),
    height = Math.max(drawing.height, 0.03);
  const x = (n) => n + margin,
    y = (n) => height - n + margin;
  const font = Math.max(width, height) * 0.045;
  const path = drawing.lines
    .map(([a, b, c, d]) => `M${x(a)},${y(b)}L${x(c)},${y(d)}`)
    .join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width + margin * 2} ${height + margin * 2}" role="img" aria-label="Vista cotada"><path d="${path}" fill="none" stroke="#173b48" stroke-width="${font * 0.035}"/><path d="M${x(0)},${y(height) - margin * 0.45}H${x(width)}M${x(0) - margin * 0.45},${y(0)}V${y(height)}" fill="none" stroke="#c04949" stroke-width="${font * 0.025}"/><text x="${x(width / 2)}" y="${y(height) - margin * 0.6}" text-anchor="middle" fill="#c04949" font-size="${font}">${formatM(drawing.width)} m</text><text x="${x(0) - margin * 0.6}" y="${y(height / 2)}" text-anchor="middle" fill="#c04949" font-size="${font}" transform="rotate(-90 ${x(0) - margin * 0.6} ${y(height / 2)})">${formatM(drawing.height)} m</text></svg>`;
}

export async function downloadPdf(project, parts, meshMap) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const width = 297,
    pageHeight = 210;
  pdf.setTextColor("#173b48");
  pdf.setFontSize(24);
  pdf.text(project.name, 18, 30);
  pdf.setFontSize(13);
  pdf.text("Caderno de levantamento dimensional", 18, 45);
  pdf.setFontSize(10);
  pdf.text(
    `Cliente: ${project.client || "A informar"} | Feira: ${project.fair || "A informar"}`,
    18,
    58,
  );
  pdf.text(
    `Revisão ${project.revision || 0} | ${parts.length} peças | Medidas em metros`,
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
    "Classificação e medidas conferidas pela equipe. Geometria extraída do GLB.",
    18,
    93,
  );
  pdf.setFontSize(8);
  pdf.text(`Origem: ${project.file.name}`, 18, 105);
  pdf.text(`SHA-256: ${project.file.hash}`, 18, 114);
  for (const [index, part] of parts.entries()) {
    pdf.addPage();
    pdf.setFontSize(18);
    pdf.text(
      `${String(index + 1).padStart(2, "0")} | ${part.label.slice(0, 80)}`,
      16,
      20,
    );
    pdf.setFontSize(9);
    pdf.text(`Medidas: ${part.dimensions.map(formatM).join(" × ")} m`, 16, 29);
    const views = [
      ["front", "VISTA FRONTAL"],
      ["top", "VISTA SUPERIOR"],
      ["side", "VISTA LATERAL"],
    ];
    views.forEach(([view, title], i) => {
      const d = buildDrawing(part, meshMap, project.sourceUnit, view);
      const left = 16 + i * 93,
        top = 50,
        areaWidth = 75,
        areaHeight = 88;
      const factor = Math.min(
        areaWidth / Math.max(d.width, 0.05),
        areaHeight / Math.max(d.height, 0.05),
      );
      const offsetX = left + (areaWidth - d.width * factor) / 2,
        offsetY = top + (areaHeight - d.height * factor) / 2;
      pdf.setFontSize(8);
      pdf.setTextColor("#173b48");
      pdf.text(title, left, 42);
      pdf.setDrawColor("#173b48");
      pdf.setLineWidth(0.15);
      d.lines.forEach(([a, b, c, e]) =>
        pdf.line(
          offsetX + a * factor,
          offsetY + (d.height - b) * factor,
          offsetX + c * factor,
          offsetY + (d.height - e) * factor,
        ),
      );
      pdf.setTextColor("#ad413d");
      pdf.text(`${formatM(d.width)} m`, left + areaWidth / 2, 150, {
        align: "center",
      });
      pdf.text(`${formatM(d.height)} m de altura na vista`, left, 156);
      if (d.simplified)
        pdf.text("Envelope simplificado pela complexidade.", left, 162);
    });
    pdf.setTextColor("#173b48");
    pdf.setFontSize(9);
    const material = project.materials.find(
      (m) => m.id === part.review.materialId,
    );
    const finish = project.materials.find((m) => m.id === part.review.finishId);
    pdf.text(
      `Material: ${materialLabel(material) || "Não especificado"} | Revestimento: ${materialLabel(finish) || "Sem revestimento informado"}`,
      16,
      177,
    );
    if (part.review.notes)
      pdf.text(
        pdf.splitTextToSize(part.review.notes, width - 32).slice(0, 2),
        16,
        191,
      );
    pdf.setFontSize(7);
    pdf.setTextColor("#6d7685");
    pdf.text(
      `Levantamento dimensional | Rev. ${project.revision || 0} | ${project.name.slice(0, 80)}`,
      16,
      pageHeight - 6,
    );
  }
  pdf.save(
    `${project.name.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80)}-R${project.revision || 0}.pdf`,
  );
}
