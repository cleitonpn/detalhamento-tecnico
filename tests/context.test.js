import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createSpatialIndex } from "../src/lib/context/spatial.js";
import { buildRelations, inferSurfaceRole, inferContextRole, contextFacts } from "../src/lib/context/relations.js";
import { buildHierarchy, hierarchySummary } from "../src/lib/context/hierarchy.js";

function box(id, min, max, kind = "other") {
  const dimensions = max.map((v, k) => v - min[k]);
  const g = new THREE.BoxGeometry(...dimensions).toNonIndexed();
  g.translate(...min.map((v, k) => (v + max[k]) / 2));
  return { id, label: id, bounds: { min, max }, dimensions, review: { kind }, tris: g.attributes.position.array };
}
const geometry = { trianglesOf: p => p.tris };

test("hierarquia conserva vínculos reais, repetição geométrica e limites explícitos", () => {
  const parts = [{ id: "a", meshIds: ["0/1/2", "0/1/3"], fingerprint: { exact: "same" } },
    { id: "b", meshIds: ["0/2/1"], fingerprint: { exact: "same" } }];
  const hierarchy = buildHierarchy(parts);
  assert.deepEqual(hierarchySummary(parts[0], hierarchy), { meshes: 2, repeated: 2, partial: false });
  assert.ok(hierarchy.edges.some(e => e.a === "mesh:0/1/2" && e.b === "part:a"));
  assert.ok(hierarchy.edges.some(e => e.a === "mesh:0/1/2" && e.b === "group:0/1"));
  assert.equal(hierarchy.nodes.get("group:0/1").type, "scene-group");
  assert.equal(buildHierarchy(parts, { maxNodes: 2 }).truncated, true);
  assert.throws(() => buildHierarchy(parts, { maxNodes: Infinity }), /inválido/);
});

test("painel em contato com piso ganha hipótese de parede, mas proximidade e vegetação não", () => {
  const floor = box("floor", [0, 0, 0], [4, .1, 4], "floor");
  const wall = box("wall", [.5, .1, .5], [3.5, 3, .6]);
  const parts = [floor, wall];
  assert.equal(inferContextRole(wall, buildRelations(parts, geometry), parts).role, "wall");
  wall.review.semanticRole = "vegetation";
  assert.equal(inferContextRole(wall, buildRelations(parts, geometry), parts), null);
  delete wall.review.semanticRole;
  wall.bounds.min[1] += .005; wall.bounds.max[1] += .005;
  assert.equal(inferContextRole(wall, buildRelations(parts, geometry), parts), null);
});

test("testeira contextual precisa de parede alinhada e contato; jardim conserva identidade", () => {
  const floor = box("floor", [0, 0, 0], [4, .1, 4], "floor");
  const wall = box("wall", [.5, .1, .5], [3.5, 2.8, .6], "wall");
  const fascia = box("fascia", [.5, 2.8, .5], [3.5, 3.5, .6]);
  for (const p of [wall, fascia]) p.frame = { axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
  const parts = [floor, wall, fascia], graph = buildRelations(parts, geometry);
  assert.equal(inferContextRole(fascia, graph, parts).role, "fascia");
  fascia.review.semanticRole = "vegetation";
  assert.equal(inferContextRole(fascia, graph, parts), null);
  assert.equal(contextFacts(fascia, graph, parts)[0].relation, "vegetation-at-wall");
});

test("índice espacial inclui células negativas e envelopes grandes, sem varrer todas as peças distantes", () => {
  const parts = Array.from({ length: 500 }, (_, i) => box(`p${i}`, [i * 10, 0, 0], [i * 10 + 1, 1, 1]));
  assert.equal(buildRelations(parts).testedPairs, 0);
  const p = box("negative", [-3, -2, -1], [-2, -1, 0]);
  const large = box("large", [-100, -100, -100], [100, 100, 100]);
  assert.deepEqual(new Set(createSpatialIndex([p, large]).query(p.bounds).map(x => x.id)), new Set(["negative", "large"]));
  assert.doesNotThrow(() => createSpatialIndex([box("huge", [1e20, 0, 0], [1e20, 1, 1])]).query(p.bounds));
});

test("caixas próximas não bastam para afirmar contato; superfícies coincidentes confirmam a evidência", () => {
  const base = box("base", [0, 0, 0], [2, 1, 1], "furniture");
  const top = box("top", [0, 1, 0], [2, 1.02, 1]);
  const broad = buildRelations([base, top]);
  assert.equal(broad.edges[0].relation, "possible-support");
  assert.equal(broad.edges[0].verified, false);
  const exact = buildRelations([base, top], geometry);
  assert.equal(exact.edges[0].relation, "surface-contact");
  assert.equal(exact.edges[0].evidence, "horizontal-triangles");
  assert.equal(inferSurfaceRole(top, exact, [base, top]).role, "countertop");
  const floating = box("floating", [0, 1.005, 0], [2, 1.025, 1]);
  assert.equal(buildRelations([base, floating], geometry).edges[0].verified, false, "folga de 5 mm não é contato");
});

test("envelope vazio não inventa contato dentro de um vão", () => {
  const base = box("base", [0, 0, 0], [2, 1, 1]);
  base.tris = box("real", [0, 0, 0], [0.1, 1, 0.1]).tris;
  const top = box("top", [0.5, 1, 0.3], [1.5, 1.02, 0.7]);
  const graph = buildRelations([base, top], geometry);
  assert.equal(graph.edges[0].verified, false);
  assert.equal(inferSurfaceRole(top, graph, [base, top]), null);
});

test("tampo sobre perfis vira hipótese de mesa, sem decidir locação ou construção", () => {
  const top = box("top", [0, 1, 0], [1, 1.03, 1]);
  const legs = [box("a", [0, 0, 0], [0.05, 1, 0.05]), box("b", [0.95, 0, 0.95], [1, 1, 1])];
  const graph = buildRelations([top, ...legs], geometry);
  assert.equal(inferSurfaceRole(top, graph, [top, ...legs]).role, "tabletop");
  assert.match(inferSurfaceRole(top, graph, [top, ...legs]).reason, /Não determina/);
});

test("limites de análise ficam explícitos em vez de anunciar grafo completo", () => {
  const parts = [box("a", [0, 0, 0], [1, 1, 1]), box("b", [0, 0, 0], [1, 1, 1]), box("c", [0, 0, 0], [1, 1, 1])];
  const graph = buildRelations(parts, { maxPairs: 1 });
  assert.equal(graph.truncated, true);
  assert.equal(graph.testedPairs, 1);
  assert.throws(() => createSpatialIndex(parts, { cellSize: 0 }), /inválida/);
  assert.throws(() => createSpatialIndex(parts, { maxCells: Infinity }), /inválida/);
  assert.throws(() => buildRelations(parts, { maxPatches: Infinity }), /inválidos/);
});

test("prateleira exige contato lateral de triângulos com a parede, não proximidade de caixas", () => {
  const wall = box("wall", [0, 0, 0], [3, 3, 0.1], "wall");
  const shelf = box("shelf", [0.5, 1, 0.1], [1.5, 1.03, 0.5]);
  const graph = buildRelations([wall, shelf], geometry);
  assert.equal(graph.edges[0].verified, true);
  assert.equal(graph.edges[0].orientation, "lateral");
  assert.equal(graph.edges[0].evidence, "planar-triangles");
  assert.ok(graph.edges[0].patchAreaM2 > 0);
  const suggestion = inferSurfaceRole(shelf, graph, [wall, shelf]);
  assert.equal(suggestion.role, "shelf");
  assert.match(suggestion.reason, /Fixações e capacidade de carga não foram verificadas/);
  const floating = box("floating", [0.5, 1, 0.105], [1.5, 1.03, 0.505]);
  const near = buildRelations([wall, floating], geometry);
  assert.equal(near.edges[0].verified, false);
  assert.equal(inferSurfaceRole(floating, near, [wall, floating]), null);
});

test("contato lateral não é inventado em um vão do envelope", () => {
  const wall = box("wall", [0, 0, 0], [3, 3, 0.1], "wall");
  // Dois pilares deixam a região central vazia, mas o envelope cobre o vão.
  wall.tris = new Float32Array([
    ...box("left", [0, 0, 0], [0.2, 3, 0.1]).tris,
    ...box("right", [2.8, 0, 0], [3, 3, 0.1]).tris,
  ]);
  const shelf = box("shelf", [0.5, 1, 0.1], [1.5, 1.03, 0.5]);
  const graph = buildRelations([wall, shelf], geometry);
  assert.equal(graph.edges[0].verified, false);
  assert.equal(inferSurfaceRole(shelf, graph, [wall, shelf]), null);
});

function transformed(p, matrix) {
  const pos = new THREE.BufferAttribute(p.tris.slice(), 3);
  pos.applyMatrix4(matrix);
  const geometry = new THREE.BufferGeometry().setAttribute("position", pos);
  geometry.computeBoundingBox();
  return { ...p, tris: pos.array, bounds: { min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() } };
}

test("contato lateral conserva a evidência com peças giradas em 37 graus", () => {
  const rot = new THREE.Matrix4().makeRotationY(37 * Math.PI / 180);
  const wall = transformed(box("wall", [0, 0, 0], [3, 3, 0.1], "wall"), rot);
  const shelf = transformed(box("shelf", [0.5, 1, 0.1], [1.5, 1.03, 0.5]), rot);
  const graph = buildRelations([wall, shelf], geometry);
  assert.equal(graph.edges[0].verified, true);
  assert.equal(graph.edges[0].orientation, "lateral");
  assert.equal(inferSurfaceRole(shelf, graph, [wall, shelf]).role, "shelf");
});

test("contato inclinado é verificado sem virar apoio horizontal ou tampo automaticamente", () => {
  const rot = new THREE.Matrix4().makeRotationZ(Math.PI / 4);
  const base = transformed(box("base", [0, 0, 0], [2, 1, 1], "furniture"), rot);
  const top = transformed(box("top", [0, 1, 0], [2, 1.03, 1]), rot);
  const graph = buildRelations([base, top], geometry);
  assert.equal(graph.edges[0].verified, true);
  assert.equal(graph.edges[0].orientation, "inclined");
  assert.equal(inferSurfaceRole(top, graph, [base, top]), null);
});

test("superfícies truncadas são sinalizadas sem fabricar contato ausente", () => {
  const wall = box("wall", [0, 0, 0], [3, 3, 0.1], "wall");
  const shelf = box("shelf", [0.5, 1, 0.1], [1.5, 1.03, 0.5]);
  const graph = buildRelations([wall, shelf], { ...geometry, maxPatches: 1 });
  assert.equal(graph.edges[0].geometryTruncated, true);
  if (!graph.edges[0].verified) assert.equal(inferSurfaceRole(shelf, graph, [wall, shelf]), null);
});
