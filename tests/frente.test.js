import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { partitionScene } from "../src/lib/model.js";

// Caixa [w, h, d, x, y, z] em metros dentro de um grupo (a peça)
function scene(groups) {
  const root = new THREE.Group();
  for (const [name, [w, h, d, x, y, z], rotate] of groups) {
    const g = new THREE.Group();
    g.name = name;
    g.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d).translate(w / 2, h / 2, d / 2),
        new THREE.MeshStandardMaterial(),
      ),
    );
    if (rotate) rotate(g);
    g.position.set(x, y, z);
    root.add(g);
  }
  return partitionScene(root, "m").parts;
}
const det = ([a, b, c]) =>
  new THREE.Vector3(...a)
    .cross(new THREE.Vector3(...b))
    .dot(new THREE.Vector3(...c));
const STAND = [
  ["Piso", [6, 0.1, 6, 0, -0.1, 0]],
  ["Parede fundo", [6, 3, 0.1, 0, 0, 0]],
  ["Parede esquerda", [0.1, 3, 6, 0, 0, 0]],
  ["Parede direita", [0.1, 3, 6, 5.9, 0, 0]],
  ["Testeira", [6, 0.5, 0.1, 0, 2.6, 5.9]],
];

test("referencial da peça nunca fica espelhado", () => {
  // Componente "deitado" como no SketchUp (Z para cima) e outro espelhado
  const parts = scene([
    ...STAND,
    ["Painel Z", [1.2, 0.05, 2.4, 2, 0, 3], (g) => g.rotateX(-Math.PI / 2)],
    ["Espelhado", [1.2, 2.4, 0.05, 3, 0, 3], (g) => g.scale.set(-1, 1, 1)],
  ]);
  for (const p of parts) assert.ok(det(p.frame.axes) > 0.99, p.label);
});

test("paredes olham para dentro do stand e a testeira para o corredor", () => {
  const parts = scene(STAND);
  const depth = (label) => parts.find((p) => p.label === label).frame.axes[2];
  assert.ok(depth("Parede fundo")[2] > 0.9); // fundo em z = 0, centro em +z
  assert.ok(depth("Parede esquerda")[0] > 0.9);
  assert.ok(depth("Parede direita")[0] < -0.9);
  assert.ok(depth("Testeira")[2] > 0.9); // na frente do stand, olha para fora
  // A peça continua no mesmo lugar: a origem acompanha o giro
  const right = parts.find((p) => p.label === "Parede direita");
  const [ax, , az] = right.frame.axes;
  const far = right.frame.origin.map(
    (n, i) => n + ax[i] * right.dimensions[0] + az[i] * right.dimensions[2],
  );
  for (const corner of [right.frame.origin, far])
    corner.forEach((n, i) => {
      assert.ok(n >= right.bounds.min[i] - 1e-4 && n <= right.bounds.max[i] + 1e-4);
    });
});
