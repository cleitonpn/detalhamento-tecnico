import * as THREE from "three";
import { coletarPecas } from "./vendor/studio/analyze.js";
import { MAX_FILE_BYTES, MAX_FILE_MB, SCALE } from "../domain/project.js";
import { fingerprint, surfaceStats, shapeStats } from "./auto/fingerprint.js";

const plainReview = () => ({
  kind: "unclassified",
  materialId: "",
  finishId: "",
  notes: "",
  dimensionsConfirmed: false,
  confirmed: false,
});
const usefulName = (name) =>
  name &&
  !/^(?:geom3d.*|componente.*|component.*|group.*|agrupar.*|grupo#.*|scene.*|node.*|mesh.*)$/i.test(
    name,
  );

function suggestion(name, dimensions, min) {
  const [x, y, z] = dimensions,
    sorted = [...dimensions].sort((a, b) => a - b);
  if (/televis|samsung|\btv\b|monitor/i.test(name))
    return {
      kind: "equipment",
      reason: "Nome do componente indica equipamento.",
    };
  if (/balc[ãa]o|mesa|cadeira|banqueta|tiffany|eames|table/i.test(name))
    return {
      kind: "furniture",
      reason: "Nome do componente indica mobiliário.",
    };
  if (
    /testeira|fascia/i.test(name) ||
    (min[1] > 2.5 && y > 0.4 && sorted[0] < 0.15)
  )
    return {
      kind: "fascia",
      reason: "Painel alto e fino; confirmar se é testeira.",
    };
  if (
    /metalon|steel|inox|metal/i.test(name) ||
    (sorted[1] < 0.12 && sorted[2] > 0.5)
  )
    return {
      kind: "metalon",
      reason: "Nome ou forma de perfil; material interno a confirmar.",
    };
  if (y < 0.15 && x > 1.5 && z > 1.5 && min[1] < 0.3)
    return { kind: "floor", reason: "Plano horizontal próximo do piso." };
  if (/\bspot\b|\blight\b|lumin[áa]ria/i.test(name))
    return { kind: "light", reason: "Nome indica iluminação." };
  if (y > 1.2 && Math.min(x, z) < 0.4)
    return {
      kind: "wall",
      reason: "Painel vertical; confirmar construção e revestimento.",
    };
  return {
    kind: "unclassified",
    reason: "Confirme o tipo e a construção da peça.",
  };
}

// `light`: malhas avulsas (só usadas ao separar uma peça) não precisam da leitura de forma
function describe(
  meshes,
  ids,
  label,
  scale,
  frameNode = meshes[0],
  light = false,
) {
  const box = new THREE.Box3();
  meshes.forEach((o) => {
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  let dimensions = box
    .getSize(new THREE.Vector3())
    .multiplyScalar(scale)
    .toArray();
  let measurementBasis = "world-assembly";
  let frame = {
    origin: box.min.clone().multiplyScalar(scale).toArray(),
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
  };
  const axes = [0, 1, 2].map((i) =>
    new THREE.Vector3().setFromMatrixColumn(frameNode.matrixWorld, i),
  );
  const normalized = axes.map((v) => v.clone().normalize());
  const orthogonal =
    axes.every((a) => a.length() > 1e-10) &&
    Math.abs(normalized[0].dot(normalized[1])) < 1e-6 &&
    Math.abs(normalized[0].dot(normalized[2])) < 1e-6 &&
    Math.abs(normalized[1].dot(normalized[2])) < 1e-6;
  if (orthogonal) {
    const inverse = frameNode.matrixWorld.clone().invert(),
      localBox = new THREE.Box3();
    meshes.forEach((o) =>
      localBox.union(
        o.geometry.boundingBox
          .clone()
          .applyMatrix4(
            new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld),
          ),
      ),
    );
    dimensions = localBox
      .getSize(new THREE.Vector3())
      .toArray()
      .map((n, i) => n * axes[i].length() * scale);
    measurementBasis = meshes.length === 1 ? "mesh-local" : "component-local";
    frame = {
      origin: localBox.min
        .clone()
        .applyMatrix4(frameNode.matrixWorld)
        .multiplyScalar(scale)
        .toArray(),
      axes: normalized.map((a) => a.toArray()),
    };
  }
  // Exportadores (como SketchUp) podem manter Z como altura no componente.
  // A vista da peça usa largura, altura e profundidade, sem perder sua rotação.
  const vertical = frame.axes.reduce(
    (best, axis, i) =>
      Math.abs(axis[1]) > Math.abs(frame.axes[best][1]) ? i : best,
    0,
  );
  const horizontal = [0, 1, 2].filter((i) => i !== vertical);
  const width =
    dimensions[horizontal[0]] >= dimensions[horizontal[1]]
      ? horizontal[0]
      : horizontal[1];
  const depth = horizontal.find((i) => i !== width);
  if (frame.axes[vertical][1] < 0) {
    frame.origin = frame.origin.map(
      (n, i) => n + frame.axes[vertical][i] * dimensions[vertical],
    );
    frame.axes[vertical] = frame.axes[vertical].map((n) => -n);
  }
  const order = [width, vertical, depth];
  dimensions = order.map((i) => dimensions[i]);
  frame.axes = order.map((i) => frame.axes[i]);
  const min = box.min.clone().multiplyScalar(scale).toArray(),
    max = box.max.clone().multiplyScalar(scale).toArray();
  // Precisão gravada: 0,01 mm basta para medir e evita números como 0,19999998807907104
  // (o levantamento inteiro precisa caber num documento da nuvem)
  const mm = (v) => Math.round(v * 1e5) / 1e5,
    unit = (v) => Math.round(v * 1e7) / 1e7;
  // Pistas do arquivo de origem (SketchUp: tag e nome do componente) e impressão digital
  const skp = frameNode?.userData?.skp;
  // Conjunto só de itens pequenos (produtos expostos), marcado pelo leitor do SketchUp
  const cluster = frameNode?.userData?.skpCluster || 0;
  const hints =
    skp || cluster
      ? {
          tag: skp?.tag || "",
          definition: skp?.definition || "",
          ...(cluster ? { smallItems: cluster } : {}),
        }
      : null;
  const surface = surfaceStats(meshes, scale);
  return {
    id: `part-${ids[0].replaceAll("/", "-")}`,
    label,
    meshIds: ids,
    bounds: { min: min.map(mm), max: max.map(mm) },
    dimensions: dimensions.map(mm),
    measurementBasis,
    frame: {
      origin: frame.origin.map(mm),
      axes: frame.axes.map((a) => a.map(unit)),
    },
    ...(hints ? { hints } : {}),
    surface: {
      tris: surface.tris,
      area: Math.round(surface.area * 1e4) / 1e4,
    },
    // Leitura da forma: partes soltas, preenchimento das faces (logo, arte, mesa…)
    ...(light ? {} : { shape: shapeStats(meshes, scale, frame, dimensions) }),
    fingerprint: fingerprint({
      dimensions,
      tris: surface.tris,
      area: surface.area,
      name: hints?.definition || label,
    }),
    materialsOriginal: [
      ...new Set(
        meshes.flatMap((o) =>
          (Array.isArray(o.material) ? o.material : [o.material]).map(
            (m) => m?.name || "Sem nome",
          ),
        ),
      ),
    ],
    suggestion: suggestion(
      `${label} ${meshes.flatMap((o) => (Array.isArray(o.material) ? o.material : [o.material]).map((m) => m?.name)).join(" ")}`,
      dimensions,
      min,
    ),
    review: plainReview(),
  };
}

/** Agrupa pela hierarquia original. A classificação do Studio nunca é uma confirmação de construção. */
export function partitionScene(scene, sourceUnit = "m") {
  const scale = SCALE[sourceUnit];
  if (!scale) throw Error("Unidade inválida.");
  scene.updateWorldMatrix(true, true);
  const studioParts = coletarPecas(scene);
  const studioByUuid = new Map(studioParts.map((p) => [p.uuid, p]));
  const meshMap = new Map(),
    meshParts = new Map(),
    groups = [];
  function collect(node, path = "0") {
    node.userData.dtPath = path;
    if (node.isMesh && node.geometry?.attributes.position) {
      // Um caminho é único mesmo para peças coincidentes ou materiais iguais.
      meshMap.set(path, node);
      node.userData.studioKey = studioByUuid.get(node.uuid)?.chave || null;
    }
    node.children.forEach((c, i) => collect(c, `${path}/${i}`));
  }
  collect(scene);
  if (!meshMap.size) throw Error("O modelo não contém malhas para detalhar.");
  // Leitores próprios (SketchUp) marcam o nível de peça: o mais alto marcado em cada ramo
  const marked = [];
  scene.traverse((o) => {
    if (!o.userData.dtPart) return;
    for (let p = o.parent; p; p = p.parent) if (p.userData.dtPart) return;
    marked.push(o);
  });
  let root = scene;
  const hasMesh = (node) => {
    let found = false;
    node.traverse((o) => {
      if (meshMap.has(o.userData.dtPath)) found = true;
    });
    return found;
  };
  while (!root.isMesh) {
    const children = root.children.filter(hasMesh);
    if (children.length !== 1) break;
    root = children[0];
  }
  const roots = marked.length
    ? []
    : root.isMesh
      ? [root]
      : root.children.filter(hasMesh);
  for (const node of marked) {
    const meshes = [];
    node.traverse((o) => {
      if (meshMap.has(o.userData.dtPath)) meshes.push(o);
    });
    if (meshes.length) groups.push({ node, meshes });
  }
  for (const node of roots) {
    const meshes = [];
    node.traverse((o) => {
      if (meshMap.has(o.userData.dtPath)) meshes.push(o);
    });
    if (!meshes.length) continue;
    // Componentes grandes podem conter vários objetos. Evita agrupar o stand inteiro em um só volume.
    const split = meshes.length > 250 && node.children.length > 1;
    if (split) {
      for (const child of node.children.filter(hasMesh)) {
        const items = [];
        child.traverse((o) => {
          if (meshMap.has(o.userData.dtPath)) items.push(o);
        });
        groups.push({ node: child, meshes: items });
      }
    } else groups.push({ node, meshes });
  }
  for (const [id, mesh] of meshMap) {
    const originalName = mesh.userData.originalName || mesh.name;
    const label = usefulName(originalName) ? originalName : `Malha ${id}`;
    meshParts.set(id, describe([mesh], [id], label, scale, mesh, true));
  }
  const parts = groups.map(({ node, meshes }, i) => {
    const originalName = node.userData.originalName || node.name;
    let name = usefulName(originalName) ? originalName : "";
    if (!name)
      node.traverse((o) => {
        const original = o.userData.originalName || o.name;
        if (!name && usefulName(original)) name = original;
      });
    return describe(
      meshes,
      meshes.map((m) => m.userData.dtPath),
      name || `Peça ${String(i + 1).padStart(2, "0")}`,
      scale,
      node,
    );
  });
  return {
    parts,
    meshMap,
    meshParts,
    meshes: meshMap.size,
    triangles: studioParts.reduce((n, p) => n + p.tris, 0),
  };
}

export const isCad = (name) => /\.(dwg|dxf|zip|skp)$/i.test(name || "");
export async function validateFile(file) {
  if (!file || !/\.(glb|dwg|dxf|zip|skp)$/i.test(file.name))
    throw Error("Escolha um arquivo .skp, .glb, .dwg, .dxf ou .zip.");
  if (!file.size || file.size > MAX_FILE_BYTES)
    throw Error(`Envie um arquivo de até ${MAX_FILE_MB} MB.`);
  // DWG/DXF/ZIP/SKP são conferidos pelo leitor, que explica o problema se o arquivo não abrir.
  if (isCad(file.name)) return file;
  const header = await file.slice(0, 12).arrayBuffer(),
    view = new DataView(header);
  if (
    header.byteLength < 12 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== file.size
  )
    throw Error("O arquivo não é um GLB 2.0 válido.");
  return file;
}
export async function hashFile(file, buffer) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    buffer ?? (await file.arrayBuffer()),
  );
  return [...new Uint8Array(hash)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export function disposeModel(scene) {
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set();
  scene?.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of (Array.isArray(o.material)
      ? o.material
      : [o.material]
    ).filter(Boolean)) {
      materials.add(m);
      Object.values(m).forEach((t) => {
        if (t?.isTexture) textures.add(t);
      });
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
}
