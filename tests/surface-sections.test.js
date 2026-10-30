import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { analyzeSurfaceSections } from "../src/lib/construction/sections.js";
import { summarizeConstructionGeometry } from "../src/lib/construction/geometry.js";
import { partitionScene } from "../src/lib/model.js";
import { partAnalysis } from "../src/lib/drawings.js";

const triangles = g => (g.index ? g.toNonIndexed() : g).attributes.position.array;
const cylinder = () => new THREE.CylinderGeometry(2, 2, 3, 48, 1, false, 0, Math.PI / 2).translate(0, 1.5, 0);
test("três seções recuperam cilindro sem depender das arestas externas", () => {
  const profile = analyzeSurfaceSections(triangles(cylinder()), [4, 3, 4]);
  assert.equal(profile.kind, "cylindrical-candidate");
  assert.equal(profile.sections.length, 3);
  assert.ok(Math.abs(profile.arcs[0].r - 2) < 1e-5);
  const summary = summarizeConstructionGeometry({ arcs: [], surfaceSections: profile }, { selectedArcId: "S1", selectedView: "top", referenceSurface: "internal" });
  assert.equal(summary.kind, "circular-candidate");
  assert.equal(summary.development.basis, "surface-sections");
  assert.ok(Math.abs(summary.development.lengthM - Math.PI) < 1e-5);
  assert.equal(summary.candidates[0].wholeSurfaceConfirmed, false);
  const drawingSummary = summarizeConstructionGeometry({ arcs: [], surfaceSections: profile, organic: true, simplified: true }, { selectedArcId: "S1", selectedView: "top", referenceSurface: "internal" });
  assert.equal(drawingSummary.kind, summary.kind);
  assert.deepEqual(drawingSummary.development, summary.development, "PDF e Worker usam a mesma evidência de seções, independentemente dos limites das arestas");
});
test("cone e esfera variam com altura; arco de aresta não autoriza desenvolvimento cilíndrico", () => {
  for (const g of [new THREE.CylinderGeometry(1, 2, 3, 48, 1, false).translate(0, 1.5, 0), new THREE.SphereGeometry(1.5, 48, 32).translate(0, 1.5, 0)]) {
    const profile = analyzeSurfaceSections(triangles(g), [4, 3, 4]);
    assert.equal(profile.kind, "varying-section");
    const summary = summarizeConstructionGeometry({ arcs: [], surfaceSections: profile }, { selectedArcId: "S1", referenceSurface: "internal" });
    assert.equal(summary.kind, "complex"); assert.equal(summary.development, null);
  }
});
test("superfícies com centros distintos não viram um único raio", () => {
  const a = triangles(cylinder()), b = triangles(cylinder().translate(6, 0, 0));
  const profile = analyzeSurfaceSections(new Float32Array([...a, ...b]), [10, 3, 4]);
  assert.equal(profile.kind, "multi-radius");
  assert.equal(summarizeConstructionGeometry({ surfaceSections: profile }).kind, "complex");
});
test("painel reto conserva linhas de referência e análise incompleta não fabrica superfície", () => {
  const t = triangles(new THREE.BoxGeometry(3, 3, .1).translate(1.5, 1.5, .05));
  const profile = analyzeSurfaceSections(t, [3, 3, .1]);
  assert.equal(profile.kind, "prismatic-candidate"); assert.equal(profile.lines.length, 2);
  assert.ok(Math.abs(profile.lines[0].lengthM - 3) < 1e-6);
  const limited = analyzeSurfaceSections(t, [3, 3, .1], { maxTriangles: 1 });
  assert.equal(limited.truncated, true);
  assert.equal(summarizeConstructionGeometry({ surfaceSections: limited }).kind, "unknown");
  assert.equal(analyzeSurfaceSections(new Float32Array([NaN]), [3, 3, .1]).kind, "insufficient");
  assert.throws(() => analyzeSurfaceSections(t, [3, 3, .1], { maxTriangles: Infinity }), /inválidos/);
});
test("cache de análise não compartilha geometria entre modelos com IDs e dimensões iguais", () => {
  const load = geometry => { const scene = new THREE.Scene(); scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())); return partitionScene(scene); };
  const a = load(new THREE.CylinderGeometry(1, 1, 3, 48)), b = load(new THREE.BoxGeometry(2, 3, 2));
  assert.equal(a.parts[0].id, b.parts[0].id);
  const first = partAnalysis(a.parts[0], a.meshMap, "m"), second = partAnalysis(b.parts[0], b.meshMap, "m");
  assert.notEqual(first, second);
  assert.equal(first.surfaceSections.kind, "cylindrical-candidate");
  assert.equal(second.surfaceSections.kind, "prismatic-candidate");
});
