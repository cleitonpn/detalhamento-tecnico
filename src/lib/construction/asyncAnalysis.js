import { localTransform } from "../techdraw.js";
import { analyzeSurfaceSections, SURFACE_SECTIONS_VERSION } from "./sections.js";

const caches = new WeakMap();
const abortError = () => new DOMException("Análise cancelada", "AbortError");
const check = signal => { if (signal?.aborted) throw abortError(); };
const nextFrame = () => new Promise(resolve => setTimeout(resolve, 0));
// Copia, nunca transfere os buffers usados pelo renderizador. A coleta também
// cede a execução ao navegador, permitindo cancelar antes de iniciar o Worker.
export async function collectConstructionTriangles(part, meshMap, unit, { signal, onProgress = () => {} } = {}) {
  check(signal);
  let count = 0;
  for (const id of part.meshIds) { const g = meshMap.get(id)?.geometry; count += g?.index ? g.index.count : g?.attributes.position?.count || 0; }
  if (count > 50000 * 3) return null;
  const result = new Float32Array(count * 3), transform = localTransform(part, unit);
  let out = 0;
  for (const id of part.meshIds) {
    const mesh = meshMap.get(id), g = mesh?.geometry, pos = g?.attributes.position;
    if (!pos) continue;
    mesh.updateWorldMatrix(true, false);
    const size = g.index ? g.index.count : pos.count;
    for (let i = 0; i < size; i++) {
      if (out % 18000 === 0) { check(signal); onProgress(Math.round(out / Math.max(result.length, 1) * 40)); await nextFrame(); check(signal); }
      const k = g.index ? g.index.getX(i) : i;
      result.set(transform(pos.getX(k), pos.getY(k), pos.getZ(k), mesh.matrixWorld), out); out += 3;
    }
  }
  check(signal); return result;
}

export async function constructionAnalysisAsync(part, meshMap, unit, { signal, onProgress = () => {}, workerFactory } = {}) {
  check(signal);
  if (!caches.has(meshMap)) caches.set(meshMap, new Map());
  const cache = caches.get(meshMap), key = JSON.stringify([part.id, part.meshIds, part.dimensions, part.frame, unit, SURFACE_SECTIONS_VERSION]);
  if (cache.has(key)) { onProgress(100); return cache.get(key); }
  const triangles = await collectConstructionTriangles(part, meshMap, unit, { signal, onProgress });
  check(signal);
  if (!triangles) return { arcs: [], surfaceSections: { kind: "insufficient", arcs: [], lines: [], sections: [], toleranceM: .002,
    truncated: true, methodVersion: SURFACE_SECTIONS_VERSION, reason: "Limite de 50 mil triângulos: escolha um subcomponente; não foi inferida superfície completa." } };
  onProgress(45);
  let result;
  if (workerFactory || typeof Worker !== "undefined") {
    result = await new Promise((resolve, reject) => {
      const worker = workerFactory ? workerFactory() : new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      let settled = false;
      const finish = (error, value) => { if (settled) return; settled = true; worker.terminate(); signal?.removeEventListener("abort", abort); error ? reject(error) : resolve(value); };
      const abort = () => finish(abortError());
      signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = ({ data }) => finish(data.error ? Error(data.error) : null, data.result);
      worker.onerror = e => finish(Error(e.message || "Falha no Worker de análise."));
      if (signal?.aborted) { abort(); return; }
      try { worker.postMessage({ triangles, dimensions: part.dimensions }, [triangles.buffer]); } catch (e) { finish(e); }
    });
  } else {
    if (typeof window !== "undefined") throw Error("Este navegador não oferece Web Workers; análise não executada para evitar bloquear a interface.");
    result = { surfaceSections: analyzeSurfaceSections(triangles, part.dimensions), arcs: [], views: { top: {} }, curves: [], freeCurves: 0 };
  }
  check(signal);
  if (cache.size >= 60) cache.delete(cache.keys().next().value);
  cache.set(key, result); onProgress(100); return result;
}
