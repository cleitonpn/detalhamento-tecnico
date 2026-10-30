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
export function featureEdges(geometry) {
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
  const chains = polylines(cleanLines(lines));
  const freeRuns = [];
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
      if (free) {
        freeCurves++;
        // Estende o trecho enquanto a curva segue do mesmo lado, com segmentos parecidos
        const curving = (t, a, b) =>
          t !== undefined &&
          Math.sign(t) === Math.sign(t0) &&
          Math.abs(t) >= 0.3 * deg &&
          Math.abs(t) <= 40 * deg &&
          a > 0 &&
          b / a < 2 &&
          b / a > 0.5;
        let lo = i,
          hi = j;
        while (lo > 0 && curving(turns[lo - 1], segLen(lo), segLen(lo - 1)))
          lo--;
        while (
          hi + 1 < turns.length &&
          curving(turns[hi + 1], segLen(hi + 1), segLen(hi + 2))
        )
          hi++;
        const last = freeRuns.at(-1);
        if (last && last.chain === chain && lo <= last.hi)
          last.hi = Math.max(last.hi, hi);
        else freeRuns.push({ chain, pts, lo, hi });
      }
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
            segments: run.length - 1,
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
  merged.free = freeRuns.map(({ pts, lo, hi }) =>
    freeCurve(pts.slice(lo, hi + 3)),
  );
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
    // Mesmo círculo e mesmo trecho (cópia ou pedaço de um arco já achado)
    const within = (b) => {
      if (b.full) return true;
      const mid = Math.atan2(
        Math.sin(a.start + a.sweep / 2),
        Math.cos(a.start + a.sweep / 2),
      );
      let d = (mid - b.start) * Math.sign(b.sweep || 1);
      d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return d <= Math.abs(b.sweep) + 0.05;
    };
    const twin = out.find(
      (b) =>
        Math.hypot(a.cx - b.cx, a.cy - b.cy) < 2e-3 &&
        Math.abs(a.r - b.r) < 2e-3 &&
        (Math.abs(Math.abs(a.sweep) - Math.abs(b.sweep)) < 0.05 || within(b)),
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

/**
 * Curva livre (elipse, spline, concordância variável): não tem um raio só. Mede o
 * raio do círculo que melhor a acompanha, o menor e o maior raio local, a corda e a
 * flecha — o que a marcenaria usa para traçar o gabarito.
 */
function freeCurve(points) {
  const fit = fitCircle(points) || { cx: 0, cy: 0, r: 0 };
  const radii = [];
  const step = Math.max(1, Math.floor(points.length / 8));
  for (let k = step; k + step < points.length; k += step) {
    const [a, b, c] = [points[k - step], points[k], points[k + step]];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]),
      bc = Math.hypot(c[0] - b[0], c[1] - b[1]),
      ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const cross = Math.abs(
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    );
    if (cross > 1e-12) radii.push((ab * bc * ca) / (2 * cross));
  }
  let length = 0;
  for (let k = 1; k < points.length; k++)
    length += Math.hypot(
      points[k][0] - points[k - 1][0],
      points[k][1] - points[k - 1][1],
    );
  const [p0, p1] = [points[0], points.at(-1)];
  const chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1e-12;
  let sagitta = 0;
  for (const p of points)
    sagitta = Math.max(
      sagitta,
      Math.abs(
        (p1[0] - p0[0]) * (p0[1] - p[1]) - (p0[0] - p[0]) * (p1[1] - p0[1]),
      ) / chord,
    );
  return {
    free: true,
    cx: fit.cx,
    cy: fit.cy,
    r: fit.r,
    rMin: radii.length ? Math.min(...radii) : fit.r,
    rMax: radii.length ? Math.max(...radii) : fit.r,
    start: Math.atan2(p0[1] - fit.cy, p0[0] - fit.cx),
    sweep: length / (fit.r || 1),
    length,
    chord,
    sagitta,
    segments: points.length - 1,
    points,
  };
}

/**
 * Remove linhas repetidas e trechos contidos em outra linha (silhuetas de superfícies
 * curvas desenhadas sobre as arestas): eles criam nós falsos que quebram os arcos.
 */
export function cleanLines(lines, tol = 5e-4) {
  const seen = new Set(),
    uniq = [];
  const q = (v) => Math.round(v / tol);
  for (const l of lines) {
    const [x1, y1, x2, y2] = l;
    const a = `${q(x1)},${q(y1)}`,
      b = `${q(x2)},${q(y2)}`;
    if (a === b) continue;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push([x1, y1, x2, y2, Math.hypot(x2 - x1, y2 - y1)]);
  }
  if (uniq.length > 30000) return uniq.map((l) => l.slice(0, 4));
  // Grade espacial para comparar só linhas vizinhas
  let span = 0;
  for (const [x1, y1, x2, y2] of uniq)
    span = Math.max(
      span,
      Math.abs(x1),
      Math.abs(y1),
      Math.abs(x2),
      Math.abs(y2),
    );
  const cell = Math.max(span / 100, 0.01);
  const grid = new Map();
  const cellsOf = ([x1, y1, x2, y2]) => {
    const out = [];
    const i0 = Math.floor(Math.min(x1, x2) / cell),
      i1 = Math.floor(Math.max(x1, x2) / cell),
      j0 = Math.floor(Math.min(y1, y2) / cell),
      j1 = Math.floor(Math.max(y1, y2) / cell);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) return null;
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) out.push(`${i},${j}`);
    return out;
  };
  uniq.forEach((l, n) => {
    for (const c of cellsOf(l) || []) {
      if (!grid.has(c)) grid.set(c, []);
      grid.get(c).push(n);
    }
  });
  const onSeg = (px, py, [x1, y1, x2, y2, len]) => {
    const t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / (len * len);
    if (t < -1e-6 || t > 1 + 1e-6) return false;
    return Math.hypot(x1 + t * (x2 - x1) - px, y1 + t * (y2 - y1) - py) <= tol;
  };
  return uniq
    .filter((l, n) => {
      const cells = cellsOf(l);
      if (!cells) return true;
      const near = new Set(cells.flatMap((c) => grid.get(c) || []));
      for (const m of near) {
        const o = uniq[m];
        if (m === n || o[4] <= l[4] + tol) continue;
        if (onSeg(l[0], l[1], o) && onSeg(l[2], l[3], o)) return false;
      }
      return true;
    })
    .map((l) => l.slice(0, 4));
}

// ---------- chanfros e dobras retas ----------

/** Trechos retos: linhas colineares encostadas viram um trecho só. */
export function straightRuns(lines, minLen = 0.005) {
  const deg = Math.PI / 180;
  const groups = new Map();
  for (const [x1, y1, x2, y2] of lines) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1e-4) continue;
    let th = Math.atan2(y2 - y1, x2 - x1);
    if (th < 0) th += Math.PI;
    if (th >= Math.PI - 1e-9) th -= Math.PI;
    const c = Math.cos(th),
      sn = Math.sin(th);
    const rho = -sn * x1 + c * y1;
    const key = `${Math.round(th / (0.25 * deg))}|${Math.round(rho / 0.001)}`;
    if (!groups.has(key)) groups.set(key, { th, rho, spans: [] });
    const t1 = c * x1 + sn * y1,
      t2 = c * x2 + sn * y2;
    groups.get(key).spans.push([Math.min(t1, t2), Math.max(t1, t2)]);
  }
  const runs = [];
  for (const { th, rho, spans } of groups.values()) {
    spans.sort((p, q) => p[0] - q[0]);
    const c = Math.cos(th),
      sn = Math.sin(th);
    const at = (t) => [c * t - sn * rho, sn * t + c * rho];
    let [a, b] = spans[0];
    const flush = () => {
      if (b - a >= minLen)
        runs.push({ th, rho, a: at(a), b: at(b), len: b - a });
    };
    for (const [p, q] of spans.slice(1)) {
      if (p <= b + 0.001) b = Math.max(b, q);
      else {
        flush();
        [a, b] = [p, q];
      }
    }
    flush();
  }
  return runs;
}

// Interseção das retas que passam por dois trechos (null se quase paralelas)
function meet(r, s) {
  const d1 = [r.b[0] - r.a[0], r.b[1] - r.a[1]],
    d2 = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((s.a[0] - r.a[0]) * d2[1] - (s.a[1] - r.a[1]) * d2[0]) / den;
  return [r.a[0] + t * d1[0], r.a[1] + t * d1[1]];
}

/**
 * Chanfros e dobras retas de uma vista: trechos inclinados (nem horizontais nem
 * verticais) relevantes. As pontas vão até a quina virtual com o trecho vizinho
 * (onde as retas se encontrariam sem o arredondamento), como se cota em marcenaria.
 * Devolve comprimento, inclinação em relação à horizontal, catetos e ângulo da dobra.
 */
export function detectSlopes(lines, width, height, arcs = [], curves = []) {
  const deg = Math.PI / 180;
  const size = Math.max(width, height);
  const runs = straightRuns(lines, 0.02);
  const onArc = (p) =>
    arcs.some(
      (a) =>
        Math.abs(Math.hypot(p[0] - a.cx, p[1] - a.cy) - a.r) <=
        Math.max(1e-3, 0.01 * a.r),
    );
  const off = (th) =>
    Math.min(th, Math.abs(th - Math.PI / 2), Math.PI - th) / deg;
  const slopes = [];
  for (const r of runs) {
    if (off(r.th) < 3 || r.len < Math.max(0.02, 0.03 * size)) continue;
    const mid = [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2];
    if (onArc(r.a) && onArc(r.b) && onArc(mid)) continue; // corda de um arco
    // Corda de uma curva livre: as duas pontas são vértices da curva
    const onCurve = (p) =>
      curves.some((c) =>
        c.points.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= 1e-3),
      );
    if (onCurve(r.a) && onCurve(r.b)) continue;
    // Quina virtual em cada ponta: o trecho reto vizinho mais próximo, não paralelo
    const corner = (end) => {
      let best = null,
        bd = Math.max(0.03, 0.25 * r.len);
      let bend = null;
      for (const n of runs) {
        if (n === r) continue;
        let dth = Math.abs(n.th - r.th);
        dth = Math.min(dth, Math.PI - dth);
        if (dth < 10 * deg) continue;
        const d = Math.min(
          Math.hypot(n.a[0] - end[0], n.a[1] - end[1]),
          Math.hypot(n.b[0] - end[0], n.b[1] - end[1]),
        );
        if (d < bd) {
          const p = meet(r, n);
          if (
            p &&
            Math.hypot(p[0] - end[0], p[1] - end[1]) <= bd + 0.2 * r.len
          ) {
            bd = d;
            best = p;
            bend = 180 - dth / deg; // ângulo interno entre os dois trechos
          }
        }
      }
      return { p: best || end, bend };
    };
    const ca = corner(r.a),
      cb = corner(r.b);
    const [p, q] = [ca.p, cb.p];
    const dx = Math.abs(q[0] - p[0]),
      dy = Math.abs(q[1] - p[1]);
    slopes.push({
      x1: p[0],
      y1: p[1],
      x2: q[0],
      y2: q[1],
      length: Math.hypot(dx, dy),
      straight: r.len,
      angle: Math.atan2(dy, dx) / deg,
      dx,
      dy,
      bends: [ca.bend, cb.bend].filter((v) => v != null),
    });
  }
  // Iguais (mesmo comprimento e inclinação) viram um item: "C1 · 4×"
  const groups = [];
  for (const sl of slopes.sort((p, q) => q.length - p.length)) {
    const g = groups.find(
      (x) =>
        Math.abs(x.length - sl.length) <= 0.002 &&
        Math.abs(x.angle - sl.angle) <= 0.5,
    );
    if (g) g.items.push(sl);
    else groups.push({ ...sl, items: [sl] });
  }
  return groups.map((g) => ({ ...g, count: g.items.length }));
}

/** Acrescenta posições às cotas em cadeia (quinas de chanfros), sem trechos menores que 2%. */
export function addStations(chain, extra, extent) {
  const tol = Math.max(2e-3, extent * 0.004);
  const base = chain ? [...chain] : [0, extent];
  for (const v of extra)
    if (v > tol && v < extent - tol && base.every((b) => Math.abs(b - v) > tol))
      base.push(v);
  base.sort((p, q) => p - q);
  const minGap = extent * 0.02;
  const kept = [0];
  for (const v of base.slice(1, -1))
    if (v - kept.at(-1) >= minGap && extent - v >= minGap) kept.push(v);
  kept.push(extent);
  return kept.length >= 3 ? kept : null;
}

// ---------- cotas ----------

/** Pontos para cotas parciais: posições de arestas retas longas, agrupadas. */
export function chainStations(
  lines,
  along,
  extent,
  cross,
  minCross = 0.08,
  maxInner = 10,
) {
  const tol = Math.max(2e-3, extent * 0.004);
  // Cada posição recebe o comprimento total de arestas que a sustenta
  const values = [];
  for (const [x1, y1, , x2, y2] of lines) {
    const [a1, a2, c1, c2] =
      along === "x" ? [x1, x2, y1, y2] : [y1, y2, x1, x2];
    const len = Math.abs(c2 - c1);
    if (Math.abs(a1 - a2) < 1e-4 && len > cross * minCross)
      values.push([(a1 + a2) / 2, len]);
  }
  values.sort((p, q) => p[0] - q[0]);
  const clusters = [];
  for (const [v, w] of values) {
    if (v < tol || v > extent - tol) continue;
    const last = clusters.at(-1);
    if (last && v - last.v <= tol) last.w += w;
    else clusters.push({ v, w });
  }
  const minGap = extent * 0.02;
  const spaced = (positions) => {
    const kept = [0];
    for (const v of positions)
      if (v - kept.at(-1) >= minGap && extent - v >= minGap) kept.push(v);
    kept.push(extent);
    return kept;
  };
  // Réguas, ripas e montantes em passo regular: todas as posições, pois viram uma cota só
  const all = spaced(clusters.map((c) => c.v));
  if (all.length > maxInner + 2 && chainRuns(all).length <= maxInner + 1)
    return all;
  // Mantém só as posições mais sustentadas (nas formas orgânicas, poucas) e descarta trechos < 2%
  const strongest = clusters
    .sort((p, q) => q.w - p.w)
    .slice(0, maxInner)
    .map((c) => c.v)
    .sort((p, q) => p - q);
  const kept = spaced(strongest);
  return kept.length >= 3 ? kept : null;
}

/**
 * Trechos da cota em cadeia. Espaçamentos que se repetem (réguas de um brise,
 * ripado, montantes) viram uma cota só, do primeiro ao último: "20× 13,7".
 * Cada trecho: { a, b, n, step } (n = repetições do passo; 1 = trecho comum).
 */
export function chainRuns(stations, tol = 1.5e-3) {
  const d = stations.slice(1).map((v, i) => v - stations[i]);
  const out = [];
  let i = 0;
  while (i < d.length) {
    let best = null;
    // Passo de 1 a 3 trechos (régua + vão, régua + vão + régua de outra largura…)
    for (let p = 1; p <= 3; p++) {
      let m = 1;
      while (
        i + (m + 1) * p <= d.length &&
        d
          .slice(i + m * p, i + (m + 1) * p)
          .every((v, j) => Math.abs(v - d[i + j]) <= tol)
      )
        m++;
      if (m >= 3 && (!best || m * p > best.m * best.p)) best = { p, m };
    }
    const span = best ? best.m * best.p : 1;
    out.push({
      a: stations[i],
      b: stations[i + span],
      n: best ? best.m : 1,
      step: stations[i + (best ? best.p : 1)] - stations[i],
    });
    i += span;
  }
  return out;
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

/** Unidade das cotas da folha: centímetros (padrão) ou milímetros. */
export const DRAWING_UNITS = { cm: 100, mm: 1000 };
export function fmtLen(m, unit = "cm", fine = false) {
  const v = m * (DRAWING_UNITS[unit] || 100);
  const digits =
    unit === "mm" ? (fine && v < 100 ? 1 : 0) : fine && v < 10 ? 2 : 1;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: digits });
}
export const mm = (m) => Math.round(m * 1000).toLocaleString("pt-BR");
export const mm1 = (m) =>
  (m * 1000).toLocaleString("pt-BR", {
    maximumFractionDigits: m * 1000 < 100 ? 1 : 0,
  });
