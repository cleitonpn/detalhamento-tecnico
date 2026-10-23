// Leitor próprio de arquivos do SketchUp (.skp, versão 2021 ou mais nova), sem SDK.
// O arquivo é um cabeçalho UTF-16 ("SketchUp Model" e a versão) seguido de um ZIP.
// No ZIP, model.dat guarda o modelo numa árvore de blocos "etiqueta (2 bytes) +
// tamanho (4 bytes) + conteúdo"; materials/*/material.xml guarda as cores.
// Etiquetas identificadas por engenharia reversa (ver docs/SKETCHUP.md).
import { unzipSync, strFromU8 } from "fflate";
import { ShapeUtils, Vector2 } from "three";

const T = {
  ROOT: 0x1f4,
  DEFINITIONS: 0x1f9,
  DEF_LIST: 0x1770,
  DEF_LIST2: 0x1771,
  DEFINITION: 0x157c,
  DEF_GUID: 0x157d,
  DEF_NAME: 0x157e,
  MODEL: 0x1f6,
  ENTITIES: 0x1388,
  VERTICES: 0x1389,
  VERTEX: 0x9c4,
  POSITION: 0x9c5,
  EDGES: 0x138a,
  EDGE: 0xbb8,
  EDGE_START: 0xbb9,
  EDGE_END: 0xbba,
  FACES: 0x138b,
  FACE: 0xdac,
  FACE_PLANE: 0xdad,
  FACE_LOOPS: 0xdae,
  LOOP: 0x1194,
  LOOP_USES: 0x1195,
  EDGE_USE: 0xfa0,
  USE_EDGE: 0xfa1,
  USE_REVERSED: 0xfa2,
  COMPONENTS: 0x138c,
  GROUPS: 0x138d,
  GROUP_WRAP: 0x1d4c,
  INSTANCE: 0x1964,
  INST_NAME: 0x1965,
  INST_MATRIX: 0x1966,
  INST_DEF: 0x1967,
  HEADER: 0x7d0,
  HEADER_MATERIAL: 0x7d1,
  HEADER_LAYER: 0x7d2,
  HEADER_FLAGS: 0x7d3,
  ID_BOX: 0x5dc,
  ID: 0x5de,
  MATERIALS: 0x1f7,
  MAT_LIST: 0x30d4,
  MAT_LIST2: 0x30d5,
  MATERIAL: 0x32c8,
  MAT_NAME: 0x32cc,
  MAT_FILES: 0x32ce,
  MAT_FILE: 0x2134,
  LAYERS: 0x1f8,
  LAYER_LIST: 0x3a98,
  LAYER_LIST2: 0x3a99,
  LAYER: 0x3c8c,
  LAYER_NAME: 0x3c8d,
};

const SIGNATURE = "SketchUp Model";

/** Confere o cabeçalho e devolve a versão ("26.2.243") ou null. */
export function skpVersion(bytes) {
  const head = new TextDecoder("utf-16le").decode(
    bytes.subarray(0, Math.min(bytes.length, 96)),
  );
  if (!head.includes(SIGNATURE)) return null;
  return /\{([\d.]+)\}/.exec(head)?.[1] || "";
}

/** Separa o ZIP interno: model.dat e os material.xml. */
export function openSkp(bytes) {
  const version = skpVersion(bytes);
  if (version === null) throw Error("O arquivo não é um modelo do SketchUp.");
  let at = -1;
  for (let i = 0; i < Math.min(bytes.length - 4, 4096); i++)
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 3 &&
      bytes[i + 3] === 4
    ) {
      at = i;
      break;
    }
  if (at < 0)
    throw Error(
      `Este .skp (versão ${version || "antiga"}) usa o formato anterior ao SketchUp 2021. Abra no SketchUp e salve de novo numa versão 2021 ou mais nova.`,
    );
  const files = unzipSync(bytes.subarray(at), {
    filter: (f) =>
      f.name === "model.dat" ||
      /^materials\/[^/]+\/material\.xml$/.test(f.name),
  });
  if (!files["model.dat"])
    throw Error("O .skp não contém o modelo (model.dat).");
  const materialXml = {};
  for (const [name, data] of Object.entries(files))
    if (name !== "model.dat") materialXml[name.split("/")[1]] = strFromU8(data);
  return { version, data: files["model.dat"], materialXml };
}

// Leitura da árvore de blocos
class Tlv {
  constructor(data) {
    this.data = data;
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.utf8 = new TextDecoder("utf-8");
  }
  /** Filhos diretos de um bloco: [etiqueta, início, tamanho]. */
  kids(off, len) {
    const out = [];
    const end = off + len;
    for (let p = off; p + 6 <= end;) {
      const tag = this.dv.getUint16(p, true),
        size = this.dv.getUint32(p + 2, true);
      if (p + 6 + size > end) break;
      out.push([tag, p + 6, size]);
      p += 6 + size;
    }
    return out;
  }
  first(off, len, tag) {
    for (const k of this.kids(off, len)) if (k[0] === tag) return k;
    return null;
  }
  all(off, len, tag) {
    return this.kids(off, len).filter((k) => k[0] === tag);
  }
  /** Caminho de etiquetas a partir de um bloco. */
  path(node, ...tags) {
    let cur = node;
    for (const t of tags) {
      if (!cur) return null;
      cur = this.first(cur[1], cur[2], t);
    }
    return cur;
  }
  uint(node) {
    if (!node) return null;
    let v = 0;
    for (let i = node[2] - 1; i >= 0; i--) v = v * 256 + this.data[node[1] + i];
    return v;
  }
  text(node) {
    return node
      ? this.utf8.decode(this.data.subarray(node[1], node[1] + node[2]))
      : "";
  }
  doubles(node) {
    if (!node) return null;
    const n = Math.floor(node[2] / 8);
    const out = new Array(n);
    for (let i = 0; i < n; i++)
      out[i] = this.dv.getFloat64(node[1] + 8 * i, true);
    return out;
  }
  /** Identificador, material, tag e sinalizadores do cabeçalho de uma entidade. */
  header(node) {
    const h = this.first(node[1], node[2], T.HEADER);
    // Vértices não têm cabeçalho: o identificador fica direto no bloco
    if (!h)
      return {
        id: this.uint(this.path(node, T.ID_BOX, T.ID)),
        material: null,
        layer: null,
        flags: 0,
      };
    return {
      id: this.uint(this.path(h, T.ID_BOX, T.ID)),
      material: this.uint(this.first(h[1], h[2], T.HEADER_MATERIAL)),
      layer: this.uint(this.first(h[1], h[2], T.HEADER_LAYER)),
      flags: this.uint(this.first(h[1], h[2], T.HEADER_FLAGS)) || 0,
    };
  }
}

// Cor do material: material.xml traz colorRed/Green/Blue e transparência
function materialColor(xml) {
  const attr = (n) => {
    const m = new RegExp(`\\b${n}="([^"]*)"`).exec(xml || "");
    return m ? m[1] : null;
  };
  const r = Number(attr("colorRed")),
    g = Number(attr("colorGreen")),
    b = Number(attr("colorBlue"));
  const useTrans = attr("useTrans") === "1";
  const trans = Number(attr("trans") || 0);
  return {
    color:
      [r, g, b].every(Number.isFinite) && xml ? [r, g, b] : [200, 200, 200],
    alpha: useTrans ? Math.max(0.05, 1 - trans) : 1,
    texture: attr("hasTexture") === "1",
  };
}

/**
 * Lê o .skp e devolve o modelo: materiais, tags, definições (geometria por material,
 * em polegadas, no referencial da definição) e as instâncias com matriz.
 */
export function parseSkp(bytes) {
  const { version, data, materialXml } = openSkp(bytes);
  const t = new Tlv(data);
  const top = t.kids(0, data.length);
  const root = top.find((k) => k[0] === T.ROOT);
  if (!root) throw Error("Estrutura do .skp não reconhecida.");
  const stats = { vertices: 0, faces: 0, holes: 0, instances: 0, failed: 0 };

  // Materiais
  const materials = [];
  const matList = t.path(root, T.MATERIALS, T.MAT_LIST, T.MAT_LIST2);
  for (const m of matList ? t.all(matList[1], matList[2], T.MATERIAL) : []) {
    const name = t.text(t.first(m[1], m[2], T.MAT_NAME));
    const file = t.text(t.path(m, T.MAT_FILES, T.MAT_FILE));
    const folder = /^materials\/([^/]+)\//.exec(file)?.[1] ?? name;
    materials.push({
      id: t.uint(t.path(m, T.ID_BOX, T.ID)),
      name,
      ...materialColor(materialXml[folder]),
    });
  }

  // Tags (camadas)
  const layers = [];
  const layerList = t.path(root, T.LAYERS, T.LAYER_LIST, T.LAYER_LIST2);
  for (const l of layerList ? t.all(layerList[1], layerList[2], T.LAYER) : [])
    layers.push({
      id: t.uint(t.path(l, T.ID_BOX, T.ID)),
      name: t.text(t.first(l[1], l[2], T.LAYER_NAME)),
    });

  // Coleção de entidades: faces trianguladas por material e instâncias
  const entities = (node) => {
    const head = t.header(node);
    const vertices = new Map();
    const vs = t.first(node[1], node[2], T.VERTICES);
    for (const v of vs ? t.all(vs[1], vs[2], T.VERTEX) : []) {
      const p = t.doubles(t.first(v[1], v[2], T.POSITION));
      if (p) vertices.set(t.header(v).id, p);
    }
    stats.vertices += vertices.size;
    const edges = new Map();
    const es = t.first(node[1], node[2], T.EDGES);
    for (const e of es ? t.all(es[1], es[2], T.EDGE) : [])
      edges.set(t.header(e).id, [
        t.uint(t.first(e[1], e[2], T.EDGE_START)),
        t.uint(t.first(e[1], e[2], T.EDGE_END)),
      ]);
    const byMaterial = new Map(); // material (ou -1 = herda da instância) -> [posições, normais]
    const fs = t.first(node[1], node[2], T.FACES);
    for (const f of fs ? t.all(fs[1], fs[2], T.FACE) : []) {
      stats.faces++;
      const fh = t.header(f);
      const plane = t.doubles(t.first(f[1], f[2], T.FACE_PLANE));
      const loopsNode = t.first(f[1], f[2], T.FACE_LOOPS);
      if (!plane || !loopsNode) continue;
      const loops = [];
      for (const loop of t.all(loopsNode[1], loopsNode[2], T.LOOP)) {
        const uses = t.first(loop[1], loop[2], T.LOOP_USES);
        const pts = [];
        for (const u of uses ? t.all(uses[1], uses[2], T.EDGE_USE) : []) {
          const edge = edges.get(t.uint(t.first(u[1], u[2], T.USE_EDGE)));
          if (!edge) continue;
          const reversed = t.uint(t.first(u[1], u[2], T.USE_REVERSED)) === 1;
          const p = vertices.get(reversed ? edge[1] : edge[0]);
          if (p) pts.push(p);
        }
        if (pts.length >= 3) loops.push(pts);
      }
      if (!loops.length) continue;
      if (loops.length > 1) stats.holes += loops.length - 1;
      const tris = triangulate(loops, plane);
      if (!tris) {
        stats.failed++;
        continue;
      }
      const key = fh.material ?? -1;
      if (!byMaterial.has(key)) byMaterial.set(key, { pos: [], nor: [] });
      const bucket = byMaterial.get(key);
      for (const p of tris) {
        bucket.pos.push(p[0], p[1], p[2]);
        bucket.nor.push(plane[0], plane[1], plane[2]);
      }
    }
    const meshes = [...byMaterial].map(([material, b]) => ({
      material,
      positions: new Float32Array(b.pos),
      normals: new Float32Array(b.nor),
    }));
    const instances = [];
    const readInstance = (inst, group) => {
      const h = t.header(inst);
      const m = t.doubles(t.first(inst[1], inst[2], T.INST_MATRIX));
      stats.instances++;
      instances.push({
        id: h.id,
        group,
        name: t.text(t.first(inst[1], inst[2], T.INST_NAME)),
        definition: t.uint(t.first(inst[1], inst[2], T.INST_DEF)),
        material: h.material,
        layer: h.layer,
        flags: h.flags,
        matrix: m && m.length >= 12 ? m.slice(0, 13) : null,
      });
    };
    const comps = t.first(node[1], node[2], T.COMPONENTS);
    for (const i of comps ? t.all(comps[1], comps[2], T.INSTANCE) : [])
      readInstance(i, false);
    const groups = t.first(node[1], node[2], T.GROUPS);
    for (const w of groups ? t.all(groups[1], groups[2], T.GROUP_WRAP) : [])
      for (const i of t.all(w[1], w[2], T.INSTANCE)) readInstance(i, true);
    return { id: head.id, meshes, instances };
  };

  // Definições de componentes e grupos
  const definitions = {};
  const defList = t.path(root, T.DEFINITIONS, T.DEF_LIST, T.DEF_LIST2);
  for (const d of defList ? t.all(defList[1], defList[2], T.DEFINITION) : []) {
    const ents = t.first(d[1], d[2], T.ENTITIES);
    if (!ents) continue;
    const e = entities(ents);
    definitions[e.id] = {
      ...e,
      name: t.text(t.first(d[1], d[2], T.DEF_NAME)),
    };
  }
  const modelNode = t.path(root, T.MODEL, T.ENTITIES);
  if (!modelNode) throw Error("O .skp não tem entidades no modelo.");
  const model = entities(modelNode);
  return { version, unit: "in", materials, layers, definitions, model, stats };
}

/** Face plana (com furos) em triângulos, no sentido da normal da face. */
function triangulate(loops, plane) {
  const [nx, ny, nz] = plane;
  // Projeta no plano mais alinhado com a face
  const ax = Math.abs(nx),
    ay = Math.abs(ny),
    az = Math.abs(nz);
  const [i, j] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [2, 0];
  // Cada ponto 2D leva o ponto 3D junto (o triangulador pode remover pontos repetidos)
  const flat = loops.map((pts) =>
    pts.map((p) => Object.assign(new Vector2(p[i], p[j]), { p3: p })),
  );
  // O contorno externo é o de maior área; os demais são furos
  const area = (pts) => Math.abs(ShapeUtils.area(pts));
  let outer = 0;
  flat.forEach((pts, k) => {
    if (area(pts) > area(flat[outer])) outer = k;
  });
  const contour = flat[outer],
    holes = flat.filter((_, k) => k !== outer);
  let faces;
  try {
    faces = ShapeUtils.triangulateShape(contour, holes);
  } catch {
    return null;
  }
  if (!faces.length) return null;
  const ordered = [...contour, ...holes.flat()].map((v) => v.p3);
  const out = [];
  for (const [a, b, c] of faces) {
    const p = ordered[a],
      q = ordered[b],
      r = ordered[c];
    if (!p || !q || !r) continue;
    const cx = (q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]),
      cy = (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]),
      cz = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    if (cx * nx + cy * ny + cz * nz < 0) out.push(p, r, q);
    else out.push(p, q, r);
  }
  return out;
}
