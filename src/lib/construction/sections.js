import { detectArcs } from "../techdraw.js";
export const SURFACE_SECTIONS_VERSION = "triangle-sections-2";

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Interseções reais de triângulos com planos locais Y=constante. Não usa arestas
// projetadas nem interpola superfícies que o importador não recuperou.
export function sectionSegments(triangles, height, epsilon = 1e-7) {
  const segments = [];
  for (let i = 0; i + 8 < triangles.length; i += 9) {
    const points = [0, 3, 6].map(k => [triangles[i + k], triangles[i + k + 1], triangles[i + k + 2]]);
    const hits = [];
    if (!points.every(p => p.every(Number.isFinite))) continue;
    // Faces contidas no plano não definem um corte transversal único.
    if (points.every(p => Math.abs(p[1] - height) <= epsilon)) continue;
    for (let k = 0; k < 3; k++) {
      const a = points[k], b = points[(k + 1) % 3], da = a[1] - height, db = b[1] - height;
      if (Math.abs(da) <= epsilon) hits.push([a[0], a[2]]);
      else if ((da < 0) !== (db < 0)) {
        const t = da / (da - db);
        hits.push([a[0] + t * (b[0] - a[0]), a[2] + t * (b[2] - a[2])]);
      }
    }
    const unique = hits.filter((p, k) => hits.findIndex(q => distance(p, q) <= epsilon) === k);
    if (unique.length === 2 && distance(...unique) > epsilon) segments.push([...unique[0], ...unique[1]]);
  }
  return segments;
}

// Elimina vértices internos de triangulação sobre uma mesma reta. Mantém quinas,
// junções e componentes separados, evitando que uma diagonal reduza o raio ajustado.
function mergeCollinear(lines, epsilon) {
  const key = p => p.map(v => Math.round(v / epsilon)).join(":");
  const segments = new Map(), nodes = new Map();
  for (const line of lines) {
    const a = line.slice(0, 2), b = line.slice(2), ka = key(a), kb = key(b);
    if (ka === kb) continue;
    const id = [ka, kb].sort().join("|");
    if (segments.has(id)) continue;
    segments.set(id, { a, b, ka, kb });
    for (const k of [ka, kb]) { if (!nodes.has(k)) nodes.set(k, new Set()); nodes.get(k).add(id); }
  }
  for (const [k, edges] of nodes) {
    if (edges.size !== 2) continue;
    const [ia, ib] = [...edges], a = segments.get(ia), b = segments.get(ib);
    if (!a || !b) continue;
    const p = a.ka === k ? a.b : a.a, mid = a.ka === k ? a.a : a.b, q = b.ka === k ? b.b : b.a;
    const u = [p[0] - mid[0], p[1] - mid[1]], v = [q[0] - mid[0], q[1] - mid[1]];
    if (Math.abs(u[0] * v[1] - u[1] * v[0]) > epsilon * Math.max(Math.hypot(...u), Math.hypot(...v)) || u[0] * v[0] + u[1] * v[1] >= 0) continue;
    const kp = key(p), kq = key(q), id = [kp, kq].sort().join("|");
    segments.delete(ia); segments.delete(ib); edges.clear();
    nodes.get(kp)?.delete(ia); nodes.get(kq)?.delete(ib);
    if (segments.has(id)) continue;
    segments.set(id, { a: p, b: q, ka: kp, kb: kq });
    nodes.get(kp)?.add(id); nodes.get(kq)?.add(id);
  }
  return [...segments.values()].map(s => [...s.a, ...s.b]);
}

export function analyzeSurfaceSections(triangles, dimensions, { maxTriangles = 50000, maxSegments = 8000, toleranceM = .002 } = {}) {
  if (!Number.isSafeInteger(maxTriangles) || maxTriangles < 1 || !Number.isSafeInteger(maxSegments) || maxSegments < 1 || !Number.isFinite(toleranceM) || toleranceM <= 0)
    throw Error("Limites de seções inválidos.");
  const empty = (reason, truncated = false) => ({ kind: "insufficient", arcs: [], lines: [], sections: [], reason, truncated, basis: "triangle-sections", methodVersion: SURFACE_SECTIONS_VERSION, toleranceM });
  if (!triangles?.length || triangles.length % 9 || !dimensions?.every(n => Number.isFinite(n) && n >= 0) || dimensions.length !== 3 || dimensions[1] < .05)
    return empty("Altura ou geometria insuficiente para comparar três seções.");
  if (triangles.length / 9 > maxTriangles) return empty("Limite de triângulos atingido; não foi inferida uma superfície completa.", true);
  if (!triangles.every(Number.isFinite)) return empty("Coordenadas inválidas na malha.");
  const sections = [];
  for (const fraction of [.2, .5, .8]) {
    const height = dimensions[1] * fraction, raw = sectionSegments(triangles, height);
    if (!raw.length || raw.length > maxSegments) return empty("Seção ausente ou limite de segmentos atingido.", raw.length > maxSegments);
    const lines = mergeCollinear(raw, 1e-6), found = detectArcs(lines, { minSegments: 4 });
    const arcs = found.filter(a => a.segments >= 6 && Math.abs(a.sweep) >= Math.PI / 6 && a.deviation <= toleranceM);
    sections.push({ height, lines, arcs, freeCurves: found.freeCurves || 0 });
  }
  const middle = sections[1];
  const matches = (a, b) => Math.abs(a.r - b.r) <= toleranceM && Math.hypot(a.cx - b.cx, a.cy - b.cy) <= toleranceM &&
    Math.abs(Math.abs(a.sweep) - Math.abs(b.sweep)) <= .02 &&
    (a.full && b.full || distance(a.points[0], b.points[0]) <= toleranceM && distance(a.points.at(-1), b.points.at(-1)) <= toleranceM ||
      distance(a.points[0], b.points.at(-1)) <= toleranceM && distance(a.points.at(-1), b.points[0]) <= toleranceM);
  const arcs = middle.arcs.filter(a => sections.every(s => s.arcs.some(b => matches(a, b)))).sort((a, b) => b.r - a.r).map((a, k) => ({
    id: `S${k + 1}`, view: "top", r: a.r, sweep: a.sweep, start: a.start, cx: a.cx, cy: a.cy,
    segments: a.segments, deviation: Math.max(...sections.map(s => s.arcs.find(b => matches(a, b)).deviation)),
    confidence: "três seções compatíveis", basis: "surface-sections", sectionHeights: sections.map(s => s.height),
    path: { center: [a.cx, a.cy], radiusM: a.r, startRad: a.start, sweepRad: a.sweep },
  }));
  const sameLine = (a, b) => distance(a.slice(0, 2), b.slice(0, 2)) <= toleranceM && distance(a.slice(2), b.slice(2)) <= toleranceM ||
    distance(a.slice(0, 2), b.slice(2)) <= toleranceM && distance(a.slice(2), b.slice(0, 2)) <= toleranceM;
  const lines = middle.lines.filter(a => distance(a.slice(0, 2), a.slice(2)) >= .15 && sections.every(s => s.lines.some(b => sameLine(a, b))))
    .sort((a, b) => distance(b.slice(0, 2), b.slice(2)) - distance(a.slice(0, 2), a.slice(2)))
    .slice(0, 12).map((a, k) => ({ id: `L${k + 1}`, lengthM: distance(a.slice(0, 2), a.slice(2)), points: [a.slice(0, 2), a.slice(2)] }));
  const varying = sections.some(s => s.arcs.length !== arcs.length) || arcs.length === 0 && sections.some(s => s.arcs.length > 0);
  const independent = arcs.some(a => arcs.some(b => Math.hypot(a.cx - b.cx, a.cy - b.cy) > toleranceM));
  const prismatic = sections.every(s => s.lines.length === middle.lines.length && middle.lines.every(a => s.lines.some(b => sameLine(a, b))));
  const kind = varying ? "varying-section" : independent ? "multi-radius" : arcs.length && !sections.some(s => s.freeCurves) ? "cylindrical-candidate" :
    sections.some(s => s.freeCurves) ? "irregular" : prismatic ? "prismatic-candidate" : "varying-section";
  let variation = null;
  if (kind === "varying-section" && sections.every(s => s.arcs.length === 1)) {
    const [a, b, c] = sections.map(s => s.arcs[0]);
    const concentric = [a, c].every(p => Math.hypot(p.cx - b.cx, p.cy - b.cy) <= toleranceM && Math.abs(Math.abs(p.sweep) - Math.abs(b.sweep)) <= .02);
    if (concentric) variation = Math.abs((a.r + c.r) / 2 - b.r) <= toleranceM ? "linear-radius-candidate" : "nonlinear-radius";
  }
  const developmentPolicy = kind === "cylindrical-candidate" ? "circular-reference-only" : kind === "prismatic-candidate" ? "planar-reference-only" : "manual-required";
  return { kind, arcs, lines, basis: "triangle-sections", truncated: false, toleranceM,
    variation, developmentPolicy, methodVersion: SURFACE_SECTIONS_VERSION,
    sections: sections.map(s => ({ heightM: s.height, segments: s.lines.length, circularRuns: s.arcs.length, freeCurves: s.freeCurves,
      estimatedRadiiM: s.arcs.map(a => a.r), maxResidualM: Math.max(0, ...s.arcs.map(a => a.deviation)) })),
    reason: kind === "varying-section" ? "Os cortes mudam com a altura; cone, dupla curvatura ou conjunto irregular precisam de revisão própria." :
      kind === "multi-radius" ? "Mais de um centro/trecho circular: não desenvolver a peça inteira com um único raio." :
      "Três cortes locais comparados; isso não prova continuidade entre cortes, espessura ou construção interna.",
  };
}
