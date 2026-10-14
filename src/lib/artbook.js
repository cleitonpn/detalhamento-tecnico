// Caderno de arte (comunicação visual): a partir de paredes escolhidas no modelo,
// gera o mapa de instalação (A, B, C…) e um gabarito A4 por arte, com sangria,
// área de segurança e áreas de interferência. Conceito e layout vêm do Arte Guide;
// medidas e interferências saem do modelo 3D.
import { buildOverview, drawSheetPdf } from "./sheet.js";
import { overviewImage } from "./hlr.js";
import { partAnalysis } from "./drawings.js";
import { fmtLen, partTriangles } from "./techdraw.js";

const PAGE = { w: 297, h: 210 };
const M = 8;
const SIDE_W = 84;
const INK = "#173b48",
  SOFT = "#7c8794",
  MARKER = "#ea580c",
  CUT = "#dc2626",
  CUT_FILL = "#fde4e4",
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
      };
      groups.set(key, g);
    }
    g.area += len / 2;
    // Eixo horizontal ao longo da face
    for (const q of p) {
      const along = -nz * q[0] + nx * q[2];
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
      .map((g, i) => ({ ...g, index: i, w: g.u1 - g.u0, h: g.y1 - g.y0 }))
  );
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
export function defaultFace(faces, wall, parts) {
  if (!faces.length) return -1;
  const marked =
    faces[0].inward === undefined ? markInward(faces, wall, parts) : faces;
  const i = marked.findIndex((f) => f.inward);
  return i >= 0 ? i : 0;
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
});

/**
 * Interferências automáticas: peças à frente da face escolhida (TV, prateleira,
 * balcão…) viram áreas de corte, em cm, com origem no canto superior esquerdo da
 * arte, como quem olha para a face. Revestimentos finos que cobrem boa parte da
 * face (painel, chapa, logo grande) não contam.
 */
export function autoZones(
  art,
  wall,
  parts,
  { reach = 0.5, minDepth = 0.03 } = {},
) {
  const face = art.face;
  // Artes antigas guardavam a face como texto ("front"/"back"): sem plano, só áreas manuais
  if (!face || typeof face !== "object") return [];
  const local = frameOf(wall);
  const W = face.w,
    H = face.h;
  const zones = [];
  for (const q of parts) {
    if (q.id === wall.id || q.review?.kind === "ignore") continue;
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
    const zw = a1 - a0,
      zh = y1 - y0;
    if (zw * zh > 0.9 * W * H) continue; // outra parede ou o piso
    const thin = far - near < minDepth;
    const covers = zw >= 0.9 * W || zh >= 0.9 * H || zw * zh > 0.25 * W * H;
    if (thin && covers) continue;
    // Quem olha para a face vê o eixo "along" da direita para a esquerda
    zones.push({
      id: `auto-${q.id}`,
      auto: true,
      label: q.label,
      x: round1((face.u1 - a1) * 100),
      y: round1((face.y1 - y1) * 100),
      w: round1(zw * 100),
      h: round1(zh * 100),
    });
  }
  return mergeZones(zones);
}

/**
 * Junta áreas quase coincidentes (camadas do mesmo objeto empilhadas no modelo):
 * se a interseção cobre 70% da menor, vira uma área só, com a união das duas.
 */
export function mergeZones(zones) {
  const out = [];
  for (const z of [...zones].sort((a, b) => b.w * b.h - a.w * a.h)) {
    const twin = out.find((o) => {
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
  }
  return out
    .map((z) =>
      z.merged ? { ...z, label: `${z.label} (+${z.merged - 1})` } : z,
    )
    .sort((a, b) => a.x - b.x || a.y - b.y);
}

export const artArea = (art) => (art.w * art.h) / 10000;

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

  // Sangria: faixa hachurada em volta da arte
  if (B > 0) {
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
  box(X(0), Y(0), W * k, H * k, "#ffffff", INK, 0.4);

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
    box(X(z.zx), Y(z.zy), z.zw * k, z.zh * k, CUT_FILL, CUT, 0.3);
    for (const s2 of hatch(
      { x0: X(z.zx), y0: Y(z.zy), x1: X(z.zx + z.zw), y1: Y(z.zy + z.zh) },
      null,
      2.2,
    ))
      line(...s2, 0.15, CUT);
    const cx = X(z.zx + z.zw / 2),
      cy = Y(z.zy + z.zh / 2);
    const name = `${i + 1}. ${(z.label || "Área").toUpperCase()}`.slice(0, 28);
    const size = `${cm(z.zw)} × ${cm(z.zh)} cm`;
    const fitsName = z.zw * k >= name.length * 1.15 + 2 && z.zh * k >= 7;
    if (fitsName) {
      text(cx, cy - 0.6, name, 2, { color: CUT, anchor: "middle", bold: true });
      text(cx, cy + 2.6, `(${size})`, 1.8, {
        color: CUT,
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
        color: CUT,
        w: 0.25,
      });
      text(cx, cy + 0.75, String(i + 1), 2, {
        color: CUT,
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
  if (zones.length) {
    const DIMC = "#1f2937";
    const xs = chain(
      zones.flatMap((z) => [z.zx, z.zx + z.zw]),
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
      zones.flatMap((z) => [z.zy, z.zy + z.zh]),
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
  text(sx, y, `Arte: ${cm(W)} × ${cm(H)} cm`, 2.6);
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
    text(sx, y, `${i + 1}. ${(z.label || "Área").slice(0, 24)}`, 1.9, {
      color: CUT,
      bold: true,
    });
    text(sx + sw, y, `${cm(z.w)}×${cm(z.h)} em ${cm(z.x)}, ${cm(z.y)}`, 1.7, {
      anchor: "end",
      color: SOFT,
    });
    y += 3.6;
  }
  if (!(art.zones || []).length)
    text(sx, y, "Nenhuma área de corte.", 1.9, { color: SOFT });
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
