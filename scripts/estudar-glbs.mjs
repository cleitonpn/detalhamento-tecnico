import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { partitionScene } from "../src/lib/model.js";
import { buildDrawing } from "../src/lib/drawings.js";
import {
  newProject,
  checkProject,
  MAX_FILE_BYTES,
} from "../src/domain/project.js";

// Estudo de geometria: ignora texturas, sem modificar GLBs ou regras da aplicação.
// Não substitui a verificação visual do carregamento completo no navegador.
// node scripts/estudar-glbs.mjs --out-dir /caminho/relatorios arquivo1.glb arquivo2.glb
globalThis.self = globalThis;
const args = process.argv.slice(2);
let outDir = "/tmp/estudo-glbs";
const option = args.indexOf("--out-dir");
if (option !== -1) {
  if (!args[option + 1]) throw Error("Informe a pasta de relatórios.");
  outDir = args.splice(option, 2)[1];
}
if (!args.length) throw Error("Informe os arquivos GLB locais para estudar.");
await fs.mkdir(outDir, { recursive: true });
const catalogue = JSON.parse(
  await fs.readFile(
    new URL("../src/data/materials.json", import.meta.url),
    "utf8",
  ),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const round = (n) => Math.round(n * 1e6) / 1e6;
const histogram = (values) =>
  Object.fromEntries(
    [
      ...values.reduce(
        (m, value) => m.set(value, (m.get(value) || 0) + 1),
        new Map(),
      ),
    ].sort((a, b) => b[1] - a[1]),
  );
const triangles = (mesh) =>
  ((mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) /
    3) *
  (mesh.isInstancedMesh ? mesh.count : 1);

for (const filename of args) {
  const bytes = await fs.readFile(filename),
    started = performance.now();
  if (
    bytes.length < 20 ||
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    throw Error(`GLB 2.0 inválido: ${filename}`);
  let json, binary;
  for (let offset = 12; offset < bytes.length;) {
    const size = bytes.readUInt32LE(offset),
      type = bytes.readUInt32LE(offset + 4),
      chunk = bytes.subarray(offset + 8, offset + 8 + size);
    if (chunk.length !== size) throw Error("Chunk GLB incompleto.");
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + size;
  }
  const loader = new GLTFLoader();
  loader.register((parser) => {
    parser.loadTexture = async () => null;
    return { name: "geometry-only-study" };
  });
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  gltf.scene.traverse((node) => {
    const index = gltf.parser.associations.get(node)?.nodes;
    if (index !== undefined)
      node.userData.originalName = json.nodes[index]?.name || node.name;
  });
  const loadMs = performance.now() - started,
    partitionStarted = performance.now();
  const analysis = partitionScene(gltf.scene),
    partitionMs = performance.now() - partitionStarted;
  const geometries = new Set(),
    attributes = new Set(),
    box = new THREE.Box3();
  let reflected = 0,
    instanced = 0,
    skinned = 0,
    vertices = 0,
    triangleCount = 0;
  for (const mesh of analysis.meshMap.values()) {
    geometries.add(mesh.geometry);
    if (mesh.matrixWorld.determinant() < 0) reflected++;
    if (mesh.isInstancedMesh) instanced++;
    if (mesh.isSkinnedMesh) skinned++;
    vertices += mesh.geometry.attributes.position.count;
    triangleCount += triangles(mesh);
    box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  }
  for (const geometry of geometries) {
    Object.values(geometry.attributes).forEach((a) =>
      attributes.add(a.isInterleavedBufferAttribute ? a.data : a),
    );
    if (geometry.index) attributes.add(geometry.index);
  }
  const drawingStarted = performance.now();
  const parts = analysis.parts.map((part) => ({
    id: part.id,
    label: part.label,
    meshCount: part.meshIds.length,
    meshIds: part.meshIds,
    bounds: part.bounds,
    dimensionsM: part.dimensions.map(round),
    frame: part.frame,
    basis: part.measurementBasis,
    materials: part.materialsOriginal,
    suggestion: part.suggestion,
    triangles: Math.round(
      part.meshIds.reduce(
        (n, id) => n + triangles(analysis.meshMap.get(id)),
        0,
      ),
    ),
    views: ["front", "top", "side"].map((view) => {
      const d = buildDrawing(part, analysis.meshMap, "m", view);
      return {
        view,
        lines: d.lines.length,
        simplified: d.simplified,
        empty: !d.lines.length,
      };
    }),
  }));
  const drawingMs = performance.now() - drawingStarted;
  const hash = sha(bytes);
  const project = {
    ...newProject(
      { name: path.basename(filename), size: bytes.length },
      { ...analysis, hash },
    ),
    materials: catalogue,
  };
  let projectValidation = "accepted";
  try {
    checkProject(project);
  } catch (e) {
    projectValidation = e.message;
  }
  const imageViews = new Set(
    json.images?.map((i) => i.bufferView).filter((i) => i !== undefined),
  );
  const imagesBytes = [...imageViews].reduce(
    (n, i) => n + json.bufferViews[i].byteLength,
    0,
  );
  const geometryViews = new Set(
    json.accessors?.map((a) => a.bufferView).filter((i) => i !== undefined),
  );
  const geometryBytes = [...geometryViews].reduce(
    (n, i) => n + json.bufferViews[i].byteLength,
    0,
  );
  const studioKeys = [...analysis.meshMap.values()]
      .map((m) => m.userData.studioKey)
      .filter(Boolean),
    keyCounts = histogram(studioKeys);
  const summary = {
    file: path.basename(filename),
    bytes: bytes.length,
    sha256: hash,
    binarySha256: binary ? sha(binary) : null,
    generator: json.asset.generator,
    rawCounts: Object.fromEntries(
      [
        "nodes",
        "meshes",
        "materials",
        "textures",
        "images",
        "animations",
        "skins",
      ].map((k) => [k, (json[k] || []).length]),
    ),
    extensions: json.extensionsUsed || [],
    requiredExtensions: json.extensionsRequired || [],
    uploadWithinLimit: bytes.length <= MAX_FILE_BYTES,
    uploadLimitBytes: MAX_FILE_BYTES,
    projectValidation,
    metadataBytes: Buffer.byteLength(JSON.stringify(project)),
    meshInstances: analysis.meshes,
    triangles: Math.round(triangleCount),
    vertices,
    distinctGeometries: geometries.size,
    geometryAttributeBytes: [...attributes].reduce(
      (n, a) => n + a.array.byteLength,
      0,
    ),
    embeddedImageBytes: imagesBytes,
    binaryGeometryBytes: geometryBytes,
    dimensionsWorldM: box.getSize(new THREE.Vector3()).toArray().map(round),
    groups: parts.length,
    genericLabels: parts.filter((p) => /^Peça \d+$/.test(p.label)).length,
    suggestions: histogram(parts.map((p) => p.suggestion.kind)),
    simplifiedParts: parts
      .filter((p) => p.views.some((v) => v.simplified))
      .map((p) => ({
        label: p.label,
        meshes: p.meshCount,
        triangles: p.triangles,
      })),
    simplifiedViews: parts.flatMap((p) => p.views).filter((v) => v.simplified)
      .length,
    emptyViews: parts.flatMap((p) => p.views).filter((v) => v.empty).length,
    reflectedMeshes: reflected,
    instancedMeshes: instanced,
    skinnedMeshes: skinned,
    duplicateStudioKeys: Object.values(keyCounts).filter((n) => n > 1).length,
    maxMeshesPerGroup: Math.max(...parts.map((p) => p.meshCount)),
    maxPathDepth: Math.max(
      ...[...analysis.meshMap.keys()].map((id) => id.split("/").length),
    ),
    timingsGeometryOnlyMs: {
      load: Math.round(loadMs),
      partition: Math.round(partitionMs),
      drawings: Math.round(drawingMs),
    },
  };
  const report = { summary, parts };
  const destination = path.join(
    outDir,
    `${path.basename(filename, ".glb")}.json`,
  );
  await fs.writeFile(destination, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...summary, report: destination }, null, 2));
}
