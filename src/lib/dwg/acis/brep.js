// Leitor de ACIS binário (SAB) e triangulação das faces.
// Superfícies suportadas: plano, cone/cilindro, esfera e toro. Curvas: reta e elipse/círculo.
// Faces com superfícies livres (spline) são contadas e deixadas de fora, nunca inventadas.
import { ShapeUtils, Vector2 } from "three";

const T = {
  INT: 0x04,
  DOUBLE: 0x06,
  STR: 0x07,
  TRUE: 0x0a,
  FALSE: 0x0b,
  PTR: 0x0c,
  TYPE: 0x0d,
  TYPE_EX: 0x0e,
  SUB_START: 0x0f,
  SUB_END: 0x10,
  END: 0x11,
  LSTR: 0x12,
  POS: 0x13,
  VEC: 0x14,
  ENUM: 0x15,
  INTERVAL: 0x16,
};

/** Lê o fluxo SAB: lista de entidades { type, f: [valores] } indexada pela posição. */
export function parseSab(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 15 + 16; // "ACIS BinaryFile" + versão, registros, entidades, histórico
  const tok = () => {
    const t = bytes[i++];
    switch (t) {
      case T.INT:
      case T.ENUM: {
        const x = v.getInt32(i, true);
        i += 4;
        return { t, x };
      }
      case T.PTR: {
        const x = v.getInt32(i, true);
        i += 4;
        return { t, x };
      }
      case T.DOUBLE: {
        const x = v.getFloat64(i, true);
        i += 8;
        return { t, x };
      }
      case T.STR:
      case T.TYPE:
      case T.TYPE_EX: {
        const n = bytes[i++];
        const x = String.fromCharCode(...bytes.subarray(i, i + n));
        i += n;
        return { t, x };
      }
      case T.LSTR: {
        const n = v.getUint32(i, true);
        i += 4;
        const x = String.fromCharCode(
          ...bytes.subarray(i, i + Math.min(n, 512)),
        );
        i += n;
        return { t, x };
      }
      case T.POS:
      case T.VEC: {
        const x = [
          v.getFloat64(i, true),
          v.getFloat64(i + 8, true),
          v.getFloat64(i + 16, true),
        ];
        i += 24;
        return { t, x };
      }
      case T.INTERVAL: {
        const x = [v.getFloat64(i, true), v.getFloat64(i + 8, true)];
        i += 16;
        return { t, x };
      }
      case T.TRUE:
        return { t, x: true };
      case T.FALSE:
        return { t, x: false };
      case T.SUB_START:
      case T.SUB_END:
      case T.END:
        return { t };
      default:
        throw Error(`Marcador SAB desconhecido 0x${(t ?? 0).toString(16)}.`);
    }
  };
  for (let k = 0; k < 6; k++) tok(); // produto, versão ASM, data, unidades e tolerâncias
  const entities = [];
  let names = [],
    fields = [],
    depth = 0;
  while (i < bytes.length) {
    const { t, x } = tok();
    if (t === T.TYPE_EX) {
      if (!fields.length) names.push(x);
      else fields.push({ t, x });
      continue;
    }
    if (t === T.TYPE && !fields.length && depth === 0) {
      names.push(x);
      const type = names.join("-");
      if (type.startsWith("End-of-")) break;
      continue;
    }
    if (t === T.SUB_START) depth++;
    if (t === T.SUB_END) depth--;
    if (t === T.END && depth <= 0) {
      entities.push({ type: names.join("-"), f: fields });
      names = [];
      fields = [];
      depth = 0;
      continue;
    }
    fields.push({ t, x });
  }
  return entities;
}

// ---------- vetores ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const ortho = (n) =>
  norm(cross(Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], n));

// Campos por tipo (ASM/ACIS 7+): todos começam com atributo e histórico
const ptrs = (e) => e.f.filter((x) => x.t === T.PTR).map((x) => x.x);
const vecs = (e) =>
  e.f.filter((x) => x.t === T.POS || x.t === T.VEC).map((x) => x.x);
const nums = (e) => e.f.filter((x) => x.t === T.DOUBLE).map((x) => x.x);
const bools = (e) =>
  e.f.filter((x) => x.t === T.TRUE || x.t === T.FALSE).map((x) => x.x);

const STEP = (12 * Math.PI) / 180; // resolução angular das curvas e superfícies

/**
 * Triangula um sólido SAB. Retorna { triangles: number[], faces, skipped: {tipo: n} }.
 * As coordenadas saem no sistema do desenho (transformação do corpo aplicada).
 */
export function tessellateSab(bytes) {
  const ents = parseSab(bytes);
  const at = (k) => (k >= 0 ? ents[k] : null);
  const kind = (e) =>
    e?.type.replace(/^.*?-?(\w+)-(surface|curve)$/, "$1-$2") ?? "";
  const skipped = {};
  const out = [];
  let faces = 0;

  const bodies = ents.map((e, k) => [e, k]).filter(([e]) => e.type === "body");
  for (const [body] of bodies) {
    // body: atributo, (−), lump, wire, transform
    const [, , lumpRef, , transformRef] = ptrs(body);
    const tr = at(transformRef);
    let apply = (p) => p;
    if (tr && tr.type === "transform") {
      const [r0, r1, r2, t] = vecs(tr);
      const s = nums(tr)[0] || 1;
      apply = (p) =>
        add(mul(add(add(mul(r0, p[0]), mul(r1, p[1])), mul(r2, p[2])), s), t);
    }
    for (const lump of chain(lumpRef, 2)) {
      for (const shell of chain(ptrs(lump)[3], 2)) {
        for (const face of chain(ptrs(shell)[4], 2)) {
          const [, , , loopRef, , , surfRef] = ptrs(face);
          const surf = at(surfRef);
          const loops = [];
          for (const loop of chain(loopRef, 2)) loops.push(loopPoints(loop));
          const type = kind(surf);
          const tri =
            type === "plane-surface"
              ? planeFace(surf, loops)
              : type === "cone-surface"
                ? coneFace(surf, loops)
                : type === "sphere-surface"
                  ? sphereFace(surf, loops)
                  : type === "torus-surface"
                    ? torusFace(surf, loops)
                    : null;
          if (!tri) {
            skipped[type || "sem superfície"] =
              (skipped[type || "sem superfície"] || 0) + 1;
            continue;
          }
          faces++;
          for (let k = 0; k < tri.length; k++) out.push(...apply(tri[k]));
        }
      }
    }
  }
  return { triangles: out, faces, skipped };

  // ----- topologia -----
  // Percorre uma lista ligada (ponteiro "próximo" na posição `slot`) sem repetir entidades:
  // um arquivo com ponteiros em ciclo não trava o leitor.
  function* chain(first, slot) {
    const seen = new Set();
    for (
      let k = first;
      k >= 0 && !seen.has(k) && ents[k];
      k = ptrs(ents[k])[slot]
    ) {
      seen.add(k);
      yield ents[k];
    }
  }

  function loopPoints(loop) {
    const pts = [];
    // coedge: atributo, (−), próximo, anterior, parceiro, aresta, sentido, loop
    for (const co of chain(ptrs(loop)[3], 2)) {
      const edgeRef = ptrs(co)[5];
      const reversed = bools(co)[0] === true;
      let seg = edgePoints(at(edgeRef));
      if (reversed) seg = seg.slice().reverse();
      for (const p of seg)
        if (!pts.length || len(sub(p, pts[pts.length - 1])) > 1e-9) pts.push(p);
    }
    if (pts.length > 1 && len(sub(pts[0], pts[pts.length - 1])) < 1e-9)
      pts.pop();
    return pts;
  }

  function vertexPoint(vx) {
    const p = at(ptrs(vx)[3]);
    return p ? vecs(p)[0] : null;
  }

  function edgePoints(edge) {
    if (!edge) return [];
    // aresta: atributo, (−), vértice inicial, vértice final, coedge, curva; parâmetros t0, t1
    const [, , v0, v1, , curveRef] = ptrs(edge);
    const p0 = vertexPoint(at(v0)),
      p1 = vertexPoint(at(v1));
    const [t0, t1] = nums(edge);
    const reversed = bools(edge)[0] === true;
    const curve = at(curveRef);
    if (!curve || !p0 || !p1) return [p0, p1].filter(Boolean);
    const type = kind(curve);
    if (type === "ellipse-curve") {
      const [center, normal, major] = vecs(curve);
      const ratio = nums(curve)[0] || 1;
      const n = norm(normal),
        minor = mul(cross(n, major), ratio);
      // O parâmetro da aresta é o da curva (negado se a aresta é invertida)
      let a0 = reversed ? -t1 : t0,
        a1 = reversed ? -t0 : t1;
      if (!Number.isFinite(a0) || !Number.isFinite(a1)) return [p0, p1];
      const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / STEP));
      const pts = [];
      for (let k = 0; k <= steps; k++) {
        const a = a0 + ((a1 - a0) * k) / steps;
        pts.push(
          add(add(center, mul(major, Math.cos(a))), mul(minor, Math.sin(a))),
        );
      }
      if (reversed) pts.reverse();
      pts[0] = p0;
      pts[pts.length - 1] = p1;
      return pts;
    }
    return [p0, p1]; // reta (e, por ora, curvas livres aproximadas pela corda)
  }

  // ----- faces -----
  function planeFace(surf, loops) {
    const [root, normal, udir] = vecs(surf);
    const n = norm(normal),
      u = udir && len(udir) > 1e-12 ? norm(udir) : ortho(n),
      w = cross(n, u);
    const to2 = (p) => [dot(sub(p, root), u), dot(sub(p, root), w)];
    return triangulate2d(
      loops,
      to2,
      (q) => add(add(root, mul(u, q[0])), mul(w, q[1])),
      null,
    );
  }

  // Cone/cilindro: desenrola em (ângulo × raio, altura) e subdivide até a curvatura ficar suave
  function coneFace(surf, loops) {
    const [center, axis, major] = vecs(surf);
    const ratio = nums(surf)[0] || 1;
    const [sinA, cosA] = nums(surf).slice(1, 3);
    const n = norm(axis),
      r0 = len(major),
      x = norm(major),
      y = mul(norm(cross(n, major)), ratio);
    const tanA = cosA ? (sinA || 0) / cosA : 0;
    const radiusAt = (h) => r0 + h * tanA;
    const toParam = (p) => {
      const d = sub(p, center),
        h = dot(d, n);
      return [Math.atan2(dot(d, y), dot(d, x)), h];
    };
    const fromParam = ([a, h]) => {
      const r = radiusAt(h);
      return add(
        add(center, mul(n, h)),
        add(mul(x, r * Math.cos(a)), mul(norm(y), r * Math.sin(a) * ratio)),
      );
    };
    return periodicFace(loops, toParam, fromParam, r0);
  }

  function sphereFace(surf, loops) {
    const [center] = vecs(surf);
    const r = nums(surf)[0];
    const pole = vecs(surf)[2] ? norm(vecs(surf)[2]) : [0, 0, 1];
    const x = vecs(surf)[1] ? norm(vecs(surf)[1]) : ortho(pole),
      y = cross(pole, x);
    const toParam = (p) => {
      const d = norm(sub(p, center));
      return [
        Math.atan2(dot(d, y), dot(d, x)),
        Math.asin(Math.max(-1, Math.min(1, dot(d, pole)))),
      ];
    };
    const fromParam = ([a, b]) =>
      add(
        center,
        mul(
          add(
            add(
              mul(x, Math.cos(b) * Math.cos(a)),
              mul(y, Math.cos(b) * Math.sin(a)),
            ),
            mul(pole, Math.sin(b)),
          ),
          Math.abs(r),
        ),
      );
    return periodicFace(loops, toParam, fromParam, Math.abs(r), true);
  }

  function torusFace(surf, loops) {
    const [center, normal] = vecs(surf);
    const [R, r] = nums(surf);
    const n = norm(normal),
      x = vecs(surf)[2] ? norm(vecs(surf)[2]) : ortho(n),
      y = cross(n, x);
    const toParam = (p) => {
      const d = sub(p, center),
        a = Math.atan2(dot(d, y), dot(d, x));
      const ring = add(mul(x, Math.cos(a)), mul(y, Math.sin(a)));
      const q = sub(d, mul(ring, R));
      return [a, Math.atan2(dot(q, n), dot(q, ring))];
    };
    const fromParam = ([a, b]) => {
      const ring = add(mul(x, Math.cos(a)), mul(y, Math.sin(a)));
      return add(
        center,
        add(
          mul(ring, R + Math.abs(r) * Math.cos(b)),
          mul(n, Math.abs(r) * Math.sin(b)),
        ),
      );
    };
    return periodicFace(loops, toParam, fromParam, R);
  }

  /**
   * Superfície periódica no 1º parâmetro (ângulo). Loops que dão a volta completa no eixo
   * (bordas de um cilindro inteiro) viram uma faixa cortada numa costura; os demais são
   * polígonos comuns no plano dos parâmetros. Depois os triângulos são subdivididos.
   */
  function periodicFace(
    loops,
    toParam,
    fromParam,
    radius,
    doublePeriodic = false,
  ) {
    const unwrap = (pts) => {
      const q = [];
      let off = 0,
        prev = null;
      for (const p of pts) {
        const [a, b] = toParam(p);
        if (prev !== null) {
          let d = a + off - prev;
          while (d > Math.PI) {
            off -= 2 * Math.PI;
            d -= 2 * Math.PI;
          }
          while (d < -Math.PI) {
            off += 2 * Math.PI;
            d += 2 * Math.PI;
          }
        }
        prev = a + off;
        q.push([a + off, b]);
      }
      return q;
    };
    const params = loops.filter((l) => l.length >= 2).map(unwrap);
    const winding = [],
      plain = [];
    for (const q of params) {
      const total =
        q[q.length - 1][0] - q[0][0] + wrapDelta(q[q.length - 1][0], q[0][0]);
      (Math.abs(total) > Math.PI ? winding : plain).push(q);
    }
    let polygons;
    if (winding.length === 2) {
      // Faixa entre duas bordas circulares: costura em ângulo comum
      const strip = winding.map((q) => {
        const asc = q[q.length - 1][0] > q[0][0] ? q : q.slice().reverse();
        const base = asc[0][0];
        const cut = asc.map(([a, b]) => [a - base, b]);
        return { pts: cut, base };
      });
      const base = strip[0].base;
      const norm2pi = (q, b0) =>
        q
          .map(([a, b]) => [a + b0 - base, b])
          .map(([a, b]) => [
            ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
            b,
          ]);
      const A = norm2pi(strip[0].pts, strip[0].base).sort(
        (p, q) => p[0] - q[0],
      );
      const B = norm2pi(strip[1].pts, strip[1].base).sort(
        (p, q) => p[0] - q[0],
      );
      // Bordas de cilindro/cone têm altura constante: fecha cada uma na costura (0 e 2π)
      const close = (q) => [
        ...(q[0][0] > 1e-9 ? [[0, q[0][1]]] : []),
        ...q,
        [2 * Math.PI, q[0][1]],
      ];
      const outer = [...close(A), ...close(B).reverse()];
      polygons = [[outer.map(([a, b]) => [a + base, b]), ...plain]];
    } else if (winding.length === 0 && plain.length) {
      polygons = [plain];
    } else if (winding.length === 1 && doublePeriodic) {
      // Calota de esfera: fecha no polo
      const q = winding[0].slice().sort((p, r) => p[0] - r[0]);
      const poleB =
        q.reduce((s, p) => s + p[1], 0) / q.length > 0
          ? Math.PI / 2
          : -Math.PI / 2;
      polygons = [
        [[...q, [q[q.length - 1][0], poleB], [q[0][0], poleB]], ...plain],
      ];
    } else return null;
    const scale = [radius || 1, 1];
    const tris = [];
    for (const rings of polygons) {
      const scaled = rings.map((r) => r.map(([a, b]) => [a * scale[0], b]));
      const flat = triangulate2d(
        scaled,
        (p) => p,
        (q) => q,
        true,
      );
      if (!flat) continue;
      for (let k = 0; k < flat.length; k += 3) {
        const t = [flat[k], flat[k + 1], flat[k + 2]].map(([a, b]) => [
          a / scale[0],
          b,
        ]);
        subdivide(t, 0, tris, fromParam);
      }
    }
    return tris.length ? tris : null;
  }
}

const wrapDelta = (a, b) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

// Divide triângulos no espaço dos parâmetros até o ângulo de cada lado ficar abaixo do passo
function subdivide(t, depth, out, fromParam) {
  const span = Math.max(
    Math.abs(t[0][0] - t[1][0]),
    Math.abs(t[1][0] - t[2][0]),
    Math.abs(t[2][0] - t[0][0]),
  );
  if (span <= STEP || depth > 6) {
    out.push(fromParam(t[0]), fromParam(t[1]), fromParam(t[2]));
    return;
  }
  // Divide o lado mais longo em ângulo
  const d = [0, 1, 2].map((k) => Math.abs(t[k][0] - t[(k + 1) % 3][0]));
  const k = d.indexOf(Math.max(...d));
  const a = t[k],
    b = t[(k + 1) % 3],
    c = t[(k + 2) % 3];
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  subdivide([a, m, c], depth + 1, out, fromParam);
  subdivide([m, b, c], depth + 1, out, fromParam);
}

/**
 * Triangula polígonos com furos. `to2` leva ao plano 2D, `from2` volta.
 * Com `flatOut`, devolve os pontos 2D (para subdividir depois).
 */
function triangulate2d(loops, to2, from2, flatOut) {
  const rings = loops.filter((l) => l.length >= 3).map((l) => l.map(to2));
  if (!rings.length) return null;
  const area = (r) =>
    r.reduce(
      (s, p, i) =>
        s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1],
      0,
    ) / 2;
  rings.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  const [outer, ...holes] = rings;
  const contour = outer.map(([x, y]) => new Vector2(x, y));
  const holeVecs = holes.map((h) => h.map(([x, y]) => new Vector2(x, y)));
  let faces;
  try {
    faces = ShapeUtils.triangulateShape(contour, holeVecs);
  } catch {
    return null;
  }
  const all = [...outer, ...holes.flat()];
  const out = [];
  for (const f of faces)
    for (const k of f) out.push(flatOut ? all[k] : from2(all[k]));
  return out.length ? out : null;
}
