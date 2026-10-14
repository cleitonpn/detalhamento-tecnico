// Exportação de peças escolhidas para .glb, para uso em outras ferramentas.
// Não altera o projeto nem as validações: só lê a geometria já carregada.
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { zipSync } from "fflate";
import { SCALE } from "../domain/project.js";

/**
 * Cena com as peças pedidas, em metros e Y para cima (padrão glTF).
 * Cada peça vira um grupo com o nome dela; as malhas mantêm materiais e cores originais.
 * `center`: coloca o conjunto no centro, apoiado no chão (y = 0).
 */
export function partsScene(parts, meshMap, sourceUnit, { center = true } = {}) {
  const scale = SCALE[sourceUnit] || 1;
  const S = new THREE.Matrix4().makeScale(scale, scale, scale);
  const scene = new THREE.Scene();
  for (const part of parts) {
    const group = new THREE.Group();
    group.name = part.label;
    // Medidas conferidas no Detalha seguem junto, para a outra ferramenta consultar
    group.userData = {
      detalha: {
        partId: part.id,
        kind: part.review?.kind || "unclassified",
        dimensions_m: part.dimensions,
      },
    };
    for (const id of part.meshIds) {
      const mesh = meshMap.get(id);
      if (!mesh?.geometry?.attributes.position) continue;
      mesh.updateWorldMatrix(true, false);
      const copy = new THREE.Mesh(mesh.geometry, mesh.material);
      copy.name = mesh.userData.originalName || mesh.name || "Malha";
      new THREE.Matrix4()
        .multiplyMatrices(S, mesh.matrixWorld)
        .decompose(copy.position, copy.quaternion, copy.scale);
      group.add(copy);
    }
    if (group.children.length) scene.add(group);
  }
  if (center && scene.children.length) {
    const box = new THREE.Box3().setFromObject(scene);
    const c = box.getCenter(new THREE.Vector3());
    const shift = new THREE.Vector3(-c.x, -box.min.y, -c.z);
    for (const group of scene.children)
      for (const m of group.children) m.position.add(shift);
  }
  return scene;
}

export async function toGlb(scene) {
  const result = await new GLTFExporter().parseAsync(scene, {
    binary: true,
    onlyVisible: false,
  });
  return new Uint8Array(result);
}

export const safeName = (s) =>
  String(s || "peca")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "peca";

/**
 * Gera o arquivo para download: um .glb com todas as peças, ou um .zip com um .glb por peça.
 * Devolve { blob, name }.
 */
export async function exportParts(
  project,
  parts,
  meshMap,
  { center = true, separate = false } = {},
) {
  if (!parts.length)
    throw Error("Selecione pelo menos uma peça para exportar.");
  const base = safeName(project.name);
  if (!separate || parts.length === 1) {
    const bytes = await toGlb(
      partsScene(parts, meshMap, project.sourceUnit, { center }),
    );
    const name =
      parts.length === 1
        ? `${base} - ${safeName(parts[0].label)}.glb`
        : `${base} - ${parts.length} pecas.glb`;
    return { blob: new Blob([bytes], { type: "model/gltf-binary" }), name };
  }
  const files = {};
  const used = new Map();
  for (const part of parts) {
    const label = safeName(part.label);
    const n = (used.get(label) || 0) + 1;
    used.set(label, n);
    files[`${label}${n > 1 ? ` (${n})` : ""}.glb`] = await toGlb(
      partsScene([part], meshMap, project.sourceUnit, { center }),
    );
  }
  return {
    blob: new Blob([zipSync(files, { level: 6 })], { type: "application/zip" }),
    name: `${base} - ${parts.length} pecas.zip`,
  };
}

export function download({ blob, name }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
