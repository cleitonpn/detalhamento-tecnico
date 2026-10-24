// Folha técnica A4 de uma peça: vistas na mesma escala normalizada, cotas totais e
// parciais, raios, vista isométrica e carimbo. Gera uma lista de primitivas em mm
// desenhada tanto em SVG (tela) quanto no PDF.
import {
  VIEW_DEFS,
  partEdges,
  partTriangles,
  projectSegments,
  detectArcs,
  chainStations,
  pickScale,
  fmtLen,
  smoothEdges,
  silhouettes,
  detectSlopes,
  addStations,
} from "./techdraw.js";
import { classifyLines, isometricImage } from "./hlr.js";

export const PAGE = { w: 297, h: 210 };
const M = 8; // margem
const SIDE_W = 84; // coluna do carimbo
const INK = "#173b48",
  DIM = "#b03d3a",
  SOFT = "#7c8794",
  HIDDEN = "#8e9aa6";
const CELL_PAD = { l: 17, r: 9, t: 11, b: 17 };
const MAX_HIDDEN = 700;

const cells = (() => {
  const x0 = M,
    y0 = M,
    w = PAGE.w - 2 * M - SIDE_W,
    h = PAGE.h - 2 * M;
  const cw = w / 2,
    ch = h / 2;
  return {
    front: { x: x0, y: y0, w: cw, h: ch },
    side: { x: x0 + cw, y: y0, w: cw, h: ch },
    top: { x: x0, y: y0 + ch, w: cw, h: ch },
    iso: { x: x0 + cw, y: y0 + ch, w: cw, h: ch },
  };
})();

/** Calcula tudo o que a folha precisa (vistas, raios, imagem 3D). É a parte demorada. */
export function analyzePart(part, meshMap, sourceUnit) {
  const dims = part.dimensions;
  const { segments, simplified } = partEdges(part, meshMap, sourceUnit);
  const triangles = partTriangles(part, meshMap, sourceUnit);
  const smooth = simplified ? [] : smoothEdges(triangles);
  const views = {};
  const arcs = [];
  const free = [];
  let freeCurves = 0;
  for (const view of ["front", "top", "side"]) {
    const projected = projectSegments(
      [...segments, ...silhouettes(smooth, view)],
      view,
      dims,
    );
    const cls = classifyLines(triangles, projected, view, dims);
    const flat = (l) => [l[0], l[1], l[3], l[4]];
    const visible = cls.visible.map(flat);
    const found = detectArcs(projected.map(flat));
    freeCurves += found.freeCurves || 0;
    found.forEach((a) => arcs.push({ ...a, view }));
    (found.free || []).forEach((a) => free.push({ ...a, view }));
    const [w, h] = VIEW_DEFS[view].size(dims);
    views[view] = {
      view,
      width: w,
      height: h,
      lines: visible,
      hidden: cls.hidden.length <= MAX_HIDDEN ? cls.hidden.map(flat) : [],
      hiddenOmitted: cls.hidden.length > MAX_HIDDEN,
      exactHidden: cls.exact,
      arcs: found,
      found,
      raw: cls.visible,
    };
  }
  // Só raios que importam para quem fabrica: curva de verdade (≥ 20°, ≥ 4 segmentos),
  // tamanho relevante para a vista e raio compatível com a peça. Dobras de estofado
  // e quase-retas (raios enormes com ângulo pequeno) ficam de fora.
  const relevant = (a) => {
    const [w, h] = VIEW_DEFS[a.view].size(dims),
      size = Math.max(w, h);
    const deg = (Math.abs(a.sweep) * 180) / Math.PI;
    if (a.r < 0.003 || a.segments < 4 || a.r > 2 * size) return false;
    if (!a.full && deg < 20) return false;
    return (a.full ? 2 * a.r : a.length) >= Math.min(0.04 * size, 0.05);
  };
  const kept = arcs.filter(relevant);
  const noise = arcs.length - kept.length;
  // Forma orgânica (estofado, almofadas): muitas curvas pequenas e irregulares.
  // Nesses casos um raio não ajuda a fabricar; a folha avisa e não cota raios.
  const organic = (noise >= 15 && noise > 2 * kept.length) || freeCurves >= 12;
  // Chanfros e dobras retas (testeira sextavada, pórtico chanfrado): comprimento,
  // inclinação e catetos até a quina virtual
  const slopes = [];
  if (!organic)
    for (const v of Object.values(views)) {
      v.slopes = detectSlopes(
        v.lines,
        v.width,
        v.height,
        v.found,
        v.found.free,
      );
      v.slopes.forEach((sl) => slopes.push({ ...sl, view: v.view }));
    }
  // Cotas parciais: em formas orgânicas só contam arestas longas (as dobras do tecido são curtas)
  for (const v of Object.values(views)) {
    const minCross = organic ? 0.3 : 0.08;
    v.chainX = chainStations(
      v.raw,
      "x",
      v.width,
      v.height,
      minCross,
      organic ? 3 : 10,
    );
    v.chainY = chainStations(
      v.raw,
      "y",
      v.height,
      v.width,
      minCross,
      organic ? 3 : 10,
    );
    delete v.raw;
    delete v.found;
    // Quinas dos chanfros também entram nas cotas em cadeia (os catetos)
    if (v.slopes?.length) {
      const pts = v.slopes.flatMap((g) =>
        g.items.flatMap((sl) => [
          [sl.x1, sl.y1],
          [sl.x2, sl.y2],
        ]),
      );
      v.chainX = addStations(
        v.chainX,
        pts.map((p) => p[0]),
        v.width,
      );
      v.chainY = addStations(
        v.chainY,
        pts.map((p) => p[1]),
        v.height,
      );
    }
  }
  // Raios iguais na mesma vista (cantos boleados, pés) viram um só item: "R1 · 4×"
  const groups = new Map();
  for (const a of organic ? [] : kept) {
    const key = `${a.view}|${Math.round(a.r * 1000)}|${a.full ? "o" : Math.round((Math.abs(a.sweep) * 180) / Math.PI / 5)}`;
    if (!groups.has(key)) groups.set(key, { ...a, count: 0 });
    groups.get(key).count++;
  }
  // No máximo 8 raios por folha, os mais visíveis (maior comprimento de arco)
  const grouped = [...groups.values()]
    .sort(
      (p, q) => (q.full ? 2 * q.r : q.length) - (p.full ? 2 * p.r : p.length),
    )
    .slice(0, 8)
    .sort((p, q) => q.r - p.r);
  grouped.forEach((a, i) => (a.id = `R${i + 1}`));
  arcs.length = 0;
  arcs.push(...grouped);
  // Curvas que não são arco de círculo: raio aproximado, faixa de raios, corda e flecha
  const curves = organic
    ? []
    : free
        .filter(
          (c) =>
            c.r >= 0.005 &&
            c.length >=
              Math.max(
                0.02,
                Math.min(
                  0.04 * Math.max(...VIEW_DEFS[c.view].size(dims)),
                  0.05,
                ),
              ),
        )
        .sort((p, q) => q.length - p.length)
        .slice(0, 4);
  curves.forEach((c, i) => (c.id = `L${i + 1}`));
  // Chanfros: no máximo 6, os mais longos; numerados C1, C2…
  const chamfers = slopes
    .sort((p, q) => q.length - p.length)
    .slice(0, 6)
    .map((sl, i) => ({ ...sl, id: `C${i + 1}` }));
  for (const v of Object.values(views))
    v.slopes = chamfers.filter((c) => c.view === v.view);
  const iso = isometricImage(triangles, segments, dims);
  return {
    views,
    arcs,
    curves,
    chamfers,
    iso,
    simplified,
    freeCurves,
    organic,
  };
}

/** Monta a folha (primitivas em mm, origem no canto superior esquerdo). */
export function buildSheet({
  unit = "cm",
  project,
  part,
  analysis,
  index,
  preview,
  material,
  finish,
}) {
  const items = [];
  const L = (m) => fmtLen(m, unit),
    L1 = (m) => fmtLen(m, unit, true);
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
  const rect = (x, y, w, h, wd = 0.3, color = INK) =>
    items.push({ t: "rect", x, y, w, h, wd, color });

  const { views, arcs, iso } = analysis;
  const curves = analysis.curves || [],
    chamfers = analysis.chamfers || [];
  const deg1 = (v) =>
    `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}°`;
  const area = [
    cells.front.w - CELL_PAD.l - CELL_PAD.r,
    cells.front.h - CELL_PAD.t - CELL_PAD.b,
  ];
  const scale = pickScale(
    ["front", "top", "side"].map((v) => [views[v].width, views[v].height]),
    area,
  );
  const k = 1000 / scale; // mm de papel por metro

  // Moldura e divisões
  rect(M, M, PAGE.w - 2 * M, PAGE.h - 2 * M, 0.5);
  line(PAGE.w - M - SIDE_W, M, PAGE.w - M - SIDE_W, PAGE.h - M, 0.4);
  line(
    M + (PAGE.w - 2 * M - SIDE_W) / 2,
    M,
    M + (PAGE.w - 2 * M - SIDE_W) / 2,
    PAGE.h - M,
    0.15,
    SOFT,
  );
  line(M, PAGE.h / 2, PAGE.w - M - SIDE_W, PAGE.h / 2, 0.15, SOFT);

  // Ticks oblíquos nas extremidades da cota (padrão de desenho de marcenaria)
  const tick = (x, y) => line(x - 1, y + 1, x + 1, y - 1, 0.3, DIM);
  const dimH = (xa, xb, yLine, yRef, label, alt = false) => {
    if (Math.abs(xb - xa) < 0.6) return;
    line(xa, yRef, xa, yLine + (yLine > yRef ? 1.5 : -1.5), 0.13, DIM);
    line(xb, yRef, xb, yLine + (yLine > yRef ? 1.5 : -1.5), 0.13, DIM);
    line(xa - 1.2, yLine, xb + 1.2, yLine, 0.18, DIM);
    tick(xa, yLine);
    tick(xb, yLine);
    // Sem espaço entre as linhas de chamada, o texto vai para fora, à direita
    if (Math.abs(xb - xa) < label.length * 1.5 + 1)
      text(
        alt ? Math.min(xa, xb) - 2 : Math.max(xa, xb) + 2,
        yLine + 0.8,
        label,
        2.1,
        {
          color: DIM,
          anchor: alt ? "end" : "start",
        },
      );
    else
      text((xa + xb) / 2, yLine - 0.9, label, 2.3, {
        color: DIM,
        anchor: "middle",
      });
  };
  const dimV = (ya, yb, xLine, xRef, label, alt = false) => {
    if (Math.abs(yb - ya) < 0.6) return;
    line(xRef, ya, xLine + (xLine > xRef ? 1.5 : -1.5), ya, 0.13, DIM);
    line(xRef, yb, xLine + (xLine > xRef ? 1.5 : -1.5), yb, 0.13, DIM);
    line(xLine, ya - 1.2, xLine, yb + 1.2, 0.18, DIM);
    const tk = (y) => line(xLine - 1, y + 1, xLine + 1, y - 1, 0.3, DIM);
    tk(ya);
    tk(yb);
    // Sem espaço, o texto sobe acima da linha de chamada superior
    if (Math.abs(yb - ya) < label.length * 1.5 + 1)
      text(
        xLine + 0.8,
        alt ? Math.max(ya, yb) + 2 + label.length * 1.15 : Math.min(ya, yb) - 2,
        label,
        2.1,
        {
          color: DIM,
          rot: -90,
        },
      );
    else
      text(xLine - 0.9, (ya + yb) / 2, label, 2.3, {
        color: DIM,
        anchor: "middle",
        rot: -90,
      });
  };

  const labels = []; // caixas dos textos de raio já colocados (evita sobreposição)
  for (const view of ["front", "side", "top"]) {
    const c = cells[view],
      v = views[view];
    const gw = v.width * k,
      gh = v.height * k;
    const ox = c.x + CELL_PAD.l + (area[0] - gw) / 2;
    const oy = c.y + CELL_PAD.t + (area[1] - gh) / 2;
    const X = (x) => ox + x * k,
      Y = (y) => oy + gh - y * k;
    text(c.x + 3, c.y + 5, VIEW_DEFS[view].title.toUpperCase(), 2.4, {
      bold: true,
    });
    for (const [x1, y1, x2, y2] of v.hidden)
      line(X(x1), Y(y1), X(x2), Y(y2), 0.13, HIDDEN, [1.2, 0.8]);
    // Em formas orgânicas o detalhe do tecido sai mais leve, para o contorno e as cotas se destacarem
    // Traços menores que 0,15 mm no papel não aparecem na impressão e só pesam o PDF
    for (const [x1, y1, x2, y2] of v.lines)
      if (Math.hypot(x2 - x1, y2 - y1) * k >= 0.15)
        line(
          X(x1),
          Y(y1),
          X(x2),
          Y(y2),
          analysis.organic ? 0.15 : 0.3,
          analysis.organic ? "#6b818d" : INK,
        );

    // Cotas: parciais junto à peça, total por fora
    const bottom = oy + gh,
      left = ox;
    if (v.chainX)
      for (let i = 1; i < v.chainX.length; i++)
        dimH(
          X(v.chainX[i - 1]),
          X(v.chainX[i]),
          bottom + 5,
          bottom + 0.8,
          L(v.chainX[i] - v.chainX[i - 1]),
          i % 2 === 0,
        );
    dimH(
      X(0),
      X(v.width),
      bottom + (v.chainX ? 10.5 : 5.5),
      bottom + 0.8,
      L(v.width),
    );
    if (v.chainY)
      for (let i = 1; i < v.chainY.length; i++)
        dimV(
          Y(v.chainY[i - 1]),
          Y(v.chainY[i]),
          left - 5,
          left - 0.8,
          L(v.chainY[i] - v.chainY[i - 1]),
          i % 2 === 0,
        );
    dimV(
      Y(0),
      Y(v.height),
      left - (v.chainY ? 10.5 : 5.5),
      left - 0.8,
      L(v.height),
    );

    // Raios: chamada curta junto ao arco (sem linha atravessando a folha).
    // A marca de centro só aparece quando o centro fica perto, dentro da vista.
    const inside = (x, y) =>
      x >= c.x + 2 && x <= c.x + c.w - 2 && y >= c.y + 7 && y <= c.y + c.h - 2;
    for (const a of [...arcs, ...curves].filter((x) => x.view === view)) {
      const cx = X(a.cx),
        cy = Y(a.cy);
      const mid = a.full ? a.start + Math.PI / 4 : a.start + a.sweep / 2;
      const pm = a.free ? a.points[Math.floor(a.points.length / 2)] : null;
      const mx = pm ? X(pm[0]) : X(a.cx + a.r * Math.cos(mid)),
        my = pm ? Y(pm[1]) : Y(a.cy + a.r * Math.sin(mid));
      const dist = Math.hypot(mx - cx, my - cy) || 1;
      const ux = (mx - cx) / dist,
        uy = (my - cy) / dist;
      if (!a.free && dist <= 25 && inside(cx, cy)) {
        line(cx - 1.4, cy, cx + 1.4, cy, 0.15, DIM);
        line(cx, cy - 1.4, cx, cy + 1.4, 0.15, DIM);
        line(cx, cy, mx, my, 0.18, DIM);
      } else
        line(
          mx - ux * Math.min(5, dist),
          my - uy * Math.min(5, dist),
          mx,
          my,
          0.18,
          DIM,
        );
      const many = a.count > 1 ? ` (${a.count}×)` : "";
      const full = a.free
        ? `${a.id} R≈${L(a.r)}`
        : a.full
          ? `${a.id} Ø${L(a.r * 2)}${many}`
          : `${a.id} R${L1(a.r)}${many}`;
      // Procura uma posição livre ao longo da chamada; sem espaço, fica só o ID (detalhes na tabela)
      let placed = false;
      for (const [step, label] of [
        [2.5, full],
        [5.5, full],
        [8.5, full],
        [2.5, a.id],
      ]) {
        const tx = mx + ux * step,
          ty = my + uy * step;
        const wLabel = label.length * 1.25 + 1.2;
        const box = {
          x0: ux >= 0 ? tx : tx - wLabel,
          x1: ux >= 0 ? tx + wLabel : tx,
          y0: ty - 2,
          y1: ty + 1.4,
        };
        if (
          !inside(box.x0, box.y0) ||
          !inside(box.x1, box.y1) ||
          labels.some(
            (b) =>
              b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0,
          )
        )
          continue;
        labels.push(box);
        line(mx, my, tx, ty, 0.18, DIM);
        text(tx + (ux >= 0 ? 0.6 : -0.6), ty + 0.8, label, 2.3, {
          color: DIM,
          anchor: ux >= 0 ? "start" : "end",
          bold: true,
        });
        placed = true;
        break;
      }
      if (!placed)
        text(mx + 0.8, my - 0.8, a.id, 1.9, { color: DIM, bold: true });
    }
    const vcx = ox + gw / 2,
      vcy = oy + gh / 2;
    // Segmentos da vista no papel, para a cota do chanfro não cruzar o desenho
    const paper = v.lines.map(([x1, y1, x2, y2]) => [
      X(x1),
      Y(y1),
      X(x2),
      Y(y2),
    ]);
    const crosses = (p, q) =>
      paper.some(([a, b, c, d]) => {
        const den = (q[0] - p[0]) * (d - b) - (q[1] - p[1]) * (c - a);
        if (Math.abs(den) < 1e-9) return false;
        const t = ((a - p[0]) * (d - b) - (b - p[1]) * (c - a)) / den,
          u = ((a - p[0]) * (q[1] - p[1]) - (b - p[1]) * (q[0] - p[0])) / den;
        return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
      });
    for (const g of v.slopes || []) {
      const geo = g.items.map((sl) => {
        const x1 = X(sl.x1),
          y1 = Y(sl.y1),
          x2 = X(sl.x2),
          y2 = Y(sl.y2);
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ux = (x2 - x1) / len,
          uy = (y2 - y1) / len;
        // Normal para fora da peça (lado oposto ao centro da vista)
        let nx = -uy,
          ny = ux;
        if (((x1 + x2) / 2 - vcx) * nx + ((y1 + y2) / 2 - vcy) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }
        // Texto acompanha o trecho, sempre legível (nunca de cabeça para baixo)
        let ang = (Math.atan2(uy, ux) * 180) / Math.PI,
          tx = ux,
          ty = uy;
        if (ang > 90 || ang <= -90) {
          ang = ang > 90 ? ang - 180 : ang + 180;
          tx = -ux;
          ty = -uy;
        }
        return { x1, y1, x2, y2, len, ux, uy, nx, ny, ang, tx, ty };
      });
      const label = `${g.id} ${L(g.length)} · ${deg1(g.angle)}${g.count > 1 ? ` (${g.count}×)` : ""}`;
      let off = 4.5,
        size = 2.1;
      // Texto do lado de fora da linha de cota (a base do texto fica do lado da peça
      // quando a normal aponta para baixo no papel)
      const textAt = (s, side, d, w) => {
        // Se o "para cima" das letras aponta para a peça, o texto desce a altura da letra
        const r = (s.ang * Math.PI) / 180;
        const up = Math.sin(r) * s.nx * side - Math.cos(r) * s.ny * side;
        const dd = d + (up < 0 ? 1.7 : 0);
        const along = -w / 2;
        return [
          (s.x1 + s.x2) / 2 + s.nx * side * dd + s.tx * along,
          (s.y1 + s.y2) / 2 + s.ny * side * dd + s.ty * along,
        ];
      };
      // Embaixo e à esquerda da vista ficam as cotas em cadeia: a cota do chanfro não entra lá
      const free = ([x, y]) => y <= oy + gh + 0.3 && x >= ox - 0.3;
      const textBox = (s, side, d, w) => {
        const [px, py] = textAt(s, side, d, w);
        const qx = px + s.tx * w,
          qy = py + s.ty * w;
        return {
          p: [px, py],
          q: [qx, qy],
          x0: Math.min(px, qx) - 1,
          x1: Math.max(px, qx) + 1,
          y0: Math.min(py, qy) - 2,
          y1: Math.max(py, qy) + 1,
        };
      };
      const textFits = (s, side, d, w) => {
        const t = textBox(s, side, d, w);
        return (
          inside(...t.p) &&
          inside(...t.q) &&
          free(t.p) &&
          free(t.q) &&
          !crosses(t.p, t.q) &&
          !labels.some(
            (b) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0,
          )
        );
      };
      // Cota completa na primeira ocorrência e lado onde ela não cruza o desenho
      const wFull = label.length * size * 0.52;
      let pick = null;
      for (const [side, d] of [
        [1, 4.5],
        [1, 8.5],
        [-1, 4.5],
      ])
        for (const [n, s] of geo.entries()) {
          if (pick || s.len < 3) continue;
          off = d;
          const a = [s.x1 + s.nx * side * off, s.y1 + s.ny * side * off],
            b = [s.x2 + s.nx * side * off, s.y2 + s.ny * side * off];
          const m = [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2],
            mo = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          if (
            free(a) &&
            free(b) &&
            !crosses(a, b) &&
            !crosses([s.x1, s.y1], a) &&
            !crosses([s.x2, s.y2], b) &&
            !crosses(m, mo) &&
            textFits(s, side, off + 0.9, wFull)
          )
            pick = { n, side, off: d };
        }
      pick ||= { n: 0, side: 1, off: 4.5 };
      off = pick.off;
      geo.forEach((s, n) => {
        if (s.len < 3) return;
        if (n === pick.n) {
          const side = pick.side;
          const nx = s.nx * side,
            ny = s.ny * side;
          const a = [s.x1 + nx * off, s.y1 + ny * off],
            b = [s.x2 + nx * off, s.y2 + ny * off];
          line(
            s.x1 + nx * 0.8,
            s.y1 + ny * 0.8,
            a[0] + nx * 1.5,
            a[1] + ny * 1.5,
            0.13,
            DIM,
          );
          line(
            s.x2 + nx * 0.8,
            s.y2 + ny * 0.8,
            b[0] + nx * 1.5,
            b[1] + ny * 1.5,
            0.13,
            DIM,
          );
          line(
            a[0] - s.ux * 1.2,
            a[1] - s.uy * 1.2,
            b[0] + s.ux * 1.2,
            b[1] + s.uy * 1.2,
            0.18,
            DIM,
          );
          for (const p of [a, b])
            line(
              p[0] - (s.ux + nx) * 0.7,
              p[1] - (s.uy + ny) * 0.7,
              p[0] + (s.ux + nx) * 0.7,
              p[1] + (s.uy + ny) * 0.7,
              0.3,
              DIM,
            );
          const t = textBox(s, side, off + 0.9, wFull);
          labels.push(t);
          text(...t.p, label, size, { color: DIM, bold: true, rot: s.ang });
          return;
        }
        // Iguais: só o ID, no lado livre
        const w = g.id.length * 1.9 * 0.52;
        const side = textFits(s, 1, 1.2, w)
          ? 1
          : textFits(s, -1, 1.2, w)
            ? -1
            : 1;
        const [px, py] = textAt(s, side, 1.2, w);
        text(px, py, g.id, 1.9, { color: DIM, bold: true, rot: s.ang });
      });
    }
    if (v.hiddenOmitted)
      text(
        c.x + 3,
        c.y + c.h - 2.5,
        "Linhas ocultas omitidas pela quantidade.",
        1.8,
        { color: SOFT },
      );
  }

  // Vista 3D
  const ic = cells.iso;
  text(ic.x + 3, ic.y + 5, "PERSPECTIVA ISOMÉTRICA (APOIO)", 2.4, {
    bold: true,
  });
  if (iso) {
    const iw = ic.w - 8,
      ih = ic.h - 12;
    const ratio = 900 / 700;
    const w = Math.min(iw, ih * ratio),
      h = w / ratio;
    items.push({
      t: "image",
      x: ic.x + (ic.w - w) / 2,
      y: ic.y + 8 + (ih - h) / 2,
      w,
      h,
      src: iso,
    });
    text(ic.x + 3, ic.y + ic.h - 2.5, "Sem escala.", 1.8, { color: SOFT });
  } else
    text(
      ic.x + ic.w / 2,
      ic.y + ic.h / 2,
      "Vista 3D indisponível neste navegador.",
      2.2,
      { color: SOFT, anchor: "middle" },
    );

  // Coluna do carimbo
  const sx = PAGE.w - M - SIDE_W + 4,
    sw = SIDE_W - 8;
  let y = M + 7;
  text(
    sx,
    y,
    `DETALHAMENTO · ${project.name}`.slice(0, 48).toUpperCase(),
    1.9,
    { color: SOFT, bold: true },
  );
  y += 7;
  text(
    sx,
    y,
    `${String(index + 1).padStart(2, "0")}  ${part.label}`.slice(0, 34),
    4,
    { bold: true },
  );
  y += 6.5;
  const [W, H, D] = part.dimensions;
  text(sx, y, `L ${L(W)} × A ${L(H)} × P ${L(D)} ${unit}`, 2.8);
  if (part.quantity > 1) {
    y += 5;
    text(sx, y, `Quantidade: ${part.quantity} peças iguais`, 2.8, {
      bold: true,
      color: DIM,
    });
  }
  y += 9;
  text(sx, y, "RAIOS", 2.3, { bold: true });
  line(sx, y + 1.5, sx + sw, y + 1.5, 0.15, SOFT);
  y += 5.5;
  if (analysis.organic) {
    // Estofados e almofadas: dobras viram curvas pequenas e irregulares, sem raio de projeto
    for (const s of [
      "Forma orgânica (estofado, almofadas):",
      "raios não cotados. Use as medidas totais,",
      "as cotas parciais e a perspectiva.",
    ]) {
      text(sx, y, s, 2.1, { color: SOFT });
      y += 4.2;
    }
  } else if (!arcs.length && curves.length) {
    // Só curvas livres: vão para a tabela de curvas logo abaixo
  } else if (!arcs.length) {
    text(
      sx,
      y,
      analysis.freeCurves
        ? "Curva livre encontrada: sem raio único."
        : "Nenhum trecho circular identificado.",
      2.1,
      { color: SOFT },
    );
    y += 4.5;
    if (analysis.freeCurves) {
      text(sx, y, "Conferir o contorno no projeto original.", 2.1, {
        color: SOFT,
      });
      y += 4.5;
    }
  } else {
    text(sx, y, "ID", 1.9, { color: SOFT });
    text(sx + 8, y, "RAIO", 1.9, { color: SOFT });
    text(sx + 24, y, "ÂNGULO", 1.9, { color: SOFT });
    text(sx + 39, y, "ARCO", 1.9, { color: SOFT });
    text(sx + 54, y, "VISTA", 1.9, { color: SOFT });
    y += 4.2;
    for (const a of arcs.slice(0, 10)) {
      const deg = Math.abs((a.sweep * 180) / Math.PI);
      text(sx, y, a.id, 2.2, { bold: true, color: DIM });
      text(
        sx + 8,
        y,
        a.full
          ? `Ø ${L(2 * a.r)}`
          : `${L1(a.r)}${a.role ? ` ${a.role === "interno" ? "int." : "ext."}` : ""}`,
        2.2,
      );
      text(
        sx + 24,
        y,
        a.full
          ? "360°"
          : `${deg.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}°`,
        2.2,
      );
      text(sx + 39, y, L(a.length), 2.2);
      text(
        sx + 54,
        y,
        { front: "Frontal", top: "Superior", side: "Lateral" }[a.view],
        2.2,
      );
      y += 3.6;
      const note = [
        a.chord ? `corda ${L(a.chord)} · flecha ${L1(a.sagitta)}` : "",
        a.count > 1 ? `${a.count} iguais` : "",
        `${a.segments} seg. · confiança ${a.confidence}`,
        a.thickness ? `esp. ${L1(a.thickness)}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      text(sx + 8, y, note, 1.7, { color: SOFT });
      y += 4.2;
    }
    if (arcs.length > 10) {
      text(
        sx,
        y,
        `+ ${arcs.length - 10} raios na lista do pacote técnico.`,
        1.9,
        { color: SOFT },
      );
      y += 4;
    }
    text(
      sx,
      y + 0.5,
      "Raio estimado da geometria do modelo: conferir com o projeto.",
      1.7,
      { color: SOFT },
    );
    y += 5;
  }

  // Curvas livres: raio aproximado (melhor círculo) e a faixa de raios locais
  const limit = PAGE.h - M - 52 - 6;
  if (!analysis.organic && curves.length && y < limit) {
    text(sx, y, "CURVAS SEM RAIO ÚNICO", 2.1, { bold: true });
    y += 4.2;
    for (const c of curves) {
      if (y > limit) break;
      text(sx, y, c.id, 2.2, { bold: true, color: DIM });
      text(sx + 8, y, `R≈ ${L(c.r)}`, 2.2);
      text(sx + 24, y, `de ${L(c.rMin)} a ${L(c.rMax)}`, 2.2);
      text(
        sx + 54,
        y,
        { front: "Frontal", top: "Superior", side: "Lateral" }[c.view],
        2.2,
      );
      y += 3.6;
      text(
        sx + 8,
        y,
        `corda ${L(c.chord)} · flecha ${L1(c.sagitta)} · comprimento ${L(c.length)}`,
        1.7,
        { color: SOFT },
      );
      y += 4.2;
    }
  }
  // Chanfros e dobras retas: comprimento até a quina virtual, inclinação e catetos
  if (chamfers.length && y < limit) {
    y += 1.5;
    text(sx, y, "CHANFROS E DOBRAS", 2.3, { bold: true });
    line(sx, y + 1.5, sx + sw, y + 1.5, 0.15, SOFT);
    y += 5.5;
    text(sx, y, "ID", 1.9, { color: SOFT });
    text(sx + 8, y, "COMPR.", 1.9, { color: SOFT });
    text(sx + 24, y, "INCLIN.", 1.9, { color: SOFT });
    text(sx + 39, y, "CATETOS", 1.9, { color: SOFT });
    text(sx + 60, y, "VISTA", 1.9, { color: SOFT });
    y += 4.2;
    for (const c of chamfers) {
      if (y > limit) break;
      text(sx, y, c.id, 2.2, { bold: true, color: DIM });
      text(sx + 8, y, L(c.length), 2.2);
      text(sx + 24, y, deg1(c.angle), 2.2);
      text(sx + 39, y, `${L(c.dx)} × ${L(c.dy)}`, 2.2);
      text(
        sx + 60,
        y,
        { front: "Frontal", top: "Superior", side: "Lateral" }[c.view],
        2.2,
      );
      y += 3.6;
      const note = [
        c.count > 1 ? `${c.count} iguais` : "",
        c.bends?.length
          ? `dobra ${[...new Set(c.bends.map((b) => Math.round(b)))].map(deg1).join(" e ")}`
          : "",
        Math.abs(c.straight - c.length) > 0.005
          ? `trecho reto ${L(c.straight)} (quina arredondada)`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
      if (note) {
        text(sx + 8, y, note, 1.7, { color: SOFT });
        y += 4.2;
      } else y += 0.6;
    }
    text(
      sx,
      y + 0.5,
      "Medidas até a quina virtual (encontro das retas).",
      1.7,
      {
        color: SOFT,
      },
    );
    y += 5;
  }

  // Carimbo
  const by = PAGE.h - M - 52;
  line(PAGE.w - M - SIDE_W, by, PAGE.w - M, by, 0.4);
  const row = (label, value, yy) => {
    text(sx, yy, label, 1.8, { color: SOFT, bold: true });
    text(sx, yy + 3.6, String(value || "—").slice(0, 46), 2.4);
  };
  row("MATERIAL", material, by + 5);
  row("REVESTIMENTO", finish, by + 13);
  row(
    "OBSERVAÇÕES",
    (part.review.notes || "Sem observações.").replace(/\s+/g, " "),
    by + 21,
  );
  line(PAGE.w - M - SIDE_W, by + 29, PAGE.w - M, by + 29, 0.15, SOFT);
  text(sx, by + 34, "ESCALA", 1.8, { color: SOFT, bold: true });
  text(sx, by + 38.5, `1:${scale}`, 3.4, { bold: true });
  text(sx + 26, by + 34, "COTAS", 1.8, { color: SOFT, bold: true });
  text(sx + 26, by + 38.5, unit, 3.4, { bold: true });
  text(sx + 48, by + 34, "REVISÃO", 1.8, { color: SOFT, bold: true });
  text(
    sx + 48,
    by + 38.5,
    preview ? "PRÉVIA" : `R${project.revision || 0}`,
    3.4,
    { bold: true, color: preview ? DIM : INK },
  );
  text(
    sx,
    by + 45,
    `${new Date().toLocaleDateString("pt-BR")} · ${project.file?.name || ""}`.slice(
      0,
      58,
    ),
    1.7,
    { color: SOFT },
  );
  text(
    sx,
    by + 48.5,
    "Levantamento dimensional. Não é liberação de fabricação.",
    1.7,
    { color: SOFT },
  );
  return { items, scale };
}

/**
 * Página de vista geral: o stand inteiro em isométrica, com as peças do caderno
 * destacadas e numeradas como as folhas, e a legenda ao lado.
 */
export function buildOverview({
  project,
  parts,
  overview,
  preview,
  unit = "cm",
  title = "VISTA GERAL DO STAND (ISOMÉTRICA, SEM ESCALA)",
  heading = "Vista geral",
  legend = "Peças deste caderno",
  tag = (i) => String(i + 1).padStart(2, "0"),
}) {
  const items = [];
  const L = (m) => fmtLen(m, unit);
  const line = (x1, y1, x2, y2, w = 0.25, color = INK) =>
    items.push({ t: "line", x1, y1, x2, y2, w, color });
  const text = (x, y, s, size = 2.6, o = {}) =>
    items.push({
      t: "text",
      x,
      y,
      s: String(s),
      size,
      color: o.color || INK,
      anchor: o.anchor || "start",
      rot: 0,
      bold: !!o.bold,
    });
  const ACCENT = "#0b5c46",
    FILL = "#8fd9b8",
    GHOST = "#eef1f4";
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
  const area = { x: M + 4, y: M + 10, w: colX - M - 8, h: PAGE.h - 2 * M - 16 };
  text(M + 3, M + 5, title, 2.4, {
    bold: true,
  });
  if (overview) {
    const w = Math.min(area.w, area.h * overview.aspect),
      h = w / overview.aspect;
    const ox = area.x + (area.w - w) / 2,
      oy = area.y + (area.h - h) / 2;
    items.push({ t: "image", x: ox, y: oy, w, h, src: overview.url });
    // Marcadores numerados: mesmo número da folha da peça
    for (const { n, x, y } of overview.labels) {
      const cx = ox + x * w,
        cy = oy + y * h;
      items.push({
        t: "circle",
        x: cx,
        y: cy,
        r: 2.3,
        fill: "#ffffff",
        color: ACCENT,
        w: 0.35,
      });
      text(cx, cy + 0.85, tag(n - 1), 2.1, {
        anchor: "middle",
        bold: true,
        color: ACCENT,
      });
    }
  } else
    text(
      area.x + area.w / 2,
      area.y + area.h / 2,
      "Vista geral indisponível neste navegador.",
      2.4,
      { color: SOFT, anchor: "middle" },
    );

  const sx = colX + 4,
    sw = SIDE_W - 8;
  let y = M + 7;
  text(
    sx,
    y,
    `DETALHAMENTO · ${project.name}`.slice(0, 48).toUpperCase(),
    1.9,
    { color: SOFT, bold: true },
  );
  y += 7;
  text(sx, y, heading, 4, { bold: true });
  y += 7;
  items.push({
    t: "box",
    x: sx,
    y: y - 2.6,
    w: 3.2,
    h: 3.2,
    fill: FILL,
    color: ACCENT,
    wd: 0.25,
  });
  text(sx + 5, y, `${legend} (${parts.length})`, 2.3);
  y += 5;
  items.push({
    t: "box",
    x: sx,
    y: y - 2.6,
    w: 3.2,
    h: 3.2,
    fill: GHOST,
    color: "#c4ccd4",
    wd: 0.25,
  });
  text(sx + 5, y, "Demais peças do stand", 2.3);
  y += 7;
  text(sx, y, "PEÇAS", 2.3, { bold: true });
  line(sx, y + 1.5, sx + sw, y + 1.5, 0.15, SOFT);
  y += 5.5;
  const maxRows = Math.floor((PAGE.h - M - 30 - y) / 4);
  parts.slice(0, maxRows).forEach((p, i) => {
    text(sx, y, tag(i), 2.1, {
      bold: true,
      color: ACCENT,
    });
    text(
      sx + 7,
      y,
      `${p.label.slice(0, 22)}${p.quantity > 1 ? ` ×${p.quantity}` : ""}`,
      2.1,
    );
    const [W, H, D] = p.dimensions;
    text(sx + sw, y, `${L(W)}×${L(H)}×${L(D)}`, 1.8, {
      anchor: "end",
      color: SOFT,
    });
    y += 4;
  });
  if (parts.length > maxRows)
    text(
      sx,
      y,
      `+ ${parts.length - maxRows} peças nas folhas seguintes.`,
      1.9,
      { color: SOFT },
    );
  const by = PAGE.h - M - 24;
  line(colX, by, PAGE.w - M, by, 0.4);
  text(sx, by + 6, "COTAS", 1.8, { color: SOFT, bold: true });
  text(sx, by + 10.5, `${unit} (L×A×P)`, 3, { bold: true });
  text(sx + 40, by + 6, "REVISÃO", 1.8, { color: SOFT, bold: true });
  text(
    sx + 40,
    by + 10.5,
    preview ? "PRÉVIA" : `R${project.revision || 0}`,
    3.4,
    { bold: true, color: preview ? DIM : INK },
  );
  text(
    sx,
    by + 17,
    `${new Date().toLocaleDateString("pt-BR")} · ${project.file?.name || ""}`.slice(
      0,
      58,
    ),
    1.7,
    { color: SOFT },
  );
  text(
    sx,
    by + 20.5,
    "Levantamento dimensional. Não é liberação de fabricação.",
    1.7,
    { color: SOFT },
  );
  return { items };
}

const esc = (s) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const r2 = (n) => Math.round(n * 100) / 100;

export function sheetSvg({ items }) {
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE.w} ${PAGE.h}" role="img" aria-label="Folha técnica" style="background:#fff">`,
  ];
  for (const it of items) {
    if (it.t === "line")
      out.push(
        `<line x1="${r2(it.x1)}" y1="${r2(it.y1)}" x2="${r2(it.x2)}" y2="${r2(it.y2)}" stroke="${it.color}" stroke-width="${it.w}"${it.dash ? ` stroke-dasharray="${it.dash.join(" ")}"` : ""} stroke-linecap="round"/>`,
      );
    else if (it.t === "rect")
      out.push(
        `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="none" stroke="${it.color}" stroke-width="${it.wd}"/>`,
      );
    else if (it.t === "text")
      out.push(
        `<text x="${r2(it.x)}" y="${r2(it.y)}" font-size="${it.size}" fill="${it.color}" text-anchor="${it.anchor}" font-family="Helvetica, Arial, sans-serif"${it.bold ? ' font-weight="700"' : ""}${it.rot ? ` transform="rotate(${it.rot} ${r2(it.x)} ${r2(it.y)})"` : ""}>${esc(it.s)}</text>`,
      );
    else if (it.t === "image")
      out.push(
        `<image href="${it.src}" x="${r2(it.x)}" y="${r2(it.y)}" width="${r2(it.w)}" height="${r2(it.h)}"/>`,
      );
    else if (it.t === "circle")
      out.push(
        `<circle cx="${r2(it.x)}" cy="${r2(it.y)}" r="${it.r}" fill="${it.fill}" stroke="${it.color}" stroke-width="${it.w}"/>`,
      );
    else if (it.t === "box")
      out.push(
        `<rect x="${r2(it.x)}" y="${r2(it.y)}" width="${r2(it.w)}" height="${r2(it.h)}" fill="${it.fill}" stroke="${it.color}" stroke-width="${it.wd}"/>`,
      );
  }
  out.push("</svg>");
  return out.join("");
}

export function drawSheetPdf(pdf, { items }) {
  // Estilo de linha só é reenviado quando muda: peças com milhares de traços
  // (estofados) geravam PDFs de vários MB só com comandos repetidos.
  let style = "";
  for (const it of items) {
    if (it.t === "line") {
      const next = `${it.color}|${it.w}|${it.dash || ""}`;
      if (next !== style) {
        pdf.setDrawColor(it.color);
        pdf.setLineWidth(it.w);
        pdf.setLineDashPattern(it.dash || [], 0);
        style = next;
      }
      pdf.line(it.x1, it.y1, it.x2, it.y2);
      continue;
    }
    style = "";
    if (it.t === "rect") {
      pdf.setDrawColor(it.color);
      pdf.setLineWidth(it.wd);
      pdf.setLineDashPattern([], 0);
      pdf.rect(it.x, it.y, it.w, it.h);
    } else if (it.t === "text") {
      pdf.setTextColor(it.color);
      pdf.setFont("helvetica", it.bold ? "bold" : "normal");
      pdf.setFontSize(it.size * 2.835);
      const align =
        it.anchor === "middle"
          ? "center"
          : it.anchor === "end"
            ? "right"
            : "left";
      if (it.rot) {
        // jsPDF gira no sentido anti-horário; centraliza manualmente o texto vertical
        const half = it.anchor === "middle" ? pdf.getTextWidth(it.s) / 2 : 0;
        pdf.text(it.s, it.x, it.y + half, { angle: -it.rot });
      } else pdf.text(it.s, it.x, it.y, { align });
    } else if (it.t === "image")
      pdf.addImage(it.src, "PNG", it.x, it.y, it.w, it.h);
    else if (it.t === "circle") {
      pdf.setDrawColor(it.color);
      pdf.setFillColor(it.fill);
      pdf.setLineWidth(it.w);
      pdf.setLineDashPattern([], 0);
      pdf.circle(it.x, it.y, it.r, "FD");
    } else if (it.t === "box") {
      pdf.setDrawColor(it.color);
      pdf.setFillColor(it.fill);
      pdf.setLineWidth(it.wd);
      pdf.setLineDashPattern([], 0);
      pdf.rect(it.x, it.y, it.w, it.h, "FD");
    }
  }
  pdf.setLineDashPattern([], 0);
}
