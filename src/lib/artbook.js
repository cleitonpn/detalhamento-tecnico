// Caderno de arte (comunicação visual): a partir de paredes escolhidas no modelo,
// gera o mapa de instalação (A, B, C…) e um gabarito A4 por arte, com sangria,
// área de segurança e áreas de interferência. Conceito e layout vêm do Arte Guide;
// medidas e interferências saem do modelo 3D.
import { buildOverview, drawSheetPdf } from "./sheet.js";
import { overviewImage } from "./hlr.js";
import { partAnalysis } from "./drawings.js";
import { fmtLen, partTriangles } from "./techdraw.js";
import { importNotice } from "./importDiagnostics.js";
import { createSpatialIndex } from "./context/spatial.js";
import { zoneKind, zoneStyle } from "./artZones.js";
import { artEligibility } from "./artEligibility.js";
import { semanticRoleOf } from "../domain/project.js";

const PAGE = { w: 297, h: 210 };
const M = 8;
const SIDE_W = 84;
const INK = "#173b48",
  SOFT = "#7c8794",
  MARKER = "#ea580c",
  CUT = "#dc2626",
  BLEED = "#9932cc",
  GUIDE = "#2563eb";

/** Rótulos de marcador como no Arte Guide: A, B … Z, AA, AB … */
export function markerLabel(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const round1 = (v) => Math.round(v * 10) / 10;

// Referencial da parede: x = largura, y = altura (vertical), z = profundidade
function frameOf(part) {
  const origin = part.frame?.origin || part.bounds.min;
  const axes = part.frame?.axes || [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  return (p) =>
    axes.map(
      (ax) =>
        ax[0] * (p[0] - origin[0]) +
        ax[1] * (p[1] - origin[1]) +
        ax[2] * (p[2] - origin[2]),
    );
}

/**
 * Faces planas verticais da peça, maiores primeiro. Uma parede reta tem frente e verso;
 * uma parede em L ou em U, uma face por trecho. Cada face traz o plano (normal e
 * distância) e o retângulo que ocupa, no referencial da peça, em metros.
 */
export function wallFaces(triangles, { minArea = 0.2, max = 8 } = {}) {
  const groups = new Map();
  for (let t = 0; t + 8 < triangles.length; t += 9) {
    const p = [0, 3, 6].map((o) => [
      triangles[t + o],
      triangles[t + o + 1],
      triangles[t + o + 2],
    ]);
    const u = p[1].map((v, i) => v - p[0][i]),
      w = p[2].map((v, i) => v - p[0][i]);
    const n = [
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ];
    const len = Math.hypot(...n);
    if (len < 1e-12) continue;
    n.forEach((_, i) => (n[i] /= len));
    if (Math.abs(n[1]) > 0.2) continue; // só faces verticais recebem arte
    const h = Math.hypot(n[0], n[2]);
    // A ordem dos vértices não é confiável (o leitor de sólidos não orienta os triângulos):
    // usa uma normal canônica e decide o lado de fora depois, pela espessura da parede.
    let nx = n[0] / h,
      nz = n[2] / h;
    if (nx < -1e-6 || (Math.abs(nx) <= 1e-6 && nz < 0)) {
      nx = -nx;
      nz = -nz;
    }
    const d = nx * p[0][0] + nz * p[0][2];
    const key = `${Math.round(nx * 40)}|${Math.round(nz * 40)}|${Math.round(d * 50)}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        nx,
        nz,
        d,
        area: 0,
        u0: Infinity,
        u1: -Infinity,
        y0: Infinity,
        y1: -Infinity,
        tris: [],
      };
      groups.set(key, g);
    }
    g.area += len / 2;
    // Eixo horizontal ao longo da face
    for (const q of p) {
      const along = -nz * q[0] + nx * q[2];
      g.tris.push(along, q[1]);
      g.u0 = Math.min(g.u0, along);
      g.u1 = Math.max(g.u1, along);
      g.y0 = Math.min(g.y0, q[1]);
      g.y1 = Math.max(g.y1, q[1]);
    }
  }
  // Lado de fora: o oposto ao da face paralela mais próxima (o outro lado da parede).
  // Sem face parceira (chapa única), fica a normal canônica.
  const all = [...groups.values()];
  for (const g of all) {
    let best = null;
    for (const p of all) {
      if (
        p === g ||
        Math.abs(p.nx - g.nx) > 0.05 ||
        Math.abs(p.nz - g.nz) > 0.05
      )
        continue;
      const gap = Math.abs(p.d - g.d);
      const overlapU = Math.min(g.u1, p.u1) - Math.max(g.u0, p.u0);
      const overlapY = Math.min(g.y1, p.y1) - Math.max(g.y0, p.y0);
      if (gap < 0.003 || gap > 0.6 || overlapU <= 0.1 || overlapY <= 0.1)
        continue;
      if (!best || gap < Math.abs(best.d - g.d)) best = p;
    }
    if (best && best.d > g.d) {
      // O material está do lado +n: a face olha para −n
      g.nx = -g.nx;
      g.nz = -g.nz;
      g.d = -g.d;
      [g.u0, g.u1] = [-g.u1, -g.u0];
      for (let i = 0; i < g.tris.length; i += 2) g.tris[i] = -g.tris[i];
    }
  }
  return (
    all
      // Bordas e cantos estreitos (espessura da parede) não recebem arte
      .filter(
        (g) => g.area >= minArea && g.u1 - g.u0 >= 0.15 && g.y1 - g.y0 >= 0.15,
      )
      .sort((p, q) => q.area - p.area)
      .slice(0, max)
      .map(({ tris, ...g }, i) => ({
        ...g,
        index: i,
        w: g.u1 - g.u0,
        h: g.y1 - g.y0,
        outline: faceOutline(tris, g),
      }))
  );
}

// ---------- contorno da face ----------

const PAD = 2; // células vazias em volta da face na grade

// Grade da face: célula em metros e conversão para o referencial da arte
// (x da esquerda para a direita de quem olha, y de cima para baixo)
function faceGrid(face) {
  const W = face.u1 - face.u0,
    H = face.y1 - face.y0;
  const cell = Math.max(Math.max(W, H) / 240, 0.004);
  return {
    cell,
    nx: Math.ceil(W / cell) + 2 * PAD,
    ny: Math.ceil(H / cell) + 2 * PAD,
    W,
    H,
  };
}

// Pinta na grade as células cujo centro cai no triângulo (coordenadas da arte, metros)
function fillTriangle(grid, mask, ax, ay, bx, by, cx, cy, onCell) {
  const { cell, nx, ny } = grid;
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-12) return;
  const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) / cell) + PAD),
    i1 = Math.min(nx - 1, Math.floor(Math.max(ax, bx, cx) / cell) + PAD),
    j0 = Math.max(0, Math.floor(Math.min(ay, by, cy) / cell) + PAD),
    j1 = Math.min(ny - 1, Math.floor(Math.max(ay, by, cy) / cell) + PAD);
  const sg = area > 0 ? 1 : -1,
    tol = -1e-9 * Math.abs(area);
  for (let j = j0; j <= j1; j++) {
    const py = (j - PAD + 0.5) * cell;
    for (let i = i0; i <= i1; i++) {
      const px = (i - PAD + 0.5) * cell;
      const w0 = sg * ((bx - px) * (cy - py) - (by - py) * (cx - px)),
        w1 = sg * ((cx - px) * (ay - py) - (cy - py) * (ax - px)),
        w2 = sg * ((ax - px) * (by - py) - (ay - py) * (bx - px));
      if (w0 >= tol && w1 >= tol && w2 >= tol) {
        if (onCell) onCell(i, j);
        else mask[j * nx + i] = 1;
      }
    }
  }
}

// Fechamento morfológico (dilata e erode uma célula): fecha frestas entre triângulos
function closeMask(mask, nx, ny) {
  const step = (src, keep) => {
    const out = new Uint8Array(src.length);
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        const n = [k, k - 1, k + 1, k - nx, k + nx].map((q) => src[q]);
        out[k] = keep ? (n.every(Boolean) ? 1 : 0) : n.some(Boolean) ? 1 : 0;
      }
    return out;
  };
  return step(step(mask, false), true);
}

// Bordas entre células cheias e vazias, encadeadas em anéis fechados (cantos da grade)
function traceRings(mask, nx, ny) {
  const next = new Map();
  const at = (i, j) =>
    i >= 0 && j >= 0 && i < nx && j < ny ? mask[j * nx + i] : 0;
  const add = (a, b) => {
    const k = a.join(",");
    if (!next.has(k)) next.set(k, []);
    next.get(k).push(b);
  };
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (!at(i, j)) continue;
      if (!at(i, j - 1)) add([i, j], [i + 1, j]);
      if (!at(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
      if (!at(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
      if (!at(i - 1, j)) add([i, j + 1], [i, j]);
    }
  const rings = [];
  for (const [start, outs] of next) {
    while (outs.length) {
      const ring = [start.split(",").map(Number)];
      let cur = outs.pop();
      while (cur && cur.join(",") !== start) {
        ring.push(cur);
        cur = next.get(cur.join(","))?.pop();
      }
      if (ring.length >= 4) rings.push(ring);
    }
  }
  return rings;
}

const ringArea = (r) =>
  r.reduce((s, p, i) => {
    const q = r[(i + 1) % r.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;

// Douglas–Peucker num trecho aberto
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-12;
  let worst = 0,
    at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d =
      Math.abs(
        (b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1]),
      ) / len;
    if (d > worst) [worst, at] = [d, i];
  }
  if (worst <= tol) return [a, b];
  return [
    ...simplify(pts.slice(0, at + 1), tol).slice(0, -1),
    ...simplify(pts.slice(at), tol),
  ];
}

function simplifyRing(ring, tol) {
  // Corta o anel no ponto mais distante do primeiro e simplifica as duas metades
  let far = 0,
    fd = -1;
  ring.forEach((p, i) => {
    const d = Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]);
    if (d > fd) [fd, far] = [d, i];
  });
  const out = [
    ...simplify(ring.slice(0, far + 1), tol).slice(0, -1),
    ...simplify([...ring.slice(far), ring[0]], tol).slice(0, -1),
  ];
  return out;
}

// Remove vértices repetidos e alinhados
function tidyRing(ring, tol) {
  let r = ring;
  for (let changed = true; changed && r.length > 3;) {
    changed = false;
    for (let i = 0; i < r.length && r.length > 3; i++) {
      const a = r[(i + r.length - 1) % r.length],
        p = r[i],
        b = r[(i + 1) % r.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const d =
        len < 1e-9
          ? Math.hypot(p[0] - a[0], p[1] - a[1])
          : Math.abs(
              (b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1]),
            ) / len;
      if (d <= tol || Math.hypot(p[0] - a[0], p[1] - a[1]) <= tol) {
        r = r.filter((_, k) => k !== i);
        changed = true;
      }
    }
  }
  return r;
}

/**
 * Contorno real da face (testeira sextavada, painel com recorte, vão de porta…),
 * em metros no referencial da arte: anéis de [x, y], o primeiro é o maior.
 * Devolve null quando a face é o próprio retângulo.
 */
export function faceOutline(tris, face) {
  if (!tris?.length) return null;
  const grid = faceGrid(face);
  const { cell, nx, ny, W, H } = grid;
  let mask = new Uint8Array(nx * ny);
  const verts = [];
  for (let t = 0; t + 5 < tris.length; t += 6) {
    const v = [0, 2, 4].map((o) => [
      face.u1 - tris[t + o],
      face.y1 - tris[t + o + 1],
    ]);
    verts.push(...v);
    fillTriangle(grid, mask, ...v[0], ...v[1], ...v[2]);
  }
  mask = closeMask(mask, nx, ny);
  const full = mask.reduce((s, v) => s + v, 0) * cell * cell;
  if (full >= 0.985 * W * H) return null;
  // Vértices reais da malha, para o contorno cair nas medidas exatas
  const snap = (p) => {
    let best = null,
      bd = 3 * cell;
    for (const v of verts) {
      const d = Math.hypot(v[0] - p[0], v[1] - p[1]);
      if (d < bd) [bd, best] = [d, v];
    }
    const q = best || p;
    return [Math.min(W, Math.max(0, q[0])), Math.min(H, Math.max(0, q[1]))];
  };
  const rings = traceRings(mask, nx, ny)
    .map((r) => r.map(([i, j]) => [(i - PAD) * cell, (j - PAD) * cell]))
    .filter((r) => Math.abs(ringArea(r)) >= 0.01 * W * H)
    .map((r) => tidyRing(simplifyRing(r, 1.5 * cell).map(snap), cell * 0.25))
    .filter((r) => r.length >= 3)
    .sort((p, q) => Math.abs(ringArea(q)) - Math.abs(ringArea(p)));
  if (!rings.length) return null;
  const round = (v) => Math.round(v * 10000) / 10000;
  return rings.map((r) => r.map(([x, y]) => [round(x), round(y)]));
}

// Ponto dentro do contorno (regra par-ímpar: anéis internos são vãos)
function insideRings(rings, x, y) {
  let inside = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i],
        [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
  return inside;
}

/** Área do contorno em m² (vãos descontados); sem contorno, o retângulo. */
export function outlineArea(rings) {
  if (!rings?.length) return null;
  // Anéis externos giram num sentido (área positiva) e vãos no outro
  return rings.reduce((s, r) => s + ringArea(r), 0);
}

/** Descrição curta da face para o seletor: tamanho e para onde ela olha na peça. */

/** Centro do stand (todas as peças) no referencial da parede. */
function standCenter(wall, parts) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p.bounds.min[k]);
      max[k] = Math.max(max[k], p.bounds.max[k]);
    }
  return frameOf(wall)(min.map((v, k) => (v + max[k]) / 2));
}

/** Marca cada face como interna (olha para o centro do stand) ou externa. */
export function markInward(faces, wall, parts) {
  const c = standCenter(wall, parts);
  return faces.map((f) => ({
    ...f,
    inward: f.nx * c[0] + f.nz * c[2] - f.d > 0.05,
  }));
}

/**
 * Face padrão para a arte: a maior face interna (a comunicação visual costuma ir
 * do lado de dentro das paredes). Sem face interna, a maior de todas.
 */
export function defaultFace(faces, wall, parts, options = {}) {
  if (!faces.length) return -1;
  const marked =
    faces[0].inward === undefined ? markInward(faces, wall, parts) : faces;
  // Face encostada em outra peça (testeira presa por fora da parede, painel colado
  // na estrutura) não é a face vista: perde para uma face livre.
  const blocked = marked.map((f) => {
    const zones = autoZones({ face: pickFace(f) }, wall, parts, options);
    const covered = zones.reduce((s, z) => s + z.w * z.h, 0) / 10000;
    return covered > 0.25 * (outlineArea(f.outline) ?? f.w * f.h) ? 1 : 0;
  });
  const order = marked
    .map((_, i) => i)
    .sort(
      (a, b) =>
        blocked[a] - blocked[b] ||
        Number(!!marked[b].inward) - Number(!!marked[a].inward) ||
        a - b,
    );
  return order[0];
}

/** Descrição curta da face para o seletor: tamanho e se é o lado interno ou externo do stand. */
export function faceLabel(face, i) {
  const side =
    face.inward === undefined
      ? ""
      : face.inward
        ? " (lado interno)"
        : " (lado externo)";
  return `Face ${i + 1} · ${fmtLen(face.w)} × ${fmtLen(face.h)} cm${side}`;
}

/** Faces de uma peça do projeto (usa a geometria já carregada), marcadas interna/externa. */
/** Triângulos da peça no referencial do mundo (metros), para medir interferências. */
export function worldTriangles(part, meshMap, sourceUnit) {
  const t = partTriangles(part, meshMap, sourceUnit);
  const o = part.frame?.origin || part.bounds.min;
  const ax = part.frame?.axes || [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const out = new Float32Array(t.length);
  for (let i = 0; i < t.length; i += 3)
    for (let k = 0; k < 3; k++)
      out[i + k] =
        o[k] + t[i] * ax[0][k] + t[i + 1] * ax[1][k] + t[i + 2] * ax[2][k];
  return out;
}

export function partFaces(part, meshMap, sourceUnit, parts = []) {
  const faces = wallFaces(partTriangles(part, meshMap, sourceUnit));
  return parts.length ? markInward(faces, part, parts) : faces;
}

/** Nova arte a partir de uma face da peça (a maior, por padrão), em cm. */
export function newArt(part, index, face = null, faceName = "") {
  const [w, h] = face ? [face.w, face.h] : part.dimensions;
  return {
    id: `${part.id}-${Date.now().toString(36)}`,
    partId: part.id,
    marker: markerLabel(index),
    title: "ADESIVO IMPRESSO",
    face: face ? pickFace(face) : null,
    faceName,
    w: round1(w * 100),
    h: round1(h * 100),
    bleed: 3,
    safeW: 0,
    safeH: 0,
    zones: [],
    notes: "",
  };
}

// Só o necessário da face é guardado com a arte
const pickFace = (f) => ({
  key: f.key,
  nx: f.nx,
  nz: f.nz,
  d: f.d,
  u0: f.u0,
  u1: f.u1,
  y0: f.y0,
  y1: f.y1,
  w: f.w,
  h: f.h,
  outline: f.outline || null,
});

/**
 * Interferências automáticas: peças à frente da face escolhida (TV, prateleira,
 * balcão…) viram obstruções visuais, em cm, com origem no canto superior esquerdo da
 * arte, como quem olha para a face. Com `trianglesOf` (peça → triângulos no mundo)
 * mede a geometria real dentro do contorno da face; sem ela, a caixa envolvente.
 * Não contam: revestimento fino que cobre boa parte da face (painel, chapa),
 * superfície sem espessura (imagem, adesivo) e recorte fino vazado (logo, letras).
 */
export function autoZones(
  art,
  wall,
  parts,
  { reach = 0.5, minDepth = 0.03, trianglesOf, spatialIndex } = {},
) {
  const face = art.face;
  // Artes antigas guardavam a face como texto ("front"/"back"): sem plano, só áreas manuais
  if (!face || typeof face !== "object") return [];
  const local = frameOf(wall);
  const W = face.w,
    H = face.h;
  const faceArea = outlineArea(face.outline) ?? W * H;
  const grid = faceGrid(face);
  let inFace = null; // células dentro do contorno, calculadas na primeira necessidade
  const zones = [];
  const index = spatialIndex || createSpatialIndex(parts);
  for (const q of index.query(wall.bounds, reach)) {
    if (q.id === wall.id || artEligibility(q).blocked ||
      (q.review?.kind === "ignore" && !["furniture", "vegetation"].includes(semanticRoleOf(q)))) continue;
    const pts = [];
    for (let i = 0; i < 8; i++)
      pts.push(
        local(
          [0, 1, 2].map((k) =>
            (i >> k) & 1 ? q.bounds.max[k] : q.bounds.min[k],
          ),
        ),
      );
    // Distância à frente da face, posição ao longo dela e altura
    const dist = pts.map((p) => face.nx * p[0] + face.nz * p[2] - face.d);
    const along = pts.map((p) => -face.nz * p[0] + face.nx * p[2]);
    const ys = pts.map((p) => p[1]);
    const near = Math.min(...dist),
      far = Math.max(...dist);
    if (near < -0.02 || near > reach) continue;
    const a0 = Math.max(face.u0, Math.min(...along)),
      a1 = Math.min(face.u1, Math.max(...along));
    const y0 = Math.max(face.y0, Math.min(...ys)),
      y1 = Math.min(face.y1, Math.max(...ys));
    if (a1 - a0 < 0.02 || y1 - y0 < 0.02) continue;
    // Retângulo na arte (metros, quem olha vê "along" da direita para a esquerda),
    // profundidade e quanto do retângulo a peça ocupa de fato
    let hit = {
      x0: face.u1 - a1,
      x1: face.u1 - a0,
      y0: face.y1 - y1,
      y1: face.y1 - y0,
      depth: Math.min(far, reach) - near,
      fill: 1,
    };
    hit.area = (hit.x1 - hit.x0) * (hit.y1 - hit.y0);
    if (trianglesOf || face.outline) {
      inFace ||= faceCells(face, grid);
      hit = coverage(q, trianglesOf, { face, grid, inFace, local, reach }, hit);
      if (!hit) continue;
    }
    const zw = hit.x1 - hit.x0,
      zh = hit.y1 - hit.y0;
    if (zw < 0.02 || zh < 0.02) continue;
    if (hit.area > 0.9 * faceArea) continue; // outra parede ou o piso
    if (hit.depth < 0.005) continue; // sem espessura: imagem ou adesivo aplicado
    const thin = hit.depth < minDepth;
    if (thin && hit.fill < 0.6) continue; // logo ou letras recortadas
    const covers = zw >= 0.9 * W || zh >= 0.9 * H || hit.area > 0.25 * faceArea;
    if (thin && covers) continue;
    zones.push({
      id: `auto-${q.id}`,
      auto: true,
      kind: "obstruction",
      evidence: hit.geometry ? "geometry-projection" : "bounds-projection",
      sourceIds: [q.id],
      label: q.label,
      x: round1(hit.x0 * 100),
      y: round1(hit.y0 * 100),
      w: round1(zw * 100),
      h: round1(zh * 100),
    });
  }
  return mergeZones(zones);
}

// Células da grade cujo centro cai na face (dentro do contorno, quando há)
function faceCells(face, grid) {
  const { cell, nx, ny, W, H } = grid;
  const out = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = (i - PAD + 0.5) * cell,
        y = (j - PAD + 0.5) * cell;
      if (x < 0 || y < 0 || x > W || y > H) continue;
      if (!face.outline || insideRings(face.outline, x, y)) out[j * nx + i] = 1;
    }
  return out;
}

// Recorta um polígono de pontos [dist, along, y] pela faixa lo ≤ dist ≤ hi
function clipSlab(poly, lo, hi) {
  const cut = (pts, keep, at) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i],
        q = pts[(i + 1) % pts.length];
      const kp = keep(p[0]),
        kq = keep(q[0]);
      if (kp) out.push(p);
      if (kp !== kq) {
        const t = (at - p[0]) / (q[0] - p[0]);
        out.push(p.map((v, k) => v + t * (q[k] - v)));
      }
    }
    return out;
  };
  const a = cut(poly, (d) => d >= lo, lo);
  return a.length < 3 ? [] : cut(a, (d) => d <= hi, hi);
}

/**
 * Parte da peça que fica de fato diante da face: triângulos recortados pela faixa à
 * frente dela e projetados na grade, só dentro do contorno. Sem triângulos, usa o
 * retângulo da caixa envolvente, também limitado ao contorno.
 */
function coverage(q, trianglesOf, { face, grid, inFace, local, reach }, box) {
  const { cell, nx } = grid;
  const hit = new Uint8Array(inFace.length);
  let dmin = Infinity,
    dmax = -Infinity;
  // Extremos exatos da geometria projetada (a grade só dá a medida ao centímetro)
  const ex = [Infinity, -Infinity, Infinity, -Infinity];
  const mark = (i, j) => {
    const k = j * nx + i;
    if (inFace[k]) hit[k] = 1;
  };
  const tris = trianglesOf?.(q);
  if (tris?.length) {
    for (let t = 0; t + 8 < tris.length; t += 9) {
      const poly = [0, 3, 6].map((o) => {
        const p = local([tris[t + o], tris[t + o + 1], tris[t + o + 2]]);
        return [
          face.nx * p[0] + face.nz * p[2] - face.d,
          -face.nz * p[0] + face.nx * p[2],
          p[1],
        ];
      });
      const c = clipSlab(poly, -0.02, reach);
      if (c.length < 3) continue;
      const xy = c.map(([d, a, y]) => {
        dmin = Math.min(dmin, d);
        dmax = Math.max(dmax, d);
        const p = [face.u1 - a, face.y1 - y];
        ex[0] = Math.min(ex[0], p[0]);
        ex[1] = Math.max(ex[1], p[0]);
        ex[2] = Math.min(ex[2], p[1]);
        ex[3] = Math.max(ex[3], p[1]);
        return p;
      });
      for (let k = 1; k + 1 < xy.length; k++)
        fillTriangle(grid, null, ...xy[0], ...xy[k], ...xy[k + 1], mark);
    }
  } else {
    const { x0, x1, y0, y1 } = box;
    fillTriangle(grid, null, x0, y0, x1, y0, x1, y1, mark);
    fillTriangle(grid, null, x0, y0, x1, y1, x0, y1, mark);
    dmin = 0;
    dmax = box.depth;
    ex.splice(0, 4, x0, x1, y0, y1);
  }
  let n = 0,
    i0 = Infinity,
    i1 = -Infinity,
    j0 = Infinity,
    j1 = -Infinity;
  for (let k = 0; k < hit.length; k++) {
    if (!hit[k]) continue;
    n++;
    const i = k % nx,
      j = (k - i) / nx;
    i0 = Math.min(i0, i);
    i1 = Math.max(i1, i);
    j0 = Math.min(j0, j);
    j1 = Math.max(j1, j);
  }
  if (!n) return null;
  const clampX = (v) => Math.min(face.w, Math.max(0, v)),
    clampY = (v) => Math.min(face.h, Math.max(0, v));
  // Medida exata da peça, limitada ao trecho que a grade achou dentro da face
  return {
    geometry: !!tris?.length,
    x0: clampX(Math.max(ex[0], (i0 - PAD - 1) * cell)),
    x1: clampX(Math.min(ex[1], (i1 - PAD + 2) * cell)),
    y0: clampY(Math.max(ex[2], (j0 - PAD - 1) * cell)),
    y1: clampY(Math.min(ex[3], (j1 - PAD + 2) * cell)),
    depth: dmax - dmin,
    fill: n / ((i1 - i0 + 1) * (j1 - j0 + 1)),
    area: n * cell * cell,
  };
}

/**
 * Junta áreas quase coincidentes (camadas do mesmo objeto empilhadas no modelo):
 * se a interseção cobre 70% da menor, vira uma área só, com a união das duas.
 */
export function mergeZones(zones) {
  const out = [];
  for (const z of [...zones].sort((a, b) => b.w * b.h - a.w * a.h)) {
    const twin = out.find((o) => {
      if (zoneKind(o) !== zoneKind(z)) return false;
      const iw = Math.min(o.x + o.w, z.x + z.w) - Math.max(o.x, z.x);
      const ih = Math.min(o.y + o.h, z.y + z.h) - Math.max(o.y, z.y);
      return (
        iw > 0 && ih > 0 && iw * ih >= 0.7 * Math.min(o.w * o.h, z.w * z.h)
      );
    });
    if (!twin) {
      out.push({ ...z });
      continue;
    }
    const x1 = Math.max(twin.x + twin.w, z.x + z.w),
      y1 = Math.max(twin.y + twin.h, z.y + z.h);
    twin.x = Math.min(twin.x, z.x);
    twin.y = Math.min(twin.y, z.y);
    twin.w = round1(x1 - twin.x);
    twin.h = round1(y1 - twin.y);
    twin.merged = (twin.merged || 1) + 1;
    twin.sourceIds = [...new Set([...(twin.sourceIds || [twin.id]), ...(z.sourceIds || [z.id])])];
  }
  return out
    .map((z) =>
      z.merged ? { ...z, label: `${z.label} (+${z.merged - 1})` } : z,
    )
    .sort((a, b) => a.x - b.x || a.y - b.y);
}

/** Contorno da arte em cm (escala junto se o tamanho for editado); null = retângulo. */
export function artOutline(art) {
  const f = art.face;
  if (!f?.outline?.length || !(f.w > 0) || !(f.h > 0)) return null;
  const sx = art.w / f.w,
    sy = art.h / f.h;
  return f.outline.map((r) => r.map(([x, y]) => [x * sx, y * sy]));
}

export const artArea = (art) => {
  const rings = artOutline(art);
  return (rings ? outlineArea(rings) : art.w * art.h) / 10000;
};

// Anel deslocado para fora do material (vãos encolhem), com cantos em meia-esquadria
function offsetRing(ring, dist) {
  const n = ring.length;
  const normal = (a, b) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      len = Math.hypot(dx, dy) || 1;
    return [dy / len, -dx / len];
  };
  return ring.map((p, i) => {
    const n1 = normal(ring[(i + n - 1) % n], p),
      n2 = normal(p, ring[(i + 1) % n]);
    const den = Math.max(0.25, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [
      p[0] + ((n1[0] + n2[0]) * dist) / den,
      p[1] + ((n1[1] + n2[1]) * dist) / den,
    ];
  });
}

// Trechos de um segmento que ficam dentro dos anéis (regra par-ímpar)
function clipToRings(seg, rings) {
  const [x1, y1, x2, y2] = seg;
  const dx = x2 - x1,
    dy = y2 - y1;
  const ts = [0, 1];
  for (const r of rings)
    for (let i = 0; i < r.length; i++) {
      const a = r[i],
        b = r[(i + 1) % r.length];
      const ex = b[0] - a[0],
        ey = b[1] - a[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((a[0] - x1) * ey - (a[1] - y1) * ex) / den,
        u = ((a[0] - x1) * dy - (a[1] - y1) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
  ts.sort((p, q) => p - q);
  const out = [];
  for (let i = 1; i < ts.length; i++) {
    const ta = ts[i - 1],
      tb = ts[i];
    if (tb - ta < 1e-6) continue;
    const tm = (ta + tb) / 2;
    if (insideRings(rings, x1 + dx * tm, y1 + dy * tm))
      out.push([x1 + dx * ta, y1 + dy * ta, x1 + dx * tb, y1 + dy * tb]);
  }
  return out;
}

// ---------- desenho ----------

// Recorte de segmento por retângulo (Liang–Barsky)
function clip(x1, y1, x2, y2, r) {
  let t0 = 0,
    t1 = 1;
  const dx = x2 - x1,
    dy = y2 - y1;
  for (const [p, q] of [
    [-dx, x1 - r.x0],
    [dx, r.x1 - x1],
    [-dy, y1 - r.y0],
    [dy, r.y1 - y1],
  ]) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return null;
    }
  }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}

/** Hachura diagonal dentro de `outer`, fora de `hole` (opcional). */
function hatch(outer, hole, step) {
  const out = [];
  const span = outer.x1 - outer.x0 + outer.y1 - outer.y0;
  for (let d = -span; d <= span; d += step) {
    const seg = clip(
      outer.x0 + d,
      outer.y1,
      outer.x0 + d + span,
      outer.y1 - span,
      outer,
    );
    if (!seg) continue;
    if (!hole) {
      out.push(seg);
      continue;
    }
    // Remove o trecho que cai dentro do furo (a arte, no caso da sangria)
    const inner = clip(...seg, hole);
    if (!inner) out.push(seg);
    else {
      const [ax, ay, bx, by] = seg;
      const [cx, cy, ex, ey] = inner;
      if (Math.hypot(cx - ax, cy - ay) > 0.05) out.push([ax, ay, cx, cy]);
      if (Math.hypot(bx - ex, by - ey) > 0.05) out.push([ex, ey, bx, by]);
    }
  }
  return out;
}

const cm = (v) => fmtLen(v / 100, "cm");

/** Gabarito A4 de uma arte (primitivas em mm, como a folha técnica). */
export function buildArtSheet({ project, art, part, iso, preview }) {
  const items = [];
  const line = (x1, y1, x2, y2, w = 0.25, color = INK, dash) =>
    items.push({ t: "line", x1, y1, x2, y2, w, color, dash });
  const text = (x, y, s, size = 2.6, o = {}) =>
    items.push({
      t: "text",
      x,
      y,
      s: String(s),
      size,
      color: o.color || INK,
      anchor: o.anchor || "start",
      rot: o.rot || 0,
      bold: !!o.bold,
    });
  const box = (x, y, w, h, fill, color = INK, wd = 0.25) =>
    items.push({ t: "box", x, y, w, h, fill, color, wd });
  const rect = (x, y, w, h, wd = 0.3, color = INK, dash) => {
    line(x, y, x + w, y, wd, color, dash);
    line(x + w, y, x + w, y + h, wd, color, dash);
    line(x + w, y + h, x, y + h, wd, color, dash);
    line(x, y + h, x, y, wd, color, dash);
  };

  items.push({
    t: "rect",
    x: M,
    y: M,
    w: PAGE.w - 2 * M,
    h: PAGE.h - 2 * M,
    wd: 0.5,
    color: INK,
  });
  const colX = PAGE.w - M - SIDE_W;
  line(colX, M, colX, PAGE.h - M, 0.4);

  // Área do desenho e escala (sem escala normalizada: a arte ocupa o espaço disponível)
  const area = {
    x: M + 24,
    y: M + 26,
    w: colX - M - 48,
    h: PAGE.h - 2 * M - 50,
  };
  const W = Math.max(art.w, 1),
    H = Math.max(art.h, 1),
    B = Math.max(art.bleed || 0, 0);
  const k = Math.min(area.w / (W + 2 * B), area.h / (H + 2 * B));
  const ox = area.x + (area.w - (W + 2 * B) * k) / 2 + B * k;
  const oy = area.y + (area.h - (H + 2 * B) * k) / 2 + B * k;
  const X = (v) => ox + v * k,
    Y = (v) => oy + v * k;

  text(M + 3, M + 6, (art.title || "ARTE").toUpperCase(), 3.2, { bold: true });
  text(
    M + 3,
    M + 10.5,
    `${part?.label || ""}${art.faceName ? ` · ${art.faceName}` : ""}`,
    2.1,
    { color: SOFT },
  );

  // Contorno recortado (testeira sextavada, painel com recorte…), em mm na folha
  const shape = artOutline({ ...art, w: W, h: H });
  const toMm = (r) => r.map(([x, y]) => [X(x), Y(y)]);
  const ringLines = (r, wd, color, dash) =>
    r.forEach((p, i) => {
      const q = r[(i + 1) % r.length];
      line(p[0], p[1], q[0], q[1], wd, color, dash);
    });
  if (shape) {
    // Retângulo envolvente (medidas totais) tracejado, e a arte no contorno real
    rect(X(0), Y(0), W * k, H * k, 0.15, SOFT, [1, 1]);
    if (B > 0) {
      const inner = shape.map(toMm),
        outer = shape.map((r) => toMm(offsetRing(r, B)));
      const all = [...outer, ...inner];
      const xs = outer.flat().map((p) => p[0]),
        ys = outer.flat().map((p) => p[1]);
      const box0 = {
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys),
      };
      for (const seg of hatch(box0, null, 1.6))
        for (const piece of clipToRings(seg, all)) line(...piece, 0.12, BLEED);
      outer.forEach((r) => ringLines(r, 0.25, BLEED, [1.2, 0.8]));
      text(
        (box0.x0 + box0.x1) / 2,
        Math.min(box0.y0, Y(-B)) - 1.2,
        `SANGRIA ${cm(B)} cm (não ocupar com informação)`,
        1.9,
        { color: BLEED, anchor: "middle", bold: true },
      );
    }
    shape.forEach((r) => ringLines(toMm(r), 0.4, INK));
  } else if (B > 0) {
    const outer = { x0: X(-B), y0: Y(-B), x1: X(W + B), y1: Y(H + B) };
    const hole = { x0: X(0), y0: Y(0), x1: X(W), y1: Y(H) };
    for (const s of hatch(outer, hole, 1.6)) line(...s, 0.12, BLEED);
    rect(
      outer.x0,
      outer.y0,
      outer.x1 - outer.x0,
      outer.y1 - outer.y0,
      0.25,
      BLEED,
      [1.2, 0.8],
    );
    text(
      (outer.x0 + outer.x1) / 2,
      outer.y0 - 1.2,
      `SANGRIA ${cm(B)} cm (não ocupar com informação)`,
      1.9,
      { color: BLEED, anchor: "middle", bold: true },
    );
  }
  if (!shape) box(X(0), Y(0), W * k, H * k, "#ffffff", INK, 0.4);

  // Área de segurança (centralizada)
  if (art.safeW > 0 && art.safeH > 0 && art.safeW <= W && art.safeH <= H) {
    const sx = (W - art.safeW) / 2,
      sy = (H - art.safeH) / 2;
    rect(X(sx), Y(sy), art.safeW * k, art.safeH * k, 0.25, GUIDE, [1.5, 1]);
    text(
      X(sx) + 1,
      Y(sy) + 3,
      `ÁREA DE SEGURANÇA ${cm(art.safeW)} × ${cm(art.safeH)} cm`,
      1.9,
      { color: GUIDE, bold: true },
    );
  }

  // Interferências: hachura vermelha e número (o nome entra quando cabe).
  // As posições ficam em cotas em cadeia fora da arte, sem linhas cruzando o desenho.
  const zones = (art.zones || [])
    .map((z) => {
      const zx = Math.min(Math.max(z.x, 0), W),
        zy = Math.min(Math.max(z.y, 0), H);
      return {
        ...z,
        zx,
        zy,
        zw: Math.min(z.w, W - zx),
        zh: Math.min(z.h, H - zy),
      };
    })
    .filter((z) => z.zw > 0 && z.zh > 0);
  zones.forEach((z, i) => {
    const style = zoneStyle(z);
    const zr = {
      x0: X(z.zx),
      y0: Y(z.zy),
      x1: X(z.zx + z.zw),
      y1: Y(z.zy + z.zh),
    };
    if (!shape) {
      box(X(z.zx), Y(z.zy), z.zw * k, z.zh * k, style.fill, style.color, 0.3);
      if (zoneKind(z) === "cutout" && !z.requiresReview)
        for (const s2 of hatch(zr, null, 2.2)) line(...s2, 0.15, style.color);
      else rect(X(z.zx), Y(z.zy), z.zw * k, z.zh * k, 0.4, style.color, style.dash);
    } else {
      // Só o trecho dentro da arte: a área de corte não passa do contorno
      const mm = shape.map(toMm);
      const edges = [
        [zr.x0, zr.y0, zr.x1, zr.y0],
        [zr.x1, zr.y0, zr.x1, zr.y1],
        [zr.x1, zr.y1, zr.x0, zr.y1],
        [zr.x0, zr.y1, zr.x0, zr.y0],
      ];
      for (const e of edges)
        for (const piece of clipToRings(e, mm)) line(...piece, 0.3, style.color, style.dash);
      if (zoneKind(z) === "cutout" && !z.requiresReview)
        for (const s2 of hatch(zr, null, 2.2))
          for (const piece of clipToRings(s2, mm)) line(...piece, 0.15, style.color);
    }
    const cx = X(z.zx + z.zw / 2),
      cy = Y(z.zy + z.zh / 2);
    const name = `${i + 1}. ${(z.label || "Área").toUpperCase()}`.slice(0, 28);
    const size = `${cm(z.zw)} × ${cm(z.zh)} cm`;
    const fitsName = z.zw * k >= name.length * 1.15 + 2 && z.zh * k >= 7;
    if (fitsName) {
      text(cx, cy - 0.6, name, 2, { color: style.color, anchor: "middle", bold: true });
      text(cx, cy + 2.6, `(${size})`, 1.8, {
        color: style.color,
        anchor: "middle",
        bold: true,
      });
    } else {
      // Só o número, num selo branco para ler mesmo sobre a hachura
      items.push({
        t: "circle",
        x: cx,
        y: cy,
        r: 1.9,
        fill: "#ffffff",
        color: style.color,
        w: 0.25,
      });
      text(cx, cy + 0.75, String(i + 1), 2, {
        color: style.color,
        anchor: "middle",
        bold: true,
      });
    }
  });

  // Cotas em cadeia: horizontal embaixo (bordas de cada interferência) e vertical à direita
  const chain = (values, extent) => {
    const sorted = [
      ...new Set([0, extent, ...values.map((v) => Math.round(v * 10) / 10)]),
    ]
      .filter((v) => v >= 0 && v <= extent)
      .sort((p, q) => p - q);
    const out = [sorted[0]];
    for (const v of sorted.slice(1))
      if (v - out[out.length - 1] >= Math.max(0.5, extent * 0.004)) out.push(v);
    if (out[out.length - 1] !== extent) out[out.length - 1] = extent;
    return out;
  };
  const corners = shape ? shape.flat() : [];
  if (zones.length || corners.length) {
    const DIMC = "#1f2937";
    const xs = chain(
      [
        ...zones.flatMap((z) => [z.zx, z.zx + z.zw]),
        ...corners.map((p) => p[0]),
      ],
      W,
    );
    const yLine = Y(H + B) + 5;
    for (let i = 1; i < xs.length; i++) {
      const xa = X(xs[i - 1]),
        xb = X(xs[i]);
      line(xa, Y(H) + 0.8, xa, yLine + 1.4, 0.12, DIMC);
      line(xb, Y(H) + 0.8, xb, yLine + 1.4, 0.12, DIMC);
      line(xa, yLine, xb, yLine, 0.18, DIMC);
      line(xa - 0.9, yLine + 0.9, xa + 0.9, yLine - 0.9, 0.3, DIMC);
      line(xb - 0.9, yLine + 0.9, xb + 0.9, yLine - 0.9, 0.3, DIMC);
      const label = cm(xs[i] - xs[i - 1]);
      const narrow = xb - xa < label.length * 1.2 + 1;
      // Trechos estreitos alternam o texto acima e abaixo da linha
      text(
        (xa + xb) / 2,
        narrow && i % 2 === 0 ? yLine + 3.2 : yLine - 0.9,
        label,
        narrow ? 1.6 : 1.9,
        { anchor: "middle", color: DIMC, bold: true },
      );
    }
    const ys = chain(
      [
        ...zones.flatMap((z) => [z.zy, z.zy + z.zh]),
        ...corners.map((p) => p[1]),
      ],
      H,
    );
    const xLine = X(W + B) + 5;
    for (let i = 1; i < ys.length; i++) {
      const ya = Y(ys[i - 1]),
        yb = Y(ys[i]);
      line(X(W) + 0.8, ya, xLine + 1.4, ya, 0.12, DIMC);
      line(X(W) + 0.8, yb, xLine + 1.4, yb, 0.12, DIMC);
      line(xLine, ya, xLine, yb, 0.18, DIMC);
      line(xLine - 0.9, ya + 0.9, xLine + 0.9, ya - 0.9, 0.3, DIMC);
      line(xLine - 0.9, yb + 0.9, xLine + 0.9, yb - 0.9, 0.3, DIMC);
      const label = cm(ys[i] - ys[i - 1]);
      const narrow = yb - ya < label.length * 1.2 + 1;
      text(
        narrow && i % 2 === 0 ? xLine + 3.2 : xLine - 0.9,
        (ya + yb) / 2,
        label,
        narrow ? 1.6 : 1.9,
        { anchor: "middle", rot: -90, color: DIMC, bold: true },
      );
    }
  }

  // Medidas finais da arte (fora da sangria)
  const top = Y(-B) - 6,
    left = X(-B) - 6;
  line(X(0), top, X(W), top, 0.25, "#ff0000");
  line(X(0), top - 1.4, X(0), top + 1.4, 0.3, "#ff0000");
  line(X(W), top - 1.4, X(W), top + 1.4, 0.3, "#ff0000");
  text((X(0) + X(W)) / 2, top - 1, `${cm(W)} cm`, 2.6, {
    anchor: "middle",
    color: "#ff0000",
    bold: true,
  });
  line(left, Y(0), left, Y(H), 0.25, "#ff0000");
  line(left - 1.4, Y(0), left + 1.4, Y(0), 0.3, "#ff0000");
  line(left - 1.4, Y(H), left + 1.4, Y(H), 0.3, "#ff0000");
  text(left - 1, (Y(0) + Y(H)) / 2, `${cm(H)} cm`, 2.6, {
    anchor: "middle",
    rot: -90,
    color: "#ff0000",
    bold: true,
  });

  // Selo do marcador, como no mapa de instalação
  const bx = X(W) - 2,
    by = Y(-B) - 13;
  items.push({
    t: "circle",
    x: bx,
    y: by,
    r: 4.2,
    fill: MARKER,
    color: "#ffffff",
    w: 0.5,
  });
  text(bx, by + 1.5, art.marker, art.marker.length > 1 ? 3.2 : 4.2, {
    anchor: "middle",
    color: "#ffffff",
    bold: true,
  });

  // Coluna da direita: identificação, vista da parede e interferências
  const sx = colX + 4,
    sw = SIDE_W - 8;
  let y = M + 7;
  text(
    sx,
    y,
    `CADERNO DE ARTE · ${project.name}`.slice(0, 48).toUpperCase(),
    1.9,
    { color: SOFT, bold: true },
  );
  y += 7.5;
  text(sx, y, `${art.marker} · ${(art.title || "Arte").slice(0, 28)}`, 3.8, {
    bold: true,
  });
  y += 6;
  text(
    sx,
    y,
    `Arte: ${cm(W)} × ${cm(H)} cm${shape ? " (envolvente)" : ""}`,
    2.6,
  );
  if (shape) {
    y += 4.5;
    text(
      sx,
      y,
      "Formato recortado: cortar no contorno (cotas nos vértices)",
      2,
      {
        color: SOFT,
      },
    );
  }
  y += 4.5;
  text(sx, y, `Com sangria: ${cm(W + 2 * B)} × ${cm(H + 2 * B)} cm`, 2.3, {
    color: SOFT,
  });
  y += 4.5;
  text(
    sx,
    y,
    `Área da arte: ${artArea(art).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m²`,
    2.3,
    { color: SOFT },
  );
  y += 6;
  text(sx, y, "VISTA DA PAREDE (APOIO)", 2.1, { bold: true });
  y += 2;
  if (iso) {
    const iw = sw,
      ih = iw * (700 / 900);
    items.push({ t: "image", x: sx, y, w: iw, h: ih, src: iso });
    y += ih + 4;
  } else {
    text(sx, y + 6, "Vista 3D indisponível neste navegador.", 2, {
      color: SOFT,
    });
    y += 12;
  }
  text(sx, y, `INTERFERÊNCIAS (${(art.zones || []).length})`, 2.1, {
    bold: true,
  });
  y += 4.5;
  for (const [i, z] of (art.zones || []).slice(0, 8).entries()) {
    const style = zoneStyle(z);
    text(sx, y, `${i + 1}. ${style.title} · ${(z.label || "Área").slice(0, 16)}`, 1.9, {
      color: style.color,
      bold: true,
    });
    text(sx + sw, y, `${cm(z.w)}×${cm(z.h)} em ${cm(z.x)}, ${cm(z.y)}`, 1.7, {
      anchor: "end",
      color: SOFT,
    });
    y += 3.6;
  }
  if (!(art.zones || []).length)
    text(sx, y, "Nenhuma interferência.", 1.9, { color: SOFT });
  if (art.notes)
    text(sx, PAGE.h - M - 30, `Obs.: ${art.notes}`.slice(0, 60), 1.9);

  const by2 = PAGE.h - M - 22;
  line(colX, by2, PAGE.w - M, by2, 0.4);
  text(sx, by2 + 6, "COTAS", 1.8, { color: SOFT, bold: true });
  text(sx, by2 + 10.5, "cm · sem escala", 2.8, { bold: true });
  text(sx + 44, by2 + 6, "REVISÃO", 1.8, { color: SOFT, bold: true });
  text(
    sx + 44,
    by2 + 10.5,
    preview ? "PRÉVIA" : `R${project.revision || 0}`,
    3.2,
    { bold: true, color: preview ? "#b03d3a" : INK },
  );
  text(
    sx,
    by2 + 17,
    `${new Date().toLocaleDateString("pt-BR")} · origem das posições: canto superior esquerdo da arte`,
    1.6,
    { color: SOFT },
  );
  if (importNotice(project)) text(M, PAGE.h - 3, importNotice(project), 1.8, { color: CUT });
  return { items };
}

/** Mapa de instalação: stand em isométrica com as paredes das artes destacadas (A, B…). */
export function buildArtMap(project, arts, meshMap, corner = "auto") {
  const parts = arts
    .map((a) => project.parts.find((p) => p.id === a.partId))
    .filter(Boolean);
  const overview = overviewImage(project, meshMap, parts, project.sourceUnit, {
    corner,
  });
  const byPart = new Map(arts.map((a) => [a.partId, a.marker]));
  return {
    corner: overview?.corner ?? 0,
    ...buildOverview({
      project,
      parts: parts.map((p) => ({
        ...p,
        label:
          `${p.label} · ${arts.find((a) => a.partId === p.id)?.title || ""}`.slice(
            0,
            40,
          ),
      })),
      overview,
      preview: true,
      title: "MAPA DE INSTALAÇÃO (ISOMÉTRICA, SEM ESCALA)",
      heading: "Mapa de instalação",
      legend: "Paredes com arte",
      tag: (i) => byPart.get(parts[i]?.id) || markerLabel(i),
    }),
  };
}

export function artSheet(project, art, meshMap) {
  const part = project.parts.find((p) => p.id === art.partId);
  const iso = part ? partAnalysis(part, meshMap, project.sourceUnit).iso : null;
  return buildArtSheet({ project, art, part, iso, preview: true });
}

export async function downloadArtPdf(project, arts, meshMap, corner) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  drawSheetPdf(pdf, buildArtMap(project, arts, meshMap, corner));
  for (const art of arts) {
    pdf.addPage();
    drawSheetPdf(pdf, artSheet(project, art, meshMap));
  }
  pdf.save(
    `${project.name.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80)}-caderno-de-arte.pdf`,
  );
}
