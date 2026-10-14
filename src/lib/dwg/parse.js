// Lê um DWG/DXF com libredwg-web e devolve uma descrição neutra do modelo:
// blocos (com seus itens), itens do model space, camadas e estatísticas.
// Roda tanto no Web Worker quanto no Node (testes).
import { Dwg_File_Type } from "@mlightcad/libredwg-web";
import { ShapeUtils, Vector2 } from "three";
import { ocsAxes, ocs } from "./geom.js";

const T = {
  PFACE: 29,
  PMESH: 30,
  VERTEX_PFACE: 13,
  VERTEX_PFACE_FACE: 14,
  VERTEX_MESH: 12,
  SOLID3D: 38,
  REGION: 37,
  BODY: 39,
  MESH: 663,
};

// Offset de `vertind[4]` em Dwg_Entity_VERTEX_PFACE_FACE no wasm32:
// { parent* (4), flag RC (1), pad (1), vertind BS[4] }
const PFACE_VERTIND_OFFSET = 6;

const hex = (v) =>
  (typeof v === "bigint" ? v : BigInt(v ?? 0)).toString(16).toUpperCase();

export function parseDwg(lib, input, isDxf = false) {
  const t0 = Date.now();
  const data = lib.dwg_read_data(
    input,
    isDxf ? Dwg_File_Type.DXF : Dwg_File_Type.DWG,
  );
  if (!data)
    throw new Error(
      "Não foi possível ler o arquivo (formato não suportado ou corrompido).",
    );
  const db = lib.convert(data);

  const layers = {};
  const layerByHandle = new Map();
  for (const l of db.tables.LAYER.entries) {
    layers[l.name] = {
      colorIndex: l.colorIndex,
      color: l.color,
      off: !!l.off,
      frozen: !!l.frozen,
    };
    layerByHandle.set(l.handle, l.name);
  }

  const blockByHandle = new Map();
  const blocks = {};
  let modelName = "*Model_Space";
  for (const b of db.tables.BLOCK_RECORD.entries) {
    blockByHandle.set(b.handle, b.name);
    if (/^\*model_space$/i.test(b.name)) modelName = b.name;
    blocks[b.name] = { base: b.basePoint || { x: 0, y: 0, z: 0 }, items: [] };
  }

  const stats = {
    faces: 0,
    meshes: 0,
    inserts: 0,
    lines: 0,
    solids3d: 0,
    skipped: {},
  };
  const transfer = [];

  // 1) Entidades que o wrapper já converte
  const ownerOf = (e) =>
    blockByHandle.get(e.ownerBlockRecordSoftId) ?? modelName;
  const all = [];
  for (const b of db.tables.BLOCK_RECORD.entries)
    for (const e of b.entities || []) all.push([b.name, e]);
  if (all.length === 0) for (const e of db.entities) all.push([ownerOf(e), e]);

  for (const [blockName, e] of all) {
    if (e.isInPaperSpace) continue;
    const target =
      blocks[blockName] ??
      (blocks[blockName] = { base: { x: 0, y: 0, z: 0 }, items: [] });
    const item = convertWrapped(e, stats);
    if (item) {
      target.items.push(item);
      if (item.positions) transfer.push(item.positions.buffer);
    }
  }

  // 2) Entidades que o wrapper ignora: MESH, polyface, malha MxN, sólidos ACIS
  const w = lib.wasmInstance;
  const n = w.dwg_get_num_objects(data);
  for (let i = 0; i < n; i++) {
    const o = w.dwg_get_object(data, i);
    const ft = w.dwg_object_get_fixedtype(o);
    if (
      ft !== T.MESH &&
      ft !== T.PFACE &&
      ft !== T.PMESH &&
      ft !== T.SOLID3D &&
      ft !== T.REGION &&
      ft !== T.BODY
    )
      continue;
    if (ft === T.SOLID3D || ft === T.BODY) {
      stats.solids3d++;
      continue;
    }
    if (ft === T.REGION) {
      stats.skipped.REGION = (stats.skipped.REGION || 0) + 1;
      continue;
    }

    const ent = lib.dwg_object_to_entity(o);
    const tio = lib.dwg_object_to_entity_tio(o);
    const common = commonAttrs(lib, ent, layerByHandle);
    let tris = null;
    try {
      if (ft === T.MESH) tris = readSubDMesh(lib, tio);
      else if (ft === T.PFACE) tris = readPolyface(lib, w, tio);
      else tris = readPolygonMesh(lib, w, tio);
    } catch (err) {
      stats.skipped[`erro ${ft}`] = (stats.skipped[`erro ${ft}`] || 0) + 1;
      continue;
    }
    if (!tris || tris.length === 0) continue;
    const blockName = blockByHandle.get(common.owner) ?? modelName;
    const target =
      blocks[blockName] ??
      (blocks[blockName] = { base: { x: 0, y: 0, z: 0 }, items: [] });
    const positions = new Float32Array(tris);
    stats.meshes++;
    stats.faces += positions.length / 9;
    target.items.push({
      kind: "mesh",
      type: ft === T.MESH ? "MESH" : ft === T.PFACE ? "POLYFACE" : "POLYMESH",
      ...common,
      positions,
    });
    transfer.push(positions.buffer);
  }

  // Funde os 3DFACE soltos de cada bloco/camada/cor em uma única malha
  for (const b of Object.values(blocks)) b.items = mergeFaces(b.items);

  lib.dwg_free(data);
  return {
    model: {
      blocks,
      modelName,
      layers,
      units: db.header?.INSUNITS ?? 0,
      stats,
      ms: Date.now() - t0,
    },
    transfer,
  };
}

function commonAttrs(lib, ent, layerByHandle) {
  const color = lib.dwg_object_entity_get_color_object(ent);
  let rgb = null;
  if (color.method === 0xc2 || ((color.rgb >>> 24) & 0xff) === 0xc2)
    rgb = color.rgb & 0xffffff;
  const layerRef = lib.dwg_object_entity_get_layer_object_ref(ent);
  const owner = lib.dwg_object_entity_get_ownerhandle_object(ent);
  const handle = lib.dwg_object_entity_get_handle_object(ent);
  return {
    handle: hex(handle.value),
    owner: hex(owner.absolute_ref),
    layer: layerByHandle.get(hex(layerRef.handleref.value)) ?? "0",
    colorIndex: color.index,
    color: rgb,
    visible: !lib.dwg_object_entity_get_invisible(ent),
  };
}

// AcDbSubDMesh: faces = [n, i0..in-1, n, ...]
function readSubDMesh(lib, tio) {
  const nv = lib.dwg_dynapi_entity_data(tio, "num_vertex");
  const nf = lib.dwg_dynapi_entity_data(tio, "num_faces");
  if (!nv || !nf) return null;
  const v = lib.dwg_ptr_to_point3d_array(
    lib.dwg_dynapi_entity_data(tio, "vertex"),
    nv,
  );
  const f = lib.dwg_ptr_to_uint32_t_array(
    lib.dwg_dynapi_entity_data(tio, "faces"),
    nf,
  );
  const out = [];
  for (let i = 0; i < f.length;) {
    const count = f[i++];
    if (!count || i + count > f.length) break;
    const poly = [];
    for (let k = 0; k < count; k++) {
      const p = v[f[i + k]];
      if (p) poly.push(p);
    }
    i += count;
    triangulate(poly, out);
  }
  return out;
}

// POLYLINE com flag 64: vértices VERTEX_PFACE + faces VERTEX_PFACE_FACE (índices base 1)
function readPolyface(lib, w, tio) {
  const owned = lib.dwg_dynapi_entity_data(tio, "num_owned");
  const ptr = lib.dwg_dynapi_entity_data(tio, "vertex");
  if (!owned || !ptr) return null;
  const refs = lib.dwg_ptr_to_object_ref_ptr_array(ptr, owned);
  const pts = [];
  const faces = [];
  for (const r of refs) {
    const vo = w.dwg_ref_get_object(r);
    if (!vo) continue;
    const vt = w.dwg_object_get_fixedtype(vo);
    const vtio = lib.dwg_object_to_entity_tio(vo);
    if (vt === T.VERTEX_PFACE)
      pts.push(lib.dwg_dynapi_entity_data(vtio, "point"));
    else if (vt === T.VERTEX_PFACE_FACE)
      faces.push(lib.dwg_ptr_to_int16_t_array(vtio + PFACE_VERTIND_OFFSET, 4));
  }
  const out = [];
  for (const idx of faces) {
    const poly = [];
    for (const k of idx) {
      const a = Math.abs(k);
      if (a > 0 && a <= pts.length) poly.push(pts[a - 1]);
    }
    triangulate(poly, out);
  }
  return out;
}

// POLYLINE com flag 16: malha M x N de VERTEX_MESH
function readPolygonMesh(lib, w, tio) {
  const owned = lib.dwg_dynapi_entity_data(tio, "num_owned");
  const ptr = lib.dwg_dynapi_entity_data(tio, "vertex");
  const m = lib.dwg_dynapi_entity_data(tio, "num_m_verts");
  const nn = lib.dwg_dynapi_entity_data(tio, "num_n_verts");
  const flag = lib.dwg_dynapi_entity_data(tio, "flag") || 0;
  if (!owned || !ptr || !m || !nn) return null;
  const refs = lib.dwg_ptr_to_object_ref_ptr_array(ptr, owned);
  const pts = [];
  for (const r of refs) {
    const vo = w.dwg_ref_get_object(r);
    if (vo && w.dwg_object_get_fixedtype(vo) === T.VERTEX_MESH)
      pts.push(
        lib.dwg_dynapi_entity_data(lib.dwg_object_to_entity_tio(vo), "point"),
      );
  }
  if (pts.length < m * nn) return null;
  const closedM = flag & 1,
    closedN = flag & 32;
  const out = [];
  const P = (i, j) => pts[(i % m) * nn + (j % nn)];
  for (let i = 0; i < (closedM ? m : m - 1); i++)
    for (let j = 0; j < (closedN ? nn : nn - 1); j++)
      triangulate([P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)], out);
  return out;
}

function convertWrapped(e, stats) {
  const common = {
    handle: e.handle,
    layer: e.layer ?? "0",
    colorIndex: e.colorIndex ?? 256,
    color: e.color ?? null,
    visible: e.isVisible !== false,
  };
  switch (e.type) {
    case "3DFACE": {
      const out = [];
      const c = [e.corner1, e.corner2, e.corner3];
      if (e.corner4 && !same(e.corner4, e.corner3)) c.push(e.corner4);
      triangulate(c, out);
      if (!out.length) return null;
      stats.faces += out.length / 9;
      return {
        kind: "face",
        type: "3DFACE",
        ...common,
        positions: new Float32Array(out),
      };
    }
    case "SOLID": {
      // SOLID 2D: cantos na ordem 1-2-4-3, no OCS com elevação
      const ex = e.extrusionDirection;
      const c = [e.corner1, e.corner2, e.corner4 ?? e.corner3, e.corner3]
        .filter(Boolean)
        .map((p) => ocs(ex, p));
      const out = [];
      triangulate(dedupe(c), out);
      if (!out.length) return null;
      return {
        kind: "face",
        type: "SOLID",
        ...common,
        positions: new Float32Array(out),
      };
    }
    case "INSERT": {
      stats.inserts++;
      return {
        kind: "insert",
        ...common,
        name: e.name,
        insertionPoint: e.insertionPoint,
        scale: [e.xScale ?? 1, e.yScale ?? 1, e.zScale ?? 1],
        rotation: e.rotation ?? 0,
        normal: e.extrusionDirection ?? { x: 0, y: 0, z: 1 },
        columns: Math.max(1, e.columnCount || 1),
        rows: Math.max(1, e.rowCount || 1),
        columnSpacing: e.columnSpacing || 0,
        rowSpacing: e.rowSpacing || 0,
      };
    }
    case "LINE":
      stats.lines++;
      return lineItem(common, [e.startPoint, e.endPoint], false);
    case "LWPOLYLINE": {
      stats.lines++;
      const pts = e.vertices.map((v) =>
        ocs(e.extrusionDirection, { x: v.x, y: v.y, z: e.elevation || 0 }),
      );
      return lineItem(common, pts, (e.flag & 1) === 1);
    }
    case "POLYLINE2D": {
      stats.lines++;
      const pts = e.vertices.map((v) =>
        ocs(e.extrusionDirection, {
          x: v.x,
          y: v.y,
          z: e.elevation || v.z || 0,
        }),
      );
      return lineItem(common, pts, (e.flag & 1) === 1);
    }
    case "POLYLINE3D":
      stats.lines++;
      return lineItem(common, e.vertices, (e.flag & 1) === 1);
    case "CIRCLE":
    case "ARC": {
      stats.lines++;
      const a0 = e.type === "ARC" ? e.startAngle : 0;
      let a1 = e.type === "ARC" ? e.endAngle : Math.PI * 2;
      if (a1 <= a0) a1 += Math.PI * 2;
      const seg = Math.max(8, Math.ceil((a1 - a0) / (Math.PI / 24)));
      const pts = [];
      for (let i = 0; i <= seg; i++) {
        const a = a0 + (a1 - a0) * (i / seg);
        pts.push(
          ocs(e.extrusionDirection, {
            x: e.center.x + Math.cos(a) * e.radius,
            y: e.center.y + Math.sin(a) * e.radius,
            z: e.center.z,
          }),
        );
      }
      return lineItem(common, pts, false);
    }
    default:
      stats.skipped[e.type] = (stats.skipped[e.type] || 0) + 1;
      return null;
  }
}

function lineItem(common, pts, closed) {
  if (!pts || pts.length < 2) return null;
  const seq = closed ? [...pts, pts[0]] : pts;
  const out = new Float32Array((seq.length - 1) * 6);
  for (let i = 0; i < seq.length - 1; i++) {
    const a = seq[i],
      b = seq[i + 1];
    out.set([a.x, a.y, a.z ?? 0, b.x, b.y, b.z ?? 0], i * 6);
  }
  return { kind: "line", ...common, positions: out };
}

function mergeFaces(items) {
  const groups = new Map();
  const rest = [];
  for (const it of items) {
    if (it.kind !== "face") {
      rest.push(it);
      continue;
    }
    const key = `${it.layer}|${it.colorIndex}|${it.color}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  for (const list of groups.values()) {
    let len = 0;
    for (const it of list) len += it.positions.length;
    const positions = new Float32Array(len);
    let off = 0;
    for (const it of list) {
      positions.set(it.positions, off);
      off += it.positions.length;
    }
    rest.push({
      ...list[0],
      kind: "mesh",
      type: list[0].type,
      handle: list[0].handle,
      positions,
      count: list.length,
    });
  }
  return rest;
}

// ---------- geometria ----------

const same = (a, b) =>
  Math.abs(a.x - b.x) < 1e-9 &&
  Math.abs(a.y - b.y) < 1e-9 &&
  Math.abs((a.z ?? 0) - (b.z ?? 0)) < 1e-9;

function dedupe(poly) {
  const r = [];
  for (const p of poly) if (!r.length || !same(r[r.length - 1], p)) r.push(p);
  while (r.length > 1 && same(r[0], r[r.length - 1])) r.pop();
  return r;
}

function triangulate(polyIn, out) {
  const poly = dedupe(polyIn);
  const n = poly.length;
  if (n < 3) return;
  if (n === 3) {
    push(out, poly[0], poly[1], poly[2]);
    return;
  }
  // Normal de Newell para escolher o plano de projeção
  let nx = 0,
    ny = 0,
    nz = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i],
      b = poly[(i + 1) % n];
    nx += (a.y - b.y) * ((a.z ?? 0) + (b.z ?? 0));
    ny += ((a.z ?? 0) - (b.z ?? 0)) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  if (n === 4 && isConvex(poly, nx, ny, nz)) {
    push(out, poly[0], poly[1], poly[2]);
    push(out, poly[0], poly[2], poly[3]);
    return;
  }
  const ax = Math.abs(nx),
    ay = Math.abs(ny),
    az = Math.abs(nz);
  const proj =
    az >= ax && az >= ay
      ? (p) => new Vector2(p.x, p.y)
      : ax >= ay
        ? (p) => new Vector2(p.y, p.z ?? 0)
        : (p) => new Vector2(p.z ?? 0, p.x);
  const contour = poly.map(proj);
  const tris = ShapeUtils.triangulateShape(contour, []);
  for (const [a, b, c] of tris) push(out, poly[a], poly[b], poly[c]);
}

function isConvex(p, nx, ny, nz) {
  for (let i = 0; i < 4; i++) {
    const a = p[i],
      b = p[(i + 1) % 4],
      c = p[(i + 2) % 4];
    const ux = b.x - a.x,
      uy = b.y - a.y,
      uz = (b.z ?? 0) - (a.z ?? 0);
    const vx = c.x - b.x,
      vy = c.y - b.y,
      vz = (c.z ?? 0) - (b.z ?? 0);
    const cx = uy * vz - uz * vy,
      cy = uz * vx - ux * vz,
      cz = ux * vy - uy * vx;
    if (cx * nx + cy * ny + cz * nz < 0) return false;
  }
  return true;
}

function push(out, a, b, c) {
  out.push(a.x, a.y, a.z ?? 0, b.x, b.y, b.z ?? 0, c.x, c.y, c.z ?? 0);
}
