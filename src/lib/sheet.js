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
  mm,
  mm1,
  smoothEdges,
  silhouettes,
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
      chainX: chainStations(cls.visible, "x", w, h),
      chainY: chainStations(cls.visible, "y", h, w),
    };
  }
  // Raios iguais na mesma vista (cantos boleados, pés) viram um só item: "R1 · 4×"
  const groups = new Map();
  for (const a of arcs.filter((x) => x.r >= 0.003)) {
    const key = `${a.view}|${Math.round(a.r * 1000)}|${a.full ? "o" : Math.round((Math.abs(a.sweep) * 180) / Math.PI / 5)}`;
    if (!groups.has(key)) groups.set(key, { ...a, count: 0 });
    groups.get(key).count++;
  }
  const grouped = [...groups.values()].sort((p, q) => q.r - p.r);
  grouped.forEach((a, i) => (a.id = `R${i + 1}`));
  arcs.length = 0;
  arcs.push(...grouped);
  const iso = isometricImage(triangles, segments, dims);
  return { views, arcs, iso, simplified, freeCurves };
}

/** Monta a folha (primitivas em mm, origem no canto superior esquerdo). */
export function buildSheet({
  project,
  part,
  analysis,
  index,
  preview,
  material,
  finish,
}) {
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
  const rect = (x, y, w, h, wd = 0.3, color = INK) =>
    items.push({ t: "rect", x, y, w, h, wd, color });

  const { views, arcs, iso } = analysis;
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
  const dimH = (xa, xb, yLine, yRef, label) => {
    if (Math.abs(xb - xa) < 0.6) return;
    line(xa, yRef, xa, yLine + (yLine > yRef ? 1.5 : -1.5), 0.13, DIM);
    line(xb, yRef, xb, yLine + (yLine > yRef ? 1.5 : -1.5), 0.13, DIM);
    line(xa - 1.2, yLine, xb + 1.2, yLine, 0.18, DIM);
    tick(xa, yLine);
    tick(xb, yLine);
    // Sem espaço entre as linhas de chamada, o texto vai para fora, à direita
    if (Math.abs(xb - xa) < label.length * 1.5 + 1)
      text(Math.max(xa, xb) + 2, yLine + 0.8, label, 2.1, { color: DIM });
    else
      text((xa + xb) / 2, yLine - 0.9, label, 2.3, {
        color: DIM,
        anchor: "middle",
      });
  };
  const dimV = (ya, yb, xLine, xRef, label) => {
    if (Math.abs(yb - ya) < 0.6) return;
    line(xRef, ya, xLine + (xLine > xRef ? 1.5 : -1.5), ya, 0.13, DIM);
    line(xRef, yb, xLine + (xLine > xRef ? 1.5 : -1.5), yb, 0.13, DIM);
    line(xLine, ya - 1.2, xLine, yb + 1.2, 0.18, DIM);
    const tk = (y) => line(xLine - 1, y + 1, xLine + 1, y - 1, 0.3, DIM);
    tk(ya);
    tk(yb);
    // Sem espaço, o texto sobe acima da linha de chamada superior
    if (Math.abs(yb - ya) < label.length * 1.5 + 1)
      text(xLine + 0.8, Math.min(ya, yb) - 2, label, 2.1, {
        color: DIM,
        rot: -90,
      });
    else
      text(xLine - 0.9, (ya + yb) / 2, label, 2.3, {
        color: DIM,
        anchor: "middle",
        rot: -90,
      });
  };

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
    for (const [x1, y1, x2, y2] of v.lines)
      line(X(x1), Y(y1), X(x2), Y(y2), 0.3);

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
          mm(v.chainX[i] - v.chainX[i - 1]),
        );
    dimH(
      X(0),
      X(v.width),
      bottom + (v.chainX ? 10.5 : 5.5),
      bottom + 0.8,
      mm(v.width),
    );
    if (v.chainY)
      for (let i = 1; i < v.chainY.length; i++)
        dimV(
          Y(v.chainY[i - 1]),
          Y(v.chainY[i]),
          left - 5,
          left - 0.8,
          mm(v.chainY[i] - v.chainY[i - 1]),
        );
    dimV(
      Y(0),
      Y(v.height),
      left - (v.chainY ? 10.5 : 5.5),
      left - 0.8,
      mm(v.height),
    );

    // Raios: marca de centro, linha até o meio do arco e valor
    for (const a of arcs.filter((x) => x.view === view)) {
      const cx = X(a.cx),
        cy = Y(a.cy);
      const mid = a.full ? a.start + Math.PI / 4 : a.start + a.sweep / 2;
      const mx = X(a.cx + a.r * Math.cos(mid)),
        my = Y(a.cy + a.r * Math.sin(mid));
      line(cx - 1.4, cy, cx + 1.4, cy, 0.15, DIM);
      line(cx, cy - 1.4, cx, cy + 1.4, 0.15, DIM);
      line(cx, cy, mx, my, 0.18, DIM);
      const ux = (mx - cx) / (Math.hypot(mx - cx, my - cy) || 1),
        uy = (my - cy) / (Math.hypot(mx - cx, my - cy) || 1);
      const tx = mx + ux * 2.5,
        ty = my + uy * 2.5;
      line(mx, my, tx, ty, 0.18, DIM);
      const many = a.count > 1 ? ` (${a.count}×)` : "";
      const label = a.full
        ? `${a.id} Ø${mm(a.r * 2)}${many}`
        : `${a.id} R${mm1(a.r)}${many}`;
      text(tx + (ux >= 0 ? 0.6 : -0.6), ty + 0.8, label, 2.3, {
        color: DIM,
        anchor: ux >= 0 ? "start" : "end",
        bold: true,
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
  text(sx, y, `L ${mm(W)} × A ${mm(H)} × P ${mm(D)} mm`, 2.8);
  y += 9;
  text(sx, y, "RAIOS", 2.3, { bold: true });
  line(sx, y + 1.5, sx + sw, y + 1.5, 0.15, SOFT);
  y += 5.5;
  if (!arcs.length) {
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
          ? `Ø ${mm(2 * a.r)}`
          : `${mm1(a.r)}${a.role ? ` ${a.role === "interno" ? "int." : "ext."}` : ""}`,
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
      text(sx + 39, y, mm(a.length), 2.2);
      text(
        sx + 54,
        y,
        { front: "Frontal", top: "Superior", side: "Lateral" }[a.view],
        2.2,
      );
      y += 3.6;
      const note = [
        a.chord ? `corda ${mm(a.chord)} · flecha ${mm1(a.sagitta)}` : "",
        a.count > 1 ? `${a.count} iguais` : "",
        `${a.segments} seg. · confiança ${a.confidence}`,
        a.thickness ? `esp. ${mm1(a.thickness)}` : "",
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
  text(sx + 26, by + 38.5, "mm", 3.4, { bold: true });
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
export function buildOverview({ project, parts, overview, preview }) {
  const items = [];
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
  text(M + 3, M + 5, "VISTA GERAL DO STAND (ISOMÉTRICA, SEM ESCALA)", 2.4, {
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
      text(cx, cy + 0.85, String(n).padStart(2, "0"), 2.1, {
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
  text(sx, y, "Vista geral", 4, { bold: true });
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
  text(sx + 5, y, `Peças deste caderno (${parts.length})`, 2.3);
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
    text(sx, y, String(i + 1).padStart(2, "0"), 2.1, {
      bold: true,
      color: ACCENT,
    });
    text(sx + 7, y, p.label.slice(0, 26), 2.1);
    const [W, H, D] = p.dimensions;
    text(sx + sw, y, `${mm(W)}×${mm(H)}×${mm(D)}`, 1.8, {
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
  text(sx, by + 10.5, "mm (L×A×P)", 3, { bold: true });
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
  for (const it of items) {
    if (it.t === "line") {
      pdf.setDrawColor(it.color);
      pdf.setLineWidth(it.w);
      pdf.setLineDashPattern(it.dash || [], 0);
      pdf.line(it.x1, it.y1, it.x2, it.y2);
    } else if (it.t === "rect") {
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
