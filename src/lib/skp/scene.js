import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const MAX_DEPTH = 32;
const INCH = 0.0254;
// Abaixo disso é item pequeno (produto exposto, frasco, parafuso): não vira peça sozinho
const SMALL = 0.1;

// Nomes automáticos do SketchUp (português e inglês): não dizem o que a peça é
export const genericSkpName = (name) =>
  !name?.trim() ||
  /(?:^|\s)(?:componente|component|agrupar|grupo|group)\s*#?\d*$/i.test(
    name.trim(),
  );

/**
 * Monta a cena three.js do modelo lido do .skp, em metros e com Y para cima.
 * Cada grupo/componente vira um nó com a matriz do SketchUp; as geometrias de uma
 * definição são compartilhadas entre as instâncias (componentes repetidos).
 * Depois marca com userData.dtPart o nível que o Detalha trata como peça:
 *  - componente com nome próprio (banqueta, spot, estante): a peça inteira;
 *  - conjunto só de itens pequenos (fileira de produtos): uma peça;
 *  - grupo genérico com peças dentro: contêiner, desce; faces soltas viram peça
 *    e itens pequenos soltos são reunidos em "Itens pequenos";
 *  - grupo ou componente só com faces: peça.
 */
export class SkpSceneBuilder {
  constructor(model) {
    this.model = model;
    this.materials = new Map();
    // Peças fechadas já juntadas: cópias do mesmo componente reaproveitam a geometria
    this.flatCache = new Map();
    this.geometries = new Map();
    this.layers = new Map(model.layers.map((l) => [l.id, l.name]));
    this.byId = new Map(model.materials.map((m) => [m.id, m]));
  }

  build() {
    const scene = new THREE.Group();
    scene.name = "SketchUp";
    const content = new THREE.Group();
    content.name = "Modelo";
    // SketchUp é Z para cima e mede em polegadas; o Detalha usa Y para cima e metros
    content.rotation.x = -Math.PI / 2;
    content.scale.setScalar(INCH);
    const loose = this.meshes(this.model.model, null, "Geometria solta");
    if (loose.length) {
      const g = new THREE.Group();
      g.name = "Geometria solta";
      g.userData.originalName = g.name;
      g.userData.skpInfo = { named: false, own: true };
      loose.forEach((m) => g.add(m));
      content.add(g);
    }
    for (const inst of this.model.model.instances) {
      const node = this.instance(inst, null, 0);
      if (node) content.add(node);
    }
    scene.add(content);
    scene.updateMatrixWorld(true);
    this.sizes = new Map();
    this.measure(content);
    for (const child of [...content.children]) this.mark(child);
    return scene;
  }

  instance(inst, parentMaterial, depth) {
    const def = this.model.definitions[inst.definition];
    if (!def || depth > MAX_DEPTH) return null;
    const group = new THREE.Group();
    const name = inst.name || def.name;
    group.name = name;
    group.userData.originalName = genericSkpName(name) ? "" : name;
    group.userData.skp = {
      id: inst.id,
      definition: def.name,
      instanceName: inst.name,
      kind: inst.group ? "group" : "component",
      defId: inst.definition,
      tag: this.layers.get(inst.layer) || "",
    };
    if (inst.matrix) {
      const m = inst.matrix,
        w = m[12] || 1;
      group.matrix.set(
        m[0] / w,
        m[3] / w,
        m[6] / w,
        m[9] / w,
        m[1] / w,
        m[4] / w,
        m[7] / w,
        m[10] / w,
        m[2] / w,
        m[5] / w,
        m[8] / w,
        m[11] / w,
        0,
        0,
        0,
        1,
      );
      group.matrix.decompose(group.position, group.quaternion, group.scale);
    }
    const material = inst.material ?? parentMaterial;
    const own = this.meshes(def, material, name);
    own.forEach((m) => group.add(m));
    group.userData.skpInfo = {
      // Componente com nome próprio, ou grupo que o projetista nomeou e só tem faces
      named:
        (!inst.group && !genericSkpName(def.name)) ||
        (!!inst.name && !genericSkpName(inst.name) && !def.instances.length),
      own: own.length > 0,
    };
    for (const child of def.instances) {
      const node = this.instance(child, material, depth + 1);
      if (node) group.add(node);
    }
    return group.children.length ? group : null;
  }

  // Maior medida (m) de cada nó e se há peça de porte (≥ 10 cm com faces) dentro dele
  measure(node) {
    const box = new THREE.Box3();
    let big = false;
    for (const child of node.children) {
      if (child.isMesh) {
        box.union(
          child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld),
        );
        continue;
      }
      const s = this.measure(child);
      box.union(s.box);
      big ||= s.big;
    }
    const size = box.isEmpty()
      ? 0
      : Math.max(...box.getSize(new THREE.Vector3()).toArray());
    if (node.userData.skpInfo?.own && size >= SMALL) big = true;
    const s = { box, size, big };
    this.sizes.set(node, s);
    return s;
  }

  mark(node) {
    const info = node.userData.skpInfo || {};
    const s = this.sizes.get(node);
    const groups = node.children.filter((c) => !c.isMesh);
    if (info.named || !s.big || !groups.length) {
      node.userData.dtPart = true;
      // Só itens pequenos dentro (fileira de frascos, produtos numa prateleira):
      // conjunto de produtos expostos, não peça de marcenaria
      if (!info.named && !s.big && groups.length) this.cluster(node);
      // Componente comprado ou conjunto de itens pequenos: não se divide depois
      if (groups.length) this.flatten(node, node.userData.skp?.defId);
      return;
    }
    // Contêiner com peças de porte dentro
    const meshes = node.children.filter((c) => c.isMesh);
    if (meshes.length)
      this.wrap(node, meshes, node.name, node.userData.originalName);
    const small = groups.filter(
      (c) => !this.sizes.get(c).big && this.sizes.get(c).size < SMALL,
    );
    if (small.length > 1) {
      const g = this.wrap(node, small, "Itens pequenos", "Itens pequenos");
      this.cluster(g);
      this.flatten(g, `${node.userData.skp?.defId}|itens`);
    }
    for (const child of groups)
      if (!small.includes(child) || small.length === 1) this.mark(child);
  }

  // Marca um conjunto de itens pequenos e conta quantos itens tem
  cluster(node) {
    let items = 0;
    node.traverse((o) => {
      if (o !== node && !o.isMesh && o.children.some((c) => c.isMesh)) items++;
    });
    node.userData.skpCluster = Math.max(items, 1);
    if (!node.userData.originalName) {
      node.name = "Itens pequenos";
      node.userData.originalName = "Itens pequenos";
    }
  }

  /**
   * Junta todas as malhas de uma peça fechada numa malha por material, no referencial
   * da peça. Uma banqueta ou uma fileira de frascos tinha centenas de malhas, que
   * pesavam no levantamento salvo e no visualizador.
   */
  flatten(node, defKey) {
    node.updateMatrixWorld(true);
    // Mesma definição e mesmos materiais (herdados) = mesma geometria juntada
    const sig = [];
    node.traverse((o) => o.isMesh && sig.push(o.material.uuid));
    const key = defKey != null ? `${defKey}|${sig.join(",")}` : null;
    const cached = key && this.flatCache.get(key);
    if (cached) {
      node.clear();
      for (const { geometry, material } of cached) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = node.name;
        mesh.userData.originalName = node.userData.originalName;
        node.add(mesh);
      }
      node.updateMatrixWorld(true);
      return;
    }
    const inverse = node.matrixWorld.clone().invert();
    const byMaterial = new Map();
    node.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld),
      );
      if (!byMaterial.has(o.material)) byMaterial.set(o.material, []);
      byMaterial.get(o.material).push(g);
    });
    if ([...byMaterial.values()].every((l) => l.length < 2)) return;
    const merged = [];
    for (const [material, list] of byMaterial) {
      const geometry = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!geometry) continue;
      geometry.computeBoundingBox();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = node.name;
      mesh.userData.originalName = node.userData.originalName;
      merged.push(mesh);
    }
    if (!merged.length) return;
    if (key)
      this.flatCache.set(
        key,
        merged.map((m) => ({ geometry: m.geometry, material: m.material })),
      );
    node.clear();
    merged.forEach((m) => node.add(m));
    node.updateMatrixWorld(true);
  }

  // Reúne filhos num grupo marcado como peça (mesma posição: o grupo novo não transforma)
  wrap(parent, children, name, label) {
    const g = new THREE.Group();
    g.name = name;
    g.userData.originalName = label;
    g.userData.dtPart = true;
    children.forEach((c) => g.add(c));
    parent.add(g);
    g.updateMatrixWorld(true);
    return g;
  }

  meshes(def, inherited, name) {
    const out = [];
    for (const mesh of def.meshes) {
      const key = `${def.id}|${mesh.material}`;
      let geometry = this.geometries.get(key);
      if (!geometry) {
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(mesh.positions, 3),
        );
        geometry.setAttribute(
          "normal",
          new THREE.BufferAttribute(mesh.normals, 3),
        );
        geometry.computeBoundingBox();
        this.geometries.set(key, geometry);
      }
      const id = mesh.material === -1 ? inherited : mesh.material;
      const obj = new THREE.Mesh(geometry, this.material(id));
      obj.name = name;
      obj.userData.originalName = genericSkpName(name) ? "" : name;
      out.push(obj);
    }
    return out;
  }

  material(id) {
    const key = id ?? "padrao";
    if (this.materials.has(key)) return this.materials.get(key);
    const src = this.byId.get(id);
    const [r, g, b] = src?.color || [230, 230, 230];
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(
        r / 255,
        g / 255,
        b / 255,
        THREE.SRGBColorSpace,
      ),
      roughness: 0.8,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: (src?.alpha ?? 1) < 1,
      opacity: src?.alpha ?? 1,
    });
    m.name = src?.name || "Padrão";
    this.materials.set(key, m);
    return m;
  }
}
