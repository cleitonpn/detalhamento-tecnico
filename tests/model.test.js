import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { hashFile, partitionScene, validateFile } from "../src/lib/model.js";
import { MAX_FILE_BYTES } from "../src/domain/project.js";
import { buildDrawing } from "../src/lib/drawings.js";
import { mergeParts, splitPart } from "../src/domain/project.js";

function box(name, size, position = [0, 0, 0]) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial(),
  );
  mesh.name = name;
  mesh.position.set(...position);
  return mesh;
}
test("preserva instâncias coincidentes e identificadores entre carregamentos", () => {
  const scene = new THREE.Scene();
  scene.add(box("Parede", [3, 2.9, 0.1]), box("Parede", [3, 2.9, 0.1]));
  const a = partitionScene(scene),
    b = partitionScene(scene.clone(true));
  assert.equal(a.parts.length, 2);
  assert.notEqual(a.parts[0].id, a.parts[1].id);
  assert.deepEqual(
    a.parts.map((p) => p.id),
    b.parts.map((p) => p.id),
  );
  assert.ok(
    a.parts.every(
      (p) => !p.review.confirmed && p.review.kind === "unclassified",
    ),
  );
});
test("mede conjunto rotacionado em seus eixos, incluindo escala", () => {
  const scene = new THREE.Scene(),
    group = new THREE.Group();
  group.name = "Balcão";
  group.add(
    box("Corpo", [2, 1, 0.5]),
    box("Aplique", [2, 0.8, 0.02], [0, 0, 0.27]),
  );
  group.rotation.y = Math.PI / 4;
  scene.add(group, box("Piso", [10, 0.01, 4]));
  const a = partitionScene(scene),
    part = a.parts.find((p) => p.label === "Balcão");
  assert.ok(Math.abs(part.dimensions[0] - 2) < 1e-5);
  assert.ok(Math.abs(part.dimensions[2] - 0.53) < 1e-5);
  assert.equal(part.measurementBasis, "component-local");
  const scaled = partitionScene(scene, "cm").parts.find(
    (p) => p.label === "Balcão",
  );
  assert.ok(Math.abs(scaled.dimensions[0] - 0.02) < 1e-5);
  const d = buildDrawing(part, a.meshMap, "m", "front");
  assert.ok(d.lines.length > 0);
  assert.equal(d.width, part.dimensions[0]);
  assert.ok(d.lines.flat().every(Number.isFinite));
});
test("reunir e separar mantém uma única associação por malha e invalida confirmação", () => {
  const scene = new THREE.Scene();
  scene.add(box("A", [1, 1, 1]), box("B", [1, 1, 1], [2, 0, 0]));
  const a = partitionScene(scene),
    project = { parts: a.parts, status: "review" };
  const merged = mergeParts(
    project,
    a.parts.map((p) => p.id),
  );
  assert.equal(merged.project.parts.length, 1);
  assert.equal(merged.part.meshIds.length, 2);
  const split = splitPart(merged.project, merged.part.id, a.meshParts);
  assert.equal(split.parts.length, 2);
  assert.equal(new Set(split.parts.flatMap((p) => p.meshIds)).size, 2);
  assert.ok(split.parts.every((p) => !p.review.confirmed));
});
test("normaliza altura Z interna e vistas de testeiras laterais", () => {
  const scene = new THREE.Scene(),
    counter = new THREE.Group();
  counter.name = "Balcão";
  counter.rotation.x = -Math.PI / 2;
  counter.add(box("Corpo", [2, 0.5, 1]));
  const fascia = box("Testeira lateral", [0.03, 1, 3]);
  scene.add(counter, fascia);
  const analysis = partitionScene(scene);
  const part = analysis.parts.find((p) => p.label === "Balcão");
  part.dimensions.forEach((n, i) =>
    assert.ok(Math.abs(n - [2, 1, 0.5][i]) < 1e-6),
  );
  assert.ok(part.frame.axes[1][1] > 0.99);
  const front = buildDrawing(part, analysis.meshMap, "m", "front");
  assert.ok(Math.abs(front.height - 1) < 1e-6);
  const side = analysis.parts.find((p) => p.label === "Testeira lateral");
  side.dimensions.forEach((n, i) =>
    assert.ok(Math.abs(n - [3, 1, 0.03][i]) < 1e-6),
  );
});
test("recusa extensão ou cabeçalho GLB inválido antes do loader", async () => {
  await assert.rejects(
    validateFile(new File(["fake"], "arquivo.glb")),
    /válido/,
  );
  await assert.rejects(
    validateFile(new File(["fake"], "arquivo.gltf")),
    /\.glb/,
  );
  const header = new Uint32Array([0x46546c67, 2, 12]);
  await validateFile(new File([header], "arquivo.glb"));
});

test("aceita GLB maior que 50 MB até o limite e recusa excedentes antes de ler", async () => {
  for (const size of [84_181_968, MAX_FILE_BYTES]) {
    const file = {
      name: "grande.glb",
      size,
      slice: () => new Blob([new Uint32Array([0x46546c67, 2, size])]),
    };
    assert.equal(await validateFile(file), file);
  }
  await assert.rejects(
    validateFile({
      name: "excedente.glb",
      size: MAX_FILE_BYTES + 1,
      slice: () => {
        throw Error("Não deveria ler um arquivo acima do limite.");
      },
    }),
    /200 MB/,
  );
});

test("hash reutiliza o buffer lido sem alterar a identidade do GLB", async () => {
  const file = new File([new Uint32Array([0x46546c67, 2, 12])], "stand.glb");
  const buffer = await file.arrayBuffer();
  const expected = await hashFile(file);
  assert.equal(
    await hashFile(
      {
        arrayBuffer: () => {
          throw Error("Leitura duplicada.");
        },
      },
      buffer,
    ),
    expected,
  );
});
