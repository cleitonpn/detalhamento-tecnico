import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { partitionScene } from "../src/lib/model.js";
import { worldTriangles } from "../src/lib/artbook.js";
import { buildRelations } from "../src/lib/context/relations.js";
import { prepareRelationsPayload, relationsFromPayload } from "../src/lib/context/payload.js";
function fixture() {
  const scene = new THREE.Scene(); const material = new THREE.MeshStandardMaterial();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(3, .1, 3), material); floor.position.set(0, .05, 0);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 3, .1), material); wall.position.set(0, 1.6, -1.4);
  scene.add(floor, wall); return partitionScene(scene);
}
test("payload espacial reproduz contatos síncronos sem transferir buffers do modelo", async () => {
  const m = fixture(), before = [...m.meshMap.values()][0].geometry.attributes.position.array;
  const packed = await prepareRelationsPayload(m.parts, m.meshMap, "m");
  assert.ok(!packed.transfer.includes(before.buffer)); assert.ok(before.byteLength > 0);
  const result = relationsFromPayload(packed.data);
  const original = buildRelations(m.parts, { trianglesOf: p => worldTriangles(p, m.meshMap, "m") });
  assert.equal(result.testedPairs, original.testedPairs);
  assert.deepEqual(result.edges.map(e => [e.a, e.b, e.verified, e.orientation]), original.edges.map(e => [e.a, e.b, e.verified, e.orientation]));
});
test("limite de preparação não inventa contato e fica explícito no grafo", async () => {
  const m = fixture(), packed = await prepareRelationsPayload(m.parts, m.meshMap, "m", { maxVertices: 1 });
  const result = relationsFromPayload(packed.data);
  assert.equal(result.geometryPreparationLimited, true);
  assert.ok(result.edges.every(e => !e.verified && e.geometryTruncated));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareRelationsPayload(m.parts, m.meshMap, "m", { signal: controller.signal }), { name: "AbortError" });
});
