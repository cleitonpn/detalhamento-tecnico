import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { partitionScene } from "../src/lib/model.js";
import { constructionAnalysisAsync, collectConstructionTriangles } from "../src/lib/construction/asyncAnalysis.js";
function fixture() { const scene = new THREE.Scene(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(3, 3, .1), new THREE.MeshStandardMaterial())); const m = partitionScene(scene); return { part: m.parts[0], map: m.meshMap }; }
test("coleta em lotes conserva os buffers de renderização e cache fica por geometria", async () => {
  const f = fixture(), mesh = [...f.map.values()][0], original = mesh.geometry.attributes.position.array;
  const copied = await collectConstructionTriangles(f.part, f.map, "m");
  assert.notEqual(copied.buffer, original.buffer); assert.ok(original.byteLength > 0);
  const a = await constructionAnalysisAsync(f.part, f.map, "m"), b = await constructionAnalysisAsync(f.part, f.map, "m");
  assert.equal(a, b); assert.equal(a.surfaceSections.kind, "prismatic-candidate");
  const other = fixture(); assert.notEqual(await constructionAnalysisAsync(other.part, other.map, "m"), a);
});
test("cancelar coleta ou Worker termina o trabalho sem resultado parcial", async () => {
  const f = fixture(), before = new AbortController(); before.abort();
  await assert.rejects(constructionAnalysisAsync(f.part, f.map, "m", { signal: before.signal }), { name: "AbortError" });
  const during = new AbortController();
  await assert.rejects(collectConstructionTriangles(f.part, f.map, "m", { signal: during.signal, onProgress: () => during.abort() }), { name: "AbortError" });
  const abort = new AbortController(); let terminated = 0;
  await assert.rejects(constructionAnalysisAsync(f.part, f.map, "m", { signal: abort.signal, workerFactory: () => ({ terminate() { terminated++; }, postMessage() { abort.abort(); } }) }), { name: "AbortError" });
  assert.equal(terminated, 1);
});
test("erro do Worker não vira análise bem-sucedida ou fallback bloqueante", async () => {
  const f = fixture(); let terminated = 0;
  await assert.rejects(constructionAnalysisAsync(f.part, f.map, "m", { workerFactory: () => {
    const w = { terminate() { terminated++; }, postMessage() { queueMicrotask(() => w.onmessage({ data: { error: "falha sintética" } })); } }; return w;
  } }), /falha sintética/);
  assert.equal(terminated, 1);
});
