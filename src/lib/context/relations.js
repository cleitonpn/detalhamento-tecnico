import { createSpatialIndex } from "./spatial.js";
import { semanticRoleOf } from "../../domain/project.js";

// Interseção de triângulos projetados no mesmo plano (recorte convexo).
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function overlapArea(a, b) {
  let poly = a;
  const sign = Math.sign(cross(...b)) || 1;
  for (let i = 0; i < 3 && poly.length; i++) {
    const u = b[i], v = b[(i + 1) % 3], out = [];
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j], q = poly[(j + 1) % poly.length];
      const dp = sign * cross(u, v, p), dq = sign * cross(u, v, q);
      if (dp >= 0) out.push(p);
      if ((dp >= 0) !== (dq >= 0)) {
        const t = dp / (dp - dq);
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    poly = out;
  }
  return Math.abs(poly.reduce((s, p, i) => {
    const q = poly[(i + 1) % poly.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalKey = n => n.map(v => Math.round(v * 1000)).join("|");
const normalKeys = n => {
  const c = n.map(v => Math.round(v * 1000)), keys = [];
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) keys.push(`${c[0] + x}|${c[1] + y}|${c[2] + z}`);
  return keys;
};
function planarContact(a, b, tolerance) {
  for (const p of a.side) {
    for (const key of normalKeys(p.normal)) {
      for (const q of b.byNormal.get(key) || []) {
        // Coplanaridade de todos os vértices, e não só planos/envelopes próximos.
        if (Math.abs(dot(p.normal, q.normal)) < 1 - 1e-8 ||
          !q.vertices.every(v => Math.abs(dot(p.normal, v) - p.plane) <= tolerance) ||
          !p.vertices.every(v => Math.abs(dot(q.normal, v) - q.plane) <= tolerance)) continue;
        if (![0, 1, 2].every(k => p.max[k] >= q.min[k] - tolerance && q.max[k] >= p.min[k] - tolerance)) continue;
        const axis = p.normal.reduce((best, v, k) => Math.abs(v) > Math.abs(p.normal[best]) ? k : best, 0);
        const project = v => v.filter((_, k) => k !== axis);
        const area = overlapArea(p.vertices.map(project), q.vertices.map(project));
        if (area > 1e-6) return {
          orientation: Math.abs(p.normal[1]) <= 1e-6 ? "lateral" : "inclined",
          normal: p.normal,
          patchAreaM2: area / Math.abs(p.normal[axis]),
        };
      }
    }
  }
  return null;
}

/** Grafo conservador: contatos verificados exigem sobreposição de triângulos coplanares. */
export function buildRelations(parts, { trianglesOf, tolerance = 0.01, contactTolerance = 0.0001, maxPairs = 10000, maxPatches = 256, onProgress = () => {} } = {}) {
  if (!(tolerance >= 0) || !Number.isFinite(tolerance) || !(contactTolerance >= 0) || !Number.isFinite(contactTolerance) || contactTolerance > tolerance || !Number.isSafeInteger(maxPairs) || !Number.isSafeInteger(maxPatches) || maxPairs < 1 || maxPatches < 1)
    throw Error("Limites do grafo inválidos.");
  const index = createSpatialIndex(parts), edges = [], seen = new Set(), patches = new Map();
  let testedPairs = 0, truncated = false;
  const surfaces = p => {
    if (patches.has(p.id)) return patches.get(p.id);
    const result = { top: [], bottom: [], side: [], byNormal: new Map(), truncated: false };
    const tris = trianglesOf(p) || [];
    for (let i = 0; i + 8 < tris.length; i += 9) {
      const vertices = [0, 3, 6].map(o => [tris[i + o], tris[i + o + 1], tris[i + o + 2]]);
      if (!vertices.every(v => v.every(Number.isFinite))) { result.truncated = true; continue; }
      const u = vertices[1].map((v, k) => v - vertices[0][k]);
      const v = vertices[2].map((v, k) => v - vertices[0][k]);
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const length = Math.hypot(...normal);
      if (!(length > 1e-8)) continue;
      normal.forEach((n, k) => { normal[k] = n / length; });
      if (Math.abs(normal[1]) < 1 - 1e-8) {
        if (result.side.length < maxPatches) result.side.push({
          normal, vertices, plane: dot(normal, vertices[0]),
          min: [0, 1, 2].map(k => Math.min(...vertices.map(v => v[k]))),
          max: [0, 1, 2].map(k => Math.max(...vertices.map(v => v[k]))),
        });
        else result.truncated = true;
      }
      const ys = [tris[i + 1], tris[i + 4], tris[i + 7]];
      if (Math.max(...ys) - Math.min(...ys) > contactTolerance) continue;
      const t = [[tris[i], tris[i + 2]], [tris[i + 3], tris[i + 5]], [tris[i + 6], tris[i + 8]]];
      if (Math.abs(cross(...t)) < 1e-8) continue;
      for (const [key, plane] of [["top", p.bounds.max[1]], ["bottom", p.bounds.min[1]]]) {
        if (ys.every(y => Math.abs(y - plane) <= contactTolerance)) {
          if (result[key].length < maxPatches) result[key].push(t);
          else result.truncated = true;
        }
      }
    }
    for (const patch of result.side) {
      for (const n of [patch.normal, patch.normal.map(v => -v)]) {
        const key = normalKey(n);
        if (!result.byNormal.has(key)) result.byNormal.set(key, []);
        result.byNormal.get(key).push(patch);
      }
    }
    patches.set(p.id, result);
    return result;
  };
  outer: for (const a of parts) {
    for (const b of index.query(a.bounds, tolerance)) {
      if (a.id === b.id) continue;
      const key = JSON.stringify([a.id, b.id].sort());
      if (seen.has(key)) continue;
      seen.add(key);
      if (testedPairs >= maxPairs) { truncated = true; break outer; }
      testedPairs++;
      if (testedPairs % 100 === 0) onProgress(testedPairs);
      const overlaps = [0, 1, 2].map(k => Math.min(a.bounds.max[k], b.bounds.max[k]) - Math.max(a.bounds.min[k], b.bounds.min[k]));
      if (Math.hypot(...overlaps.map(n => Math.max(0, -n))) > tolerance) continue;
      let edge = { a: a.id, b: b.id, relation: "near-envelope", evidence: "bounds-only", verified: false };
      const upper = a.bounds.min[1] >= b.bounds.min[1] ? a : b;
      const lower = upper === a ? b : a;
      const gap = upper.bounds.min[1] - lower.bounds.max[1];
      if (Math.abs(gap) <= tolerance && overlaps[0] > 0 && overlaps[2] > 0) {
        edge = { ...edge, a: upper.id, b: lower.id, relation: "possible-support", gap };
        if (trianglesOf && Math.abs(gap) <= contactTolerance) {
          const top = surfaces(lower), bottom = surfaces(upper);
          let contact = false;
          for (const t of top.top) {
            if (bottom.bottom.some(u => overlapArea(t, u) > 1e-6)) { contact = true; break; }
          }
          edge = { ...edge, ...(contact ? { relation: "surface-contact", evidence: "horizontal-triangles", orientation: "horizontal", verified: true } : {}),
            geometryTruncated: top.truncated || bottom.truncated };
        }
      }
      if (trianglesOf && !edge.verified) {
        const sa = surfaces(a), sb = surfaces(b);
        const contact = planarContact(sa, sb, contactTolerance);
        edge = { ...edge, ...(contact ? { ...contact, relation: "surface-contact", evidence: "planar-triangles", verified: true } : {}),
          geometryTruncated: sa.truncated || sb.truncated };
      }
      edges.push(edge);
    }
  }
  const neighbors = new Map(parts.map(p => [p.id, []]));
  edges.forEach(e => { neighbors.get(e.a).push(e); neighbors.get(e.b).push(e); });
  return { edges, neighbors, testedPairs, truncated, index, tolerance, contactTolerance };
}

/** Identidade candidata, nunca aprovação de construção ou capacidade portante. */
export function inferSurfaceRole(part, graph, parts) {
  const [w, h, d] = part.dimensions || [];
  if (!(h <= 0.06 && w >= 0.2 && d >= 0.2) || !graph) return null;
  const contact = (graph.neighbors.get(part.id) || []).filter(e =>
    e.a === part.id && e.relation === "surface-contact" && e.verified && e.evidence === "horizontal-triangles");
  const byId = new Map(parts.map(p => [p.id, p]));
  const bases = contact.map(e => byId.get(e.b)).filter(Boolean);
  if (bases.some(p => semanticRoleOf(p) === "counter"))
    return { role: "countertop", reason: "Chapa em contato horizontal com um corpo identificado como balcão. Confira a identidade e a construção." };
  const legs = bases.filter(p => Math.max(p.dimensions[0], p.dimensions[2]) <= 0.15 && p.dimensions[1] >= 0.3);
  if (legs.length >= 2)
    return { role: "tabletop", reason: "Chapa em contato com pelo menos dois perfis verticais: possível tampo de mesa. Não determina se é locada ou fabricada." };
  const sideContact = (graph.neighbors.get(part.id) || []).filter(e =>
    e.verified && e.relation === "surface-contact" && e.orientation === "lateral");
  if (sideContact.some(e => semanticRoleOf(byId.get(e.a === part.id ? e.b : e.a) || {}) === "wall"))
    return { role: "shelf", reason: "Chapa horizontal em contato lateral verificado com uma parede: possível prateleira. Fixações e capacidade de carga não foram verificadas." };
  return null;
}

export function inferContextRole(part, graph, parts) {
  if (!graph) return null;
  const role = semanticRoleOf(part);
  // Identidades explícitas de decoração/mobiliário não viram componentes de obra
  // por coincidirem com um envelope ou contato.
  if (["vegetation", "logo", "furniture", "equipment", "light", "render"].includes(role)) return null;
  const surface = inferSurfaceRole(part, graph, parts);
  if (surface) return surface;
  const byId = new Map(parts.map(p => [p.id, p]));
  const contacts = (graph.neighbors.get(part.id) || []).filter(e => e.verified);
  const other = e => byId.get(e.a === part.id ? e.b : e.a);
  const [w, h, d] = part.dimensions;
  if (["unclassified", "other"].includes(part.review.kind) && w >= 1 && h >= 1.5 && d <= .3 &&
    contacts.some(e => e.orientation === "horizontal" && e.a === part.id && semanticRoleOf(other(e) || {}) === "floor"))
    return { role: "wall", reason: "Painel vertical em contato horizontal verificado com piso identificado. Delimitação de ambiente e construção ainda exigem revisão." };
  const floors = parts.filter(p => semanticRoleOf(p) === "floor");
  const floorTop = floors.length ? Math.min(...floors.map(p => p.bounds.max[1])) : null;
  if (floorTop != null && h >= .2 && h <= 1.2 && w >= 1 && d <= .3 && part.bounds.min[1] - floorTop >= 1.8 &&
    contacts.some(e => {
      const p = other(e);
      if (!p || semanticRoleOf(p) !== "wall" || !part.frame || !p.frame) return false;
      return Math.abs(dot(part.frame.axes[0], p.frame.axes[0])) >= .98;
    })) return { role: "fascia", reason: "Faixa elevada, alinhada e em contato geométrico com parede identificada, acima do piso. Possível testeira; não confirma suporte ou fixação." };
  return null;
}

export function contextFacts(part, graph, parts) {
  const byId = new Map(parts.map(p => [p.id, p])), facts = [];
  for (const edge of graph?.neighbors.get(part.id) || []) {
    const p = byId.get(edge.a === part.id ? edge.b : edge.a);
    if (edge.verified && semanticRoleOf(part) === "vegetation" && semanticRoleOf(p || {}) === "wall")
      facts.push({ relation: "vegetation-at-wall", otherId: p.id, evidence: edge.evidence,
        text: `Vegetação em contato com ${p.label}. Possível suporte decorativo, sem confirmação de fixação.` });
  }
  return facts;
}
