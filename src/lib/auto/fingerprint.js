// Impressão digital de uma peça: reconhece o mesmo objeto em outro projeto, em
// qualquer posição ou rotação. Duas chaves:
//  - exata: medidas (2 mm), número de triângulos e área da superfície (1%);
//    é a mesma peça de biblioteca (banqueta, spot, balcão padrão);
//  - forma: medidas (1 cm) e o nome, quando o projetista deu um nome de verdade;
//  - medida: só as medidas (1 cm), pista fraca.

// Hash curto e estável (cyrb53), em 13 caracteres hexadecimais
export function shortHash(text) {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0))
    .toString(16)
    .padStart(13, "0");
}

// Nomes automáticos (do SketchUp, do DWG ou do Detalha) não identificam a peça
const GENERIC =
  /^(?:(?:peca|malha|itens pequenos|conjunto|geometria solta|agrupar|grupo|group|componente|component|mesh|node|scene|geom3d|line|object|objeto|box|caixa|retangulo|rectangle|cylinder|circle|text)\b[\s#\d_.-]*|(?:3dsolid|solid|polyface|body|region|insert|3dface|mesh)\s*[0-9a-f]*)$/i;

/** Nome normalizado (sem acentos, minúsculo); vazio se for nome automático. */
export function nameKey(name) {
  const n = String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Também "Shape Bender Component#1", "Grupo207": nome automático no fim
  if (
    !n ||
    GENERIC.test(n) ||
    /(?:^|\s)(?:componente|component|agrupar|grupo|group)\s*\d*$/.test(n) ||
    // Nomes do 3ds Max e de primitivas: "Box193494", "Line001", "piso00501"
    /^(?:box|line|shape|object|cylinder|rectangle|circle|text|helix|plane|sphere|cone|torus|tube|loft|editable ?poly|editable ?mesh|piso|parede|painel)\s*[_#-]?\s*\d+(?:[\s_-]+\d+)*$/.test(
      n,
    ) ||
    // Código de biblioteca: "CENNO_M0001473_000"
    isLibraryCode(n)
  )
    return "";
  // Sufixos de cópia ("balcão 2", "testeira#3", "banqueta (1)") não mudam o objeto
  return n.replace(/(?:\s*\(\d+\)|\s+\d+)$/, "").trim();
}

/** Chaves da impressão digital a partir das medidas, da superfície e do nome. */
export function fingerprint({ dimensions, tris, area, name }) {
  const sorted = [...dimensions].sort((p, q) => p - q);
  const mm2 = sorted.map((v) => Math.round(v * 500)).join("x"); // passos de 2 mm
  const cm = sorted.map((v) => Math.round(v * 100)).join("x");
  // Área em passos de ~1% (escala logarítmica): a mesma peça exportada de novo bate
  const areaBucket = area > 0 ? Math.round(Math.log(area) * 100) : 0;
  const key = nameKey(name);
  return {
    exact: tris ? shortHash(`e|${mm2}|${tris}|${areaBucket}`) : null,
    shape: key ? shortHash(`s|${cm}|${key}`) : null,
    // Só as medidas: pista fraca (painéis do mesmo tamanho), vira sugestão a conferir
    size: shortHash(`d|${cm}`),
  };
}

/**
 * Código de item de biblioteca ("CENNO_M0001473_000", "MDD7010.dwg"): peça pronta de
 * catálogo. Nomes automáticos ("Box193494", "piso00501") não contam.
 */
export function isLibraryCode(name) {
  const n = String(name || "").toLowerCase();
  if (
    /^(?:box|line|shape|object|cylinder|rectangle|circle|text|helix|plane|sphere|cone|piso|parede|painel|peca|peça|mesh|solid|3dsolid|polyface)/.test(
      n,
    )
  )
    return false;
  return (
    /^[a-z]{2,}[_-][a-z]?\d{4,}(?:[_-]\d+)*$/.test(n) ||
    /^[a-z]{2,5}\d{4,}\.(?:dwg|skp|max)$/.test(n)
  );
}

// Contas que dependem só da geometria (área, triângulos, partes soltas) são feitas uma
// vez por geometria: componentes repetidos (frascos, trilhos, banquetas) reaproveitam.
const geometryCache = new WeakMap();
function geometryStats(geometry) {
  let s = geometryCache.get(geometry);
  if (s) return s;
  const pos = geometry.attributes?.position;
  s = { tris: 0, area: 0, parts: 0 };
  if (!pos) return s;
  const index = geometry.index;
  const count = index ? index.count : pos.count;
  const at = (i) => (index ? index.getX(i) : i);
  // Partes soltas: vértices soldados (0,5 mm, na unidade do arquivo) ligados pelos triângulos
  const ids = new Map(),
    parent = [];
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const vertex = (k) => {
    const x = Math.round(pos.getX(k) / 5e-4),
      y = Math.round(pos.getY(k) / 5e-4),
      z = Math.round(pos.getZ(k) / 5e-4);
    const key = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
    let bucket = ids.get(key);
    if (!bucket) ids.set(key, (bucket = []));
    for (const [bx, by, bz, id] of bucket)
      if (bx === x && by === y && bz === z) return id;
    const id = parent.length;
    parent.push(id);
    bucket.push([x, y, z, id]);
    return id;
  };
  for (let i = 0; i + 2 < count; i += 3) {
    const a = at(i),
      b = at(i + 1),
      c = at(i + 2);
    const ux = pos.getX(b) - pos.getX(a),
      uy = pos.getY(b) - pos.getY(a),
      uz = pos.getZ(b) - pos.getZ(a);
    const vx = pos.getX(c) - pos.getX(a),
      vy = pos.getY(c) - pos.getY(a),
      vz = pos.getZ(c) - pos.getZ(a);
    s.area +=
      Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    s.tris++;
    const ra = find(vertex(a)),
      rb = find(vertex(b)),
      rc = find(vertex(c));
    parent[rb] = ra;
    parent[find(rc)] = ra;
  }
  const roots = new Set();
  for (let i = 0; i < parent.length; i++) roots.add(find(i));
  s.parts = roots.size;
  geometryCache.set(geometry, s);
  return s;
}

// Escala da malha no mundo (uniforme na prática: componentes giram e mudam de lugar)
function meshScale(mesh) {
  const e = mesh.matrixWorld.elements;
  const sx = Math.hypot(e[0], e[1], e[2]),
    sy = Math.hypot(e[4], e[5], e[6]),
    sz = Math.hypot(e[8], e[9], e[10]);
  return {
    s: (sx + sy + sz) / 3,
    uniform: Math.abs(sx - sy) + Math.abs(sy - sz) < 1e-6 * sx,
  };
}

/**
 * Medidas da geometria de uma peça (no mundo, metros): triângulos e área.
 * `meshes` são malhas three.js já com matrixWorld atualizada; `scale` converte a
 * unidade do modelo para metros.
 */
export function surfaceStats(meshes, scale = 1) {
  let tris = 0,
    area = 0;
  for (const mesh of meshes) {
    if (!mesh.geometry?.attributes?.position) continue;
    const g = geometryStats(mesh.geometry);
    const { s, uniform } = meshScale(mesh);
    tris += g.tris;
    // Escala não uniforme (rara): a área fica aproximada pela média dos eixos
    area += g.area * (uniform ? s * s : s * s) * scale * scale;
  }
  return { tris, area };
}

/**
 * Leitura da forma (para saber o que a peça é, não só quanto mede), no referencial
 * da própria peça (largura, altura, profundidade):
 *  - parts: quantas partes soltas (letras de um logo, ícones de uma arte, ripas);
 *  - main: quanto da face principal está preenchido (chapa ~1; letras e ícones, pouco);
 *  - front: preenchimento visto de frente/lado (balcão fechado ~1; mesa sobre pés, pouco);
 *  - top: preenchimento visto de cima;
 *  - trisPerPart: faces por parte (letra curva tem centenas; ripa reta, 12).
 * O preenchimento usa no máximo ~8 mil triângulos por peça (amostra uniforme).
 */
const shapeCache = new Map();
export function shapeStats(meshes, scale, frame, dims) {
  // Cópias da mesma peça (mesma geometria na mesma posição relativa) dão a mesma leitura
  const [fx, fy, fz] = frame.axes;
  const rel = (mesh) => {
    const e = mesh.matrixWorld.elements;
    const r = (v) => Math.round(v * 1e3);
    // Eixos da malha no referencial da peça (posição relativa ao canto da peça)
    const col = (c) => [e[c], e[c + 1], e[c + 2]];
    const t = [
      e[12] * scale - frame.origin[0],
      e[13] * scale - frame.origin[1],
      e[14] * scale - frame.origin[2],
    ];
    return [col(0), col(4), col(8), t]
      .map((v) =>
        [fx, fy, fz]
          .map((a) => r(a[0] * v[0] + a[1] * v[1] + a[2] * v[2]))
          .join(","),
      )
      .join(";");
  };
  const key =
    meshes.map((m) => `${m.geometry?.uuid}@${rel(m)}`).join("|") +
    `#${dims.map((v) => Math.round(v * 1e4)).join(",")}`;
  const hit = shapeCache.get(key);
  if (hit) return { ...hit };
  if (shapeCache.size > 5000) shapeCache.clear();
  const result = computeShape(meshes, scale, frame, dims);
  shapeCache.set(key, result);
  return { ...result };
}

function computeShape(meshes, scale, frame, dims) {
  const N = 40;
  const grids = [
    new Uint8Array(N * N),
    new Uint8Array(N * N),
    new Uint8Array(N * N),
  ]; // xy, zy, xz
  const [ax, ay, az] = frame.axes,
    o = frame.origin;
  const ext = dims.map((v) => (v > 1e-6 ? v : 0));
  let total = 0,
    parts = 0;
  for (const mesh of meshes) {
    if (!mesh.geometry?.attributes?.position) continue;
    const g = geometryStats(mesh.geometry);
    total += g.tris;
    parts += g.parts;
  }
  const stride = Math.max(1, Math.ceil(total / 8000));
  const cell = (v, k) =>
    ext[k] ? Math.min(N - 1, Math.max(0, (v / ext[k]) * N)) : 0;
  const raster = (grid, p, q, r, a, b) => {
    if (!ext[a] || !ext[b]) return;
    const P = [cell(p[a], a), cell(p[b], b)],
      Q = [cell(q[a], a), cell(q[b], b)],
      R = [cell(r[a], a), cell(r[b], b)];
    const area = (Q[0] - P[0]) * (R[1] - P[1]) - (Q[1] - P[1]) * (R[0] - P[0]);
    if (Math.abs(area) < 1e-9) return; // face vista de lado: não cobre nada
    const s = area > 0 ? 1 : -1;
    const i0 = Math.floor(Math.min(P[0], Q[0], R[0])),
      i1 = Math.min(N - 1, Math.floor(Math.max(P[0], Q[0], R[0]))),
      j0 = Math.floor(Math.min(P[1], Q[1], R[1])),
      j1 = Math.min(N - 1, Math.floor(Math.max(P[1], Q[1], R[1])));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = i + 0.5,
          y = j + 0.5;
        const w0 = s * ((Q[0] - x) * (R[1] - y) - (Q[1] - y) * (R[0] - x)),
          w1 = s * ((R[0] - x) * (P[1] - y) - (R[1] - y) * (P[0] - x)),
          w2 = s * ((P[0] - x) * (Q[1] - y) - (P[1] - y) * (Q[0] - x));
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) grid[j * N + i] = 1;
      }
  };
  let seen = 0;
  for (const mesh of meshes) {
    const pos = mesh.geometry?.attributes?.position;
    if (!pos) continue;
    const index = mesh.geometry.index;
    const count = index ? index.count : pos.count;
    const e = mesh.matrixWorld.elements;
    const local = (i) => {
      const k = index ? index.getX(i) : i;
      const x = pos.getX(k),
        y = pos.getY(k),
        z = pos.getZ(k);
      const wx = (e[0] * x + e[4] * y + e[8] * z + e[12]) * scale - o[0],
        wy = (e[1] * x + e[5] * y + e[9] * z + e[13]) * scale - o[1],
        wz = (e[2] * x + e[6] * y + e[10] * z + e[14]) * scale - o[2];
      return [
        ax[0] * wx + ax[1] * wy + ax[2] * wz,
        ay[0] * wx + ay[1] * wy + ay[2] * wz,
        az[0] * wx + az[1] * wy + az[2] * wz,
      ];
    };
    for (let i = 0; i + 2 < count; i += 3) {
      if (seen++ % stride) continue;
      const p = local(i),
        q = local(i + 1),
        r = local(i + 2);
      raster(grids[0], p, q, r, 0, 1);
      raster(grids[1], p, q, r, 2, 1);
      raster(grids[2], p, q, r, 0, 2);
    }
  }
  const fill = (g) => g.reduce((s, v) => s + v, 0) / (N * N);
  const [xy, zy, xz] = grids.map(fill);
  // Face principal: o plano das duas maiores medidas
  const smallest = dims.indexOf(Math.min(...dims));
  const main = smallest === 2 ? xy : smallest === 0 ? zy : xz;
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    parts: Math.max(parts, 1),
    main: r2(main),
    front: r2(Math.max(xy, zy)),
    top: r2(xz),
    trisPerPart: Math.round(total / Math.max(parts, 1)),
  };
}
