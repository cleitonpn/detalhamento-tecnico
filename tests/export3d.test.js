import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { partsScene, safeName } from "../src/lib/export3d.js";

function fixture() {
  // Balcão de 2 × 1 × 0,5 m modelado em centímetros, longe da origem
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(200, 100, 50), new THREE.MeshStandardMaterial({ name: "MDF branco" }));
  mesh.position.set(500, 50, -300);
  mesh.name = "Corpo";
  mesh.updateMatrixWorld(true);
  const meshMap = new Map([["0/0", mesh]]);
  const part = { id: "p1", label: "Balcão", meshIds: ["0/0"], dimensions: [2, 1, 0.5], review: { kind: "furniture" } };
  return { meshMap, part };
}

test("exporta em metros, centralizado e apoiado no chão, com o nome da peça", () => {
  const { meshMap, part } = fixture();
  const scene = partsScene([part], meshMap, "cm");
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - 2) < 1e-9 && Math.abs(size.y - 1) < 1e-9 && Math.abs(size.z - 0.5) < 1e-9);
  assert.ok(Math.abs(box.min.y) < 1e-9);
  assert.ok(Math.abs((box.min.x + box.max.x) / 2) < 1e-9 && Math.abs((box.min.z + box.max.z) / 2) < 1e-9);
  assert.equal(scene.children[0].name, "Balcão");
  assert.equal(scene.children[0].userData.detalha.kind, "furniture");
  assert.equal(scene.children[0].children[0].material.name, "MDF branco");
});

test("sem centralizar mantém a posição do stand (para remontar o conjunto)", () => {
  const { meshMap, part } = fixture();
  const box = new THREE.Box3().setFromObject(partsScene([part], meshMap, "cm", { center: false }));
  assert.ok(Math.abs(box.getCenter(new THREE.Vector3()).x - 5) < 1e-9);
});

test("nome de arquivo sem caracteres proibidos no Windows", () => {
  assert.equal(safeName('Balcão: "curvo" / 2'), "Balcão_ _curvo_ _ 2");
});
