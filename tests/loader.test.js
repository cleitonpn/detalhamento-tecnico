import test from "node:test";
import assert from "node:assert/strict";
import {
  LIGHTWEIGHT_THRESHOLD_BYTES,
  loadModel,
  useLightweightMode,
} from "../src/lib/loader.js";
import { disposeModel, partitionScene } from "../src/lib/model.js";

// Imagens deliberadamente indisponíveis: o modo leve deve conseguir abrir a
// geometria sem tentar carregar ou decodificar nem a textura normal nem Basis.
function fixture() {
  const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Parede de referência", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [2, 3, 0],
      },
    ],
    materials: [
      {
        name: "Madeira original",
        pbrMetallicRoughness: {
          baseColorFactor: [0.2, 0.4, 0.6, 1],
          baseColorTexture: { index: 0 },
        },
        normalTexture: { index: 1 },
      },
    ],
    textures: [
      { source: 0 },
      { extensions: { KHR_texture_basisu: { source: 1 } } },
    ],
    images: [
      { uri: "imagem-inexistente.png" },
      { uri: "imagem-inexistente.ktx2" },
    ],
    extensionsUsed: ["KHR_texture_basisu"],
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const buffer = new ArrayBuffer(
    12 + 8 + jsonLength + 8 + positions.byteLength,
  );
  const bytes = new Uint8Array(buffer),
    header = new DataView(buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, buffer.byteLength, true);
  header.setUint32(12, jsonLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonLength);
  bytes.set(text, 20);
  header.setUint32(20 + jsonLength, positions.byteLength, true);
  header.setUint32(24 + jsonLength, 0x004e4942, true);
  bytes.set(new Uint8Array(positions.buffer), 28 + jsonLength);
  return buffer;
}

test("modo leve conserva geometria, IDs, cores e materiais sem decodificar imagens", async () => {
  const buffer = fixture();
  const file = {
    size: LIGHTWEIGHT_THRESHOLD_BYTES + 1,
    arrayBuffer: () => {
      throw Error("Buffer já disponível.");
    },
  };
  const renderer = { extensions: { has: () => false } };
  const scene = await loadModel(file, renderer, { buffer });
  try {
    assert.equal(scene.userData.dtLightweight, true);
    const analysis = partitionScene(scene);
    assert.equal(analysis.meshes, 1);
    assert.equal(analysis.triangles, 1);
    assert.deepEqual(analysis.parts[0].dimensions, [2, 3, 0]);
    const mesh = [...analysis.meshMap.values()][0];
    assert.equal(mesh.userData.originalName, "Parede de referência");
    assert.equal(mesh.material.name, "Madeira original");
    assert.equal(mesh.material.map, null);
    assert.equal(mesh.material.normalMap, null);
    assert.ok(Math.abs(mesh.material.color.r - 0.2) < 1e-6);
    assert.ok(Math.abs(mesh.material.color.g - 0.4) < 1e-6);
    assert.ok(Math.abs(mesh.material.color.b - 0.6) < 1e-6);
    assert.equal(analysis.parts[0].review.confirmed, false);
  } finally {
    disposeModel(scene);
  }
});

test("modelos até 50 MB mantêm o carregamento padrão das texturas", () => {
  assert.equal(
    useLightweightMode({ size: LIGHTWEIGHT_THRESHOLD_BYTES }),
    false,
  );
  assert.equal(
    useLightweightMode({ size: LIGHTWEIGHT_THRESHOLD_BYTES + 1 }),
    true,
  );
});
