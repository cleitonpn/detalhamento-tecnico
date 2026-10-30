import { SCALE } from "../../domain/project.js";
import { buildRelations } from "./relations.js";

const abort = signal => { if (signal?.aborted) throw new DOMException("Análise cancelada", "AbortError"); };
const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));
export async function prepareRelationsPayload(parts, meshMap, unit, { signal, onProgress = () => {}, maxVertices = 3000000, maxIndices = 9000000 } = {}) {
  if (!Number.isSafeInteger(maxVertices) || maxVertices < 1 || !Number.isSafeInteger(maxIndices) || maxIndices < 1 || !Object.hasOwn(SCALE, unit)) throw Error("Limites da preparação espacial inválidos.");
  const geometries = [], meshes = [], seen = new Map(), omitted = [], transfer = [];
  let vertices = 0, indices = 0, done = 0, copiedVertices = 0;
  for (const [id, mesh] of meshMap) {
    abort(signal); const g = mesh.geometry, pos = g?.attributes.position;
    if (!pos) { omitted.push(id); continue; }
    if (!seen.has(g)) {
      if (vertices + pos.count > maxVertices || indices + (g.index?.count || 0) > maxIndices) { omitted.push(id); continue; }
      vertices += pos.count; indices += g.index?.count || 0;
      const positions = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        if (copiedVertices > 0 && copiedVertices % 12000 === 0) { abort(signal); await yieldFrame(); abort(signal); }
        positions.set([pos.getX(i), pos.getY(i), pos.getZ(i)], i * 3);
        copiedVertices++;
      }
      const index = g.index ? new Uint32Array(g.index.array) : null;
      seen.set(g, geometries.length); geometries.push({ positions, index }); transfer.push(positions.buffer); if (index) transfer.push(index.buffer);
    }
    mesh.updateWorldMatrix(true, false);
    meshes.push({ id, geometry: seen.get(g), matrix: mesh.matrixWorld.toArray() });
    done++; if (done % 25 === 0 || done === meshMap.size) onProgress(Math.round(done / Math.max(meshMap.size, 1) * 35));
    if (done % 50 === 0) await yieldFrame();
  }
  abort(signal);
  return { data: { parts: parts.map(p => ({ id: p.id, meshIds: p.meshIds, bounds: p.bounds })), geometries, meshes, omitted, scale: SCALE[unit] }, transfer };
}

export function relationsFromPayload(data, onProgress = () => {}) {
  const meshes = new Map(data.meshes.map(m => [m.id, m]));
  // Part memberships are assigned separately so the worker never needs review
  // decisions or commercial metadata to calculate physical contacts.
  const missing = new Set(data.omitted || []), affected = new Set();
  const parts = data.parts;
  const graph = buildRelations(parts, { onProgress, trianglesOf: part => {
    const out = [];
    for (const id of part.meshIds || []) {
      if (missing.has(id)) { affected.add(part.id); continue; }
      const mesh = meshes.get(id); if (!mesh) { affected.add(part.id); continue; }
      const { positions, index } = data.geometries[mesh.geometry], m = mesh.matrix;
      for (let i = 0; i < (index?.length || positions.length / 3); i++) {
        const k = (index ? index[i] : i) * 3, x = positions[k], y = positions[k + 1], z = positions[k + 2];
        const w = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15]);
        out.push((m[0] * x + m[4] * y + m[8] * z + m[12]) * w * data.scale,
          (m[1] * x + m[5] * y + m[9] * z + m[13]) * w * data.scale,
          (m[2] * x + m[6] * y + m[10] * z + m[14]) * w * data.scale);
      }
    }
    return out;
  } });
  const edges = graph.edges.map(e => affected.has(e.a) || affected.has(e.b) ? { ...e, geometryTruncated: true } : e);
  return { edges, testedPairs: graph.testedPairs, truncated: graph.truncated, tolerance: graph.tolerance,
    contactTolerance: graph.contactTolerance, geometryPreparationLimited: missing.size > 0 };
}
