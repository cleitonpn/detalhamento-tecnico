import * as THREE from "three";
import { ACI } from "./aci.js";
import { ocsAxes } from "./geom.js";

const MAX_DEPTH = 24;

// Monta a cena three.js a partir da descrição lida do DWG (parse.js).
// Mantém as unidades do arquivo; o Detalha aplica `sourceUnit` depois.
// Cada INSERT vira um grupo com o nome do bloco: é a "peça" do SketchUp/AutoCAD.
export class DwgSceneBuilder {
  constructor(model) {
    this.model = model;
    this.materials = new Map();
    this.geometries = new WeakMap();
  }

  build() {
    const scene = new THREE.Group();
    scene.name = "DWG";
    const content = this.block(this.model.modelName, null, null, 0);
    content.name = "Model space";
    // DWG é Z para cima; glTF/Detalha usam Y para cima.
    content.rotation.x = -Math.PI / 2;
    scene.add(content);
    return scene;
  }

  block(name, parentColor, parentLayer, depth) {
    const group = new THREE.Group();
    const block = this.model.blocks[name];
    if (!block || depth > MAX_DEPTH) return group;
    for (const item of block.items) {
      const obj = this.item(item, parentColor, parentLayer, depth);
      if (obj) group.add(obj);
    }
    return group;
  }

  item(item, parentColor, parentLayer, depth) {
    if (item.visible === false || item.kind === "line") return null;
    const color = this.color(item, parentColor, parentLayer);
    let obj = null;
    if (item.kind === "insert") obj = this.insert(item, color, depth);
    else if (item.kind === "mesh") {
      obj = new THREE.Mesh(this.geometry(item), this.material(color));
      obj.name = `${item.type} ${item.handle}`;
    }
    if (!obj) return null;
    obj.userData.originalName = obj.name;
    obj.userData.dwg = {
      handle: item.handle,
      layer: item.layer,
      type: item.type ?? "INSERT",
    };
    return obj;
  }

  insert(item, color, depth) {
    const block = this.model.blocks[item.name];
    if (!block?.items.length) return null;
    const m = insertMatrix(item, block.base);
    const copies = [];
    const rot = new THREE.Matrix4().makeRotationZ(item.rotation);
    const ocs = basis(item.normal);
    for (let r = 0; r < item.rows; r++)
      for (let c = 0; c < item.columns; c++) {
        const off = new THREE.Vector3(
          c * item.columnSpacing,
          r * item.rowSpacing,
          0,
        )
          .applyMatrix4(rot)
          .applyMatrix4(ocs);
        const g = this.block(item.name, color, item.layer, depth + 1);
        if (!g.children.length) continue;
        g.applyMatrix4(
          new THREE.Matrix4().makeTranslation(off.x, off.y, off.z).multiply(m),
        );
        g.name = item.name;
        copies.push(g);
      }
    if (copies.length === 1) return copies[0];
    if (!copies.length) return null;
    const outer = new THREE.Group();
    outer.name = item.name;
    copies.forEach((g) => outer.add(g));
    return outer;
  }

  color(item, parentColor, parentLayer) {
    if (item.color != null) return item.color;
    const idx = item.colorIndex;
    if (idx === 0) return parentColor ?? 0xd9d9d9; // ByBlock
    if (idx === 256 || idx == null) {
      // ByLayer; a camada "0" dentro de um bloco herda do INSERT
      if (item.layer === "0" && parentColor != null) return parentColor;
      const layer =
        this.model.layers[
          item.layer === "0" && parentLayer ? parentLayer : item.layer
        ];
      if (!layer) return 0xd9d9d9;
      if (layer.color > 0) return layer.color & 0xffffff;
      return ACI[Math.abs(layer.colorIndex ?? 7)] ?? 0xd9d9d9;
    }
    return ACI[idx] ?? 0xd9d9d9;
  }

  geometry(item) {
    let geo = this.geometries.get(item);
    if (!geo) {
      geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(item.positions, 3),
      );
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      this.geometries.set(item, geo);
    }
    return geo;
  }

  material(rgb) {
    let m = this.materials.get(rgb);
    if (!m) {
      // Branco do ACI 7 fica cinza claro para continuar legível no visualizador
      const shown = rgb === 0xffffff ? 0xd9d9d9 : rgb;
      m = new THREE.MeshStandardMaterial({
        color: shown,
        roughness: 0.85,
        side: THREE.DoubleSide,
      });
      m.name = `Cor #${rgb.toString(16).padStart(6, "0").toUpperCase()}`;
      this.materials.set(rgb, m);
    }
    return m;
  }
}

function basis(normal) {
  const a = ocsAxes(normal);
  return new THREE.Matrix4().makeBasis(
    new THREE.Vector3(a.x.x, a.x.y, a.x.z),
    new THREE.Vector3(a.y.x, a.y.y, a.y.z),
    new THREE.Vector3(a.z.x, a.z.y, a.z.z),
  );
}

// OCS · T(ponto de inserção) · Rz · S · T(−ponto base do bloco)
function insertMatrix(item, base) {
  const p = item.insertionPoint;
  return basis(item.normal)
    .multiply(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z ?? 0))
    .multiply(new THREE.Matrix4().makeRotationZ(item.rotation))
    .multiply(
      new THREE.Matrix4().makeScale(
        item.scale[0] || 1,
        item.scale[1] || 1,
        item.scale[2] || 1,
      ),
    )
    .multiply(
      new THREE.Matrix4().makeTranslation(
        -(base.x || 0),
        -(base.y || 0),
        -(base.z || 0),
      ),
    );
}

const UNIT_NAME = { 4: "mm", 5: "cm", 6: "m" };
const UNIT_SCALE = { mm: 0.001, cm: 0.01, m: 1 };

// O INSUNITS do cabeçalho às vezes não corresponde ao desenho (ex.: diz mm, desenhado em m).
// Stands medem de ~0,05 m a ~500 m: fora disso, a unidade é escolhida pela ordem de grandeza.
export function guessUnit(declared, scene) {
  scene.updateWorldMatrix(true, true);
  const size = new THREE.Box3()
    .setFromObject(scene)
    .getSize(new THREE.Vector3())
    .length();
  const fits = (u) => {
    const m = size * UNIT_SCALE[u];
    return m >= 0.05 && m <= 500;
  };
  const named = UNIT_NAME[declared];
  if (!size || (named && fits(named)))
    return { unit: named || "mm", mismatch: false };
  return {
    unit: size < 60 ? "m" : size < 6000 ? "cm" : "mm",
    mismatch: Boolean(named),
  };
}
