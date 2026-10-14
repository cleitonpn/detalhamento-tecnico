// Núcleo geométrico do detalhamento: arestas no referencial da peça, vistas
// ortográficas, arcos (raios) e cotas. Sem DOM/WebGL, para rodar também nos testes.
import * as THREE from "three";
import { SCALE } from "../domain/project.js";

/** Ângulo mínimo entre faces para a aresta aparecer no desenho. Acima das facetas
 * de 30° que o SketchUp usa em arcos, para que superfícies curvas não virem hachuras. */
export const FEATURE_ANGLE = 35;

// Cada vista: coordenadas de tela (sx, sy) e "proximidade" do observador.
// Frontal: observador do lado +profundidade. Superior: de cima, frente embaixo.
// Lateral: observador à esquerda (−largura). Nenhuma vista fica espelhada.
export const VIEW_DEFS = {
  front: {
    title: "Vista frontal",
    size: ([w, h]) => [w, h],
    map: (p) => [p[0], p[1], p[2]],
  },
  top: {
    title: "Vista superior",
    size: ([w, , d]) => [w, d],
    map: (p, [, , d]) => [p[0], d - p[2], p[1]],
  },
  side: {
    title: "Vista lateral esquerda",
    size: ([, h, d]) => [d, h],
    map: (p) => [p[2], p[1], -p[0]],
  },
};

const edgeCache = new WeakMap();
function featureEdges(geometry) {
  let edges = edgeCache.get(geometry);
  if (!edges) {
    const g = new THREE.EdgesGeometry(geometry, FEATURE_ANGLE);
    edges = g.attributes.position.array.slice();
    g.dispose();
    edgeCache.set(geometry, edges);
  }
  return edges;
}

/** Transforma pontos do mundo para o referencial da peça, em metros: [largura, altura, profundidade]. */
export function localTransform(part, sourceUnit) {
  const scale = SCALE[sourceUnit];
  const origin = new THREE.Vector3(...(part.frame?.origin || part.bounds.min));
  const axes = (
    part.frame?.axes || [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
  ).map((a) => new THREE.Vector3(...a));
  const v = new THREE.Vector3();
  return (x, y, z, matrix) => {
    v.set(x, y, z).applyMatrix4(matrix).multiplyScalar(scale).sub(origin);
    return [v.dot(axes[0]), v.dot(axes[1]), v.dot(axes[2])];
  };
}

/** Arestas vivas da peça em 3D local. Limita o total para peças muito detalhadas. */
export function partEdges(part, meshMap, sourceUnit, limit = 20000) {
  const toLocal = localTransform(part, sourceUnit);
  const segments = [];
  let simplified = false;
  for (const id of part.meshIds) {
    const mesh = meshMap.get(id);
    if (!mesh) continue;
    mesh.updateWorldMatrix(true, false);
    const e = featureEdges(mesh.geometry);
    if (segments.length + e.length / 6 > limit) {
      simplified = true;
      break;
    }
    for (let i = 0; i < e.length; i += 6)
      segments.push([
        toLocal(e[i], e[i + 1], e[i + 2], mesh.matrixWorld),
        toLocal(e[i + 3], e[i + 4], e[i + 5], mesh.matrixWorld),
      ]);
  }
  return { segments, simplified };
}

/** Triângulos da peça em 3D local (para linhas ocultas e vista 3D). */
export function partTriangles(part, meshMap, sourceUnit) {
  const toLocal = localTransform(part, sourceUnit);
  const out = [];
  for (const id of part.meshIds) {
    const mesh = meshMap.get(id);
    const pos = mesh?.geometry?.attributes.position;
    if (!pos) continue;
    mesh.updateWorldMatrix(true, false);
    const index = mesh.geometry.index;
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i++) {
      const k = index ? index.getX(i) : i;
      out.push(
        ...toLocal(pos.getX(k), pos.getY(k), pos.getZ(k), mesh.matrixWorld),
      );
    }
  }
  return new Float32Array(out);
}

// ---------- silhuetas ----------

// Direção do observador de cada vista, no referencial local
const VIEW_DIR = { front: [0, 0, 1], top: [0, 1, 0], side: [-1, 0, 0] };

/**
 * Arestas suaves (entre duas faces quase alinhadas) com as normais das faces.
 * Em superfícies curvas o contorno visível é a silhueta, que muda com a vista:
 * a aresta onde uma face olha para o observador e a vizinha olha para trás.
 */
export function smoothEdges(triangles) {
  const q = (i) =>
    `${Math.round(triangles[i] * 1e5)},${Math.round(triangles[i + 1] * 1e5)},${Math.round(triangles[i + 2] * 1e5)}`;
  const map = new Map();
  const cos = Math.cos((FEATURE_ANGLE * Math.PI) / 180);
  for (let t = 0; t < triangles.length; t += 9) {
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
    for (let i = 0; i < 3; i++) n[i] /= len;
    const keys = [q(t), q(t + 3), q(t + 6)];
    for (let e = 0; e < 3; e++) {
      const ka = keys[e],
        kb = keys[(e + 1) % 3];
      if (ka === kb) continue;
      const forward = ka < kb;
      const k = forward ? `${ka}|${kb}` : `${kb}|${ka}`;
      const rec = map.get(k);
      if (!rec)
        map.set(k, {
          a: p[e],
          b: p[(e + 1) % 3],
          n1: n,
          forward,
          n2: null,
          count: 1,
        });
      else {
        rec.count++;
        // Malha coerente percorre a aresta compartilhada em sentidos opostos; se não, inverte a normal
        rec.n2 = rec.forward !== forward ? n : n.map((v) => -v);
      }
    }
  }
  const out = [];
  for (const r of map.values()) {
    if (r.count !== 2 || !r.n2) continue;
    const dot = r.n1[0] * r.n2[0] + r.n1[1] * r.n2[1] + r.n1[2] * r.n2[2];
    if (dot >= cos) out.push(r); // as arestas vivas já vêm da EdgesGeometry
  }
  return out;
}

/** Silhuetas de uma vista, como segmentos 3D locais. */
export function silhouettes(smooth, view) {
  const d = VIEW_DIR[view];
  const out = [];
  for (const { a, b, n1, n2 } of smooth) {
    const s1 = n1[0] * d[0] + n1[1] * d[1] + n1[2] * d[2];
    const s2 = n2[0] * d[0] + n2[1] * d[1] + n2[2] * d[2];
    // Uma face voltada ao observador e a vizinha de costas ou de perfil (cantos arredondados)
    const eps = 1e-4;
    if ((s1 > eps && s2 <= eps) || (s2 > eps && s1 <= eps)) out.push([a, b]);
  }
  return out;
}

/** Projeta segmentos 3D locais em uma vista: [[sx1, sy1, c1, sx2, sy2, c2], ...] */
export function projectSegments(segments, view, dimensions) {
  const def = VIEW_DEFS[view];
  const out = [];
  for (const [a, b] of segments) {
    const p = def.map(a, dimensions),
      q = def.map(b, dimensions);
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6) out.push([...p, ...q]);
  }
  return out;
}

// ---------- arcos ----------

const TOL = 5e-4; // 0,5 mm para unir extremidades

function polylines(lines) {
  const key = (x, y) => `${Math.round(x / TOL)},${Math.round(y / TOL)}`;
  const nodes = new Map();
  const node = (x, y) => {
    const k = key(x, y);
    if (!nodes.has(k)) nodes.set(k, { k, x, y, links: new Set() });
    return nodes.get(k);
  };
  for (const [x1, y1, x2, y2] of lines) {
    const a = node(x1, y1),
      b = node(x2, y2);
    if (a !== b) {
      a.links.add(b);
      b.links.add(a);
    }
  }
  const used = new Set();
  const edgeKey = (a, b) => (a.k < b.k ? `${a.k}|${b.k}` : `${b.k}|${a.k}`);
  const chains = [];
  const walk = (start, next) => {
    const pts = [start];
    let prev = start,
      cur = next;
    used.add(edgeKey(start, next));
    while (true) {
      pts.push(cur);
      if (cur.links.size !== 2 || cur === start) break;
      const nxt = [...cur.links].find((n) => n !== prev);
      if (!nxt || used.has(edgeKey(cur, nxt))) break;
      used.add(edgeKey(cur, nxt));
      prev = cur;
      cur = nxt;
    }
    return pts;
  };
  for (const n of nodes.values())
    if (n.links.size !== 2)
      for (const m of n.links)
        if (!used.has(edgeKey(n, m))) chains.push(walk(n, m));
  for (const n of nodes.values())
    for (const m of n.links)
      if (!used.has(edgeKey(n, m))) chains.push(walk(n, m));
  const result = chains.map((pts) => ({
    pts: pts.map((p) => [p.x, p.y]),
    closed: pts.length > 3 && pts[0] === pts.at(-1),
  }));
  // Vizinhos de um ponto em qualquer cadeia: um arco pode atravessar um nó onde chega outra aresta
  result.neighbors = (x, y) =>
    [...(nodes.get(key(x, y))?.links || [])].map((m) => [m.x, m.y]);
  return result;
}

/** Ajuste algébrico de círculo (Kåsa) com coordenadas normalizadas. */
export function fitCircle(points) {
  const n = points.length;
  let mx = 0,
    my = 0;
  for (const [x, y] of points) {
    mx += x / n;
    my += y / n;
  }
  let suu = 0,
    svv = 0,
    suv = 0,
    suuu = 0,
    svvv = 0,
    suvv = 0,
    svuu = 0;
  for (const [x, y] of points) {
    const u = x - mx,
      v = y - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-18) return null;
  const a = (suuu + suvv) / 2,
    b = (svvv + svuu) / 2;
  const uc = (a * svv - b * suv) / det,
    vc = (b * suu - a * suv) / det;
  const cx = uc + mx,
    cy = vc + my;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  let sq = 0,
    max = 0;
  for (const [x, y] of points) {
    const d = Math.hypot(x - cx, y - cy) - r;
    sq += d * d;
    max = Math.max(max, Math.abs(d));
  }
  return { cx, cy, r, rms: Math.sqrt(sq / n), maxDev: max };
}

const turnOf = (a, b, c) => {
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    vx = c[0] - b[0],
    vy = c[1] - b[1];
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
};

/**
 * Encontra arcos circulares nas linhas visíveis de uma vista.
 * O exportador aproxima curvas por segmentos: o raio é uma estimativa geométrica,
 * com desvio e número de segmentos para o operador conferir.
 */
export function detectArcs(lines, { minSegments = 3 } = {}) {
  const deg = Math.PI / 180;
  const arcs = [];
  let freeCurves = 0;
  const chains = polylines(lines);
  for (const chain of chains) {
    let pts = chain.pts;
    const closed = chain.closed;
    if (closed) {
      // Contorno fechado: começa logo após o segmento mais longo (um trecho reto,
      // se houver) para não partir um arco ao meio
      const ring = pts.slice(0, -1),
        m = ring.length;
      let best = 0,
        bestLen = -1;
      for (let k = 0; k < m; k++) {
        const prev = ring[(k - 1 + m) % m];
        const len = Math.hypot(ring[k][0] - prev[0], ring[k][1] - prev[1]);
        if (len > bestLen * (1 + 1e-6)) {
          bestLen = len;
          best = k;
        }
      }
      pts = [...ring.slice(best), ...ring.slice(0, best), ring[best]];
    }
    if (pts.length < minSegments + 1) continue;
    const n = pts.length;
    const segLen = (k) =>
      Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
    // turns[k]: ângulo no vértice k+1, entre os segmentos k e k+1
    const turns = [];
    for (let k = 1; k < n - 1; k++)
      turns.push(turnOf(pts[k - 1], pts[k], pts[k + 1]));
    // Trechos com curvatura constante: mesmo sentido, ângulos e comprimentos parecidos
    let i = 0;
    while (i < turns.length) {
      const t0 = turns[i];
      if (Math.abs(t0) < 0.3 * deg || Math.abs(t0) > 40 * deg) {
        i++;
        continue;
      }
      let j = i;
      const len0 = segLen(i);
      while (
        j + 1 < turns.length &&
        Math.sign(turns[j + 1]) === Math.sign(t0) &&
        Math.abs(turns[j + 1] - t0) <=
          Math.max(0.12 * Math.abs(t0), 0.3 * deg) &&
        segLen(j + 2) / len0 < 1.15 &&
        segLen(j + 2) / len0 > 0.87
      )
        j++;
      if (segLen(i + 1) / len0 > 1.15 || segLen(i + 1) / len0 < 0.87) {
        i++;
        continue;
      }
      // turns[i..j] -> vértices i..j+1 do trecho, segmentos i..j+1
      let run = pts.slice(i, Math.min(j + 3, n));
      const segments = run.length - 1;
      // Um arco termina num canto ou numa reta. Se a curva continua do mesmo lado,
      // com segmentos parecidos, é curva livre (elipse, spline): sem raio único.
      const keepsCurving = (t, seg) =>
        t !== undefined &&
        Math.sign(t) === Math.sign(t0) &&
        Math.abs(t) >= 0.3 * deg &&
        Math.abs(t) <= 40 * deg &&
        seg > 0 &&
        seg / len0 < 2 &&
        seg / len0 > 0.5;
      const free =
        keepsCurving(turns[i - 1], i - 1 >= 0 ? segLen(i - 1) : 0) ||
        keepsCurving(turns[j + 1], j + 3 < n ? segLen(j + 2) : 0);
      if (free) freeCurves++;
      if (segments >= minSegments && !free) {
        let fit = fitCircle(run);
        if (fit) {
          // Inclui os vértices de tangência com as retas vizinhas, que também estão no círculo
          const on = (p) =>
            Math.abs(Math.hypot(p[0] - fit.cx, p[1] - fit.cy) - fit.r) <=
            Math.max(5e-4, 0.005 * fit.r);
          let lo = i,
            hi = i + run.length - 1;
          while (lo > 0 && on(pts[lo - 1]) && segLen(lo - 1) <= len0 * 1.5)
            lo--;
          while (hi < n - 1 && on(pts[hi + 1]) && segLen(hi) <= len0 * 1.5)
            hi++;
          if (hi - lo + 1 > run.length) {
            run = pts.slice(lo, hi + 1);
            fit = fitCircle(run);
          }
          run = extendAcrossJunctions(run, fit, on, len0, chains.neighbors);
          fit = fitCircle(run) || fit;
        }
        if (
          fit &&
          fit.r > 0.002 &&
          fit.maxDev <= Math.max(5e-4, 0.005 * fit.r) &&
          fit.r < 200
        ) {
          let sweep = 0;
          for (let k = 1; k < run.length; k++) {
            const a0 = Math.atan2(
              run[k - 1][1] - fit.cy,
              run[k - 1][0] - fit.cx,
            );
            const a1 = Math.atan2(run[k][1] - fit.cy, run[k][0] - fit.cx);
            let d = a1 - a0;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            sweep += d;
          }
          const full = Math.abs(sweep) > 2 * Math.PI - 15 * deg && closed;
          const start = Math.atan2(run[0][1] - fit.cy, run[0][0] - fit.cx);
          const s = Math.abs(full ? 2 * Math.PI : sweep);
          arcs.push({
            cx: fit.cx,
            cy: fit.cy,
            r: fit.r,
            start,
            sweep: full ? 2 * Math.PI : sweep,
            full,
            length: fit.r * s,
            chord: full ? 0 : 2 * fit.r * Math.sin(s / 2),
            sagitta: full ? 0 : fit.r * (1 - Math.cos(s / 2)),
            segments,
            deviation: fit.maxDev,
            confidence:
              segments >= 6 && s >= 30 * deg
                ? "alta"
                : segments >= 4
                  ? "média"
                  : "baixa",
            points: run,
          });
        }
      }
      i = j + 1;
    }
  }
  const merged = mergeArcs(arcs);
  merged.freeCurves = freeCurves;
  return merged;
}

function extendAcrossJunctions(run, fit, on, len0, neighbors) {
  const angle = (p) => Math.atan2(p[1] - fit.cy, p[0] - fit.cx);
  const step = (a, b) => {
    let d = angle(b) - angle(a);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };
  const seen = new Set(
    run.map((p) => `${Math.round(p[0] / TOL)},${Math.round(p[1] / TOL)}`),
  );
  const out = [...run];
  for (const atStart of [true, false]) {
    for (let guard = 0; guard < 256; guard++) {
      const end = atStart ? out[0] : out.at(-1),
        prev = atStart ? out[1] : out.at(-2);
      const dir = step(prev, end);
      const next = neighbors(end[0], end[1]).find((p) => {
        const k = `${Math.round(p[0] / TOL)},${Math.round(p[1] / TOL)}`;
        const s = step(end, p);
        return (
          !seen.has(k) &&
          on(p) &&
          Math.hypot(p[0] - end[0], p[1] - end[1]) <= len0 * 1.5 &&
          Math.sign(s) === Math.sign(dir) &&
          Math.abs(s) <= Math.abs(dir) * 2.5 + 1e-9
        );
      });
      if (!next) break;
      seen.add(`${Math.round(next[0] / TOL)},${Math.round(next[1] / TOL)}`);
      atStart ? out.unshift(next) : out.push(next);
    }
  }
  return out;
}

// Contornos sobrepostos (topo e base de um balcão) geram o mesmo arco duas vezes
function mergeArcs(arcs) {
  const out = [];
  for (const a of arcs.sort((p, q) => q.length - p.length)) {
    const twin = out.find(
      (b) =>
        Math.hypot(a.cx - b.cx, a.cy - b.cy) < 2e-3 &&
        Math.abs(a.r - b.r) < 2e-3 &&
        Math.abs(Math.abs(a.sweep) - Math.abs(b.sweep)) < 0.05,
    );
    if (!twin) out.push(a);
  }
  // Arcos concêntricos de raios diferentes: interno/externo de uma peça curva
  for (const a of out)
    for (const b of out)
      if (
        a !== b &&
        a.r < b.r &&
        Math.hypot(a.cx - b.cx, a.cy - b.cy) < Math.max(2e-3, 0.01 * b.r)
      ) {
        a.role = "interno";
        b.role = b.role || "externo";
        a.thickness = b.thickness = b.r - a.r;
      }
  return out.sort((p, q) => q.r - p.r);
}

// ---------- cotas ----------

/** Pontos para cotas parciais: posições de arestas retas longas, agrupadas. */
export function chainStations(lines, along, extent, cross) {
  const tol = Math.max(2e-3, extent * 0.004);
  const values = [0, extent];
  for (const [x1, y1, , x2, y2] of lines) {
    const [a1, a2, c1, c2] =
      along === "x" ? [x1, x2, y1, y2] : [y1, y2, x1, x2];
    if (Math.abs(a1 - a2) < 1e-4 && Math.abs(c2 - c1) > cross * 0.08)
      values.push((a1 + a2) / 2);
  }
  values.sort((a, b) => a - b);
  const clusters = [];
  for (const v of values) {
    if (v < -tol || v > extent + tol) continue;
    if (!clusters.length || v - clusters.at(-1) > tol) clusters.push(v);
  }
  clusters[0] = 0;
  clusters[clusters.length - 1] = extent;
  return clusters.length >= 3 && clusters.length <= 12 ? clusters : null;
}

export const SCALES = [
  1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 125, 200, 250, 500,
];

/** Menor escala normalizada (1:n) em que todas as vistas cabem nas áreas (em mm). */
export function pickScale(sizesM, areaMm) {
  for (const n of SCALES)
    if (
      sizesM.every(
        ([w, h]) => (w * 1000) / n <= areaMm[0] && (h * 1000) / n <= areaMm[1],
      )
    )
      return n;
  return SCALES.at(-1);
}

export const mm = (m) => Math.round(m * 1000).toLocaleString("pt-BR");
export const mm1 = (m) =>
  (m * 1000).toLocaleString("pt-BR", {
    maximumFractionDigits: m * 1000 < 100 ? 1 : 0,
  });
