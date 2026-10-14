import test from "node:test";
import assert from "node:assert/strict";
import { parseSab, tessellateSab } from "../src/lib/dwg/acis/brep.js";
import { decompress } from "../src/lib/dwg/acis/extract.js";

// ---------- gerador mínimo de SAB para os testes ----------
const P = (x) => ({ t: 0x0c, x }),
  I = (x) => ({ t: 0x04, x }),
  D = (x) => ({ t: 0x06, x });
const POS = (x) => ({ t: 0x13, x }),
  VEC = (x) => ({ t: 0x14, x }),
  B = (x) => ({ t: x ? 0x0a : 0x0b });
const S = (x) => ({ t: 0x07, x });

function writeSab(entities) {
  const out = [];
  const u8 = (n) => out.push(n & 0xff);
  const i32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(n);
    out.push(...b);
  };
  const f64 = (n) => {
    const b = Buffer.alloc(8);
    b.writeDoubleLE(n);
    out.push(...b);
  };
  const str = (tag, s) => {
    u8(tag);
    u8(s.length);
    out.push(...Buffer.from(s, "latin1"));
  };
  const field = ({ t, x }) => {
    if (t === 0x04 || t === 0x0c) {
      u8(t);
      i32(x);
    } else if (t === 0x06) {
      u8(t);
      f64(x);
    } else if (t === 0x07) str(t, x);
    else if (t === 0x13 || t === 0x14) {
      u8(t);
      x.forEach(f64);
    } else u8(t);
  };
  out.push(...Buffer.from("ACIS BinaryFile", "latin1"));
  [21800, 0, entities.length, 0].forEach(i32);
  [S("teste"), S("ASM 229"), S("hoje"), D(1), D(1e-6), D(1e-10)].forEach(field);
  for (const [names, fields] of entities) {
    names.slice(0, -1).forEach((n) => str(0x0e, n));
    str(0x0d, names[names.length - 1]);
    fields.forEach(field);
    u8(0x11);
  }
  ["End", "of", "ASM"].forEach((n) => str(0x0e, n));
  str(0x0d, "data");
  return new Uint8Array(out);
}

// Monta um corpo a partir de faces; cada face tem loops de arestas (curvas e vértices)
function body(faces, transform) {
  const ents = [];
  const add = (names, fields) => ents.push([names, fields]) - 1;
  const point = (p) => add(["point"], [P(-1), I(-1), P(-1), POS(p)]);
  const vertex = (p) =>
    add(["vertex"], [P(-1), I(-1), P(-1), P(-1), I(1), P(point(p))]);
  // Como nos arquivos reais: asmheader é a entidade 0; depois corpo, lump, shell e transformação
  ents.push([["asmheader"], [P(-1), I(-1), S("229")]], null, null, null, null);
  const faceIdx = [];
  for (const f of faces) {
    const surf = add(f.surface[0], f.surface[1]);
    const face = add(["face"], []);
    const loops = f.loops.map((edges) => {
      const loop = add(["loop"], []);
      const coedges = edges.map(() => add(["coedge"], []));
      edges.forEach((e, k) => {
        const curve = add(e.curve[0], e.curve[1]);
        const v0 = vertex(e.from),
          v1 = e.closed ? v0 : vertex(e.to);
        const edge = add(
          ["edge"],
          [
            P(-1),
            I(-1),
            P(-1),
            P(v0),
            D(e.t0 ?? 0),
            P(v1),
            D(e.t1 ?? 1),
            P(coedges[k]),
            P(curve),
            B(false),
            S("unknown"),
          ],
        );
        ents[coedges[k]][1] = [
          P(-1),
          I(-1),
          P(-1),
          P(coedges[(k + 1) % edges.length]),
          P(coedges[(k + edges.length - 1) % edges.length]),
          P(-1),
          P(edge),
          B(false),
          P(loop),
          I(0),
          P(-1),
        ];
      });
      ents[loop][1] = [P(-1), I(-1), P(-1), P(-1), P(coedges[0]), P(face)];
      return loop;
    });
    loops.forEach((l, k) => (ents[l][1][3] = P(loops[k + 1] ?? -1)));
    ents[face][1] = [
      P(-1),
      I(-1),
      P(-1),
      P(-1),
      P(loops[0]),
      P(3),
      P(-1),
      P(surf),
      B(false),
      B(false),
    ];
    faceIdx.push(face);
  }
  faceIdx.forEach((f, k) => (ents[f][1][3] = P(faceIdx[k + 1] ?? -1)));
  ents[1] = [["body"], [P(-1), I(-1), P(-1), P(2), P(-1), P(4)]];
  ents[2] = [["lump"], [P(-1), I(-1), P(-1), P(-1), P(3), P(1)]];
  ents[3] = [
    ["shell"],
    [P(-1), I(-1), P(-1), P(-1), P(-1), P(faceIdx[0]), P(-1), P(2)],
  ];
  const [r0, r1, r2, t] = transform ?? [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0, 0, 0],
  ];
  ents[4] = [
    ["transform"],
    [
      P(-1),
      I(-1),
      VEC(r0),
      VEC(r1),
      VEC(r2),
      VEC(t),
      D(1),
      B(true),
      B(false),
      B(false),
    ],
  ];
  return writeSab(ents);
}

const plane = (root, normal, u) => [
  ["plane", "surface"],
  [
    P(-1),
    I(-1),
    P(-1),
    POS(root),
    VEC(normal),
    VEC(u),
    B(false),
    B(false),
    B(false),
    B(false),
    B(false),
  ],
];
const line = (a, b) => ({
  from: a,
  to: b,
  curve: [
    ["straight", "curve"],
    [
      P(-1),
      I(-1),
      P(-1),
      POS(a),
      VEC(b.map((v, i) => v - a[i])),
      B(false),
      B(false),
    ],
  ],
});
const quad = (a, b, c, d) => [line(a, b), line(b, c), line(c, d), line(d, a)];

function bbox(tri) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tri.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], tri[i + k]);
      max[k] = Math.max(max[k], tri[i + k]);
    }
  return { min, max };
}

test("cubo ACIS com transformação: 6 faces, 12 triângulos, posição do corpo aplicada", () => {
  const c = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const faces = [
    {
      surface: plane(c[0], [0, 0, -1], [1, 0, 0]),
      loops: [quad(c[0], c[3], c[2], c[1])],
    },
    {
      surface: plane(c[4], [0, 0, 1], [1, 0, 0]),
      loops: [quad(c[4], c[5], c[6], c[7])],
    },
    {
      surface: plane(c[0], [0, -1, 0], [1, 0, 0]),
      loops: [quad(c[0], c[1], c[5], c[4])],
    },
    {
      surface: plane(c[3], [0, 1, 0], [1, 0, 0]),
      loops: [quad(c[3], c[7], c[6], c[2])],
    },
    {
      surface: plane(c[0], [-1, 0, 0], [0, 1, 0]),
      loops: [quad(c[0], c[4], c[7], c[3])],
    },
    {
      surface: plane(c[1], [1, 0, 0], [0, 1, 0]),
      loops: [quad(c[1], c[2], c[6], c[5])],
    },
  ];
  const sab = body(faces, [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [10, 0, 0],
  ]);
  const r = tessellateSab(sab);
  assert.equal(r.faces, 6);
  assert.equal(r.triangles.length / 9, 12);
  const { min, max } = bbox(r.triangles);
  assert.deepEqual(min, [10, 0, 0]);
  assert.deepEqual(max, [11, 1, 1]);
});

test("cilindro ACIS: tampas circulares e lateral curva ficam sobre o raio", () => {
  const R = 0.05,
    H = 1,
    TAU = 2 * Math.PI;
  const circle = (z, normal) => ({
    from: [R, 0, z],
    closed: true,
    t0: 0,
    t1: TAU,
    curve: [
      ["ellipse", "curve"],
      [
        P(-1),
        I(-1),
        P(-1),
        POS([0, 0, z]),
        VEC(normal),
        VEC([R, 0, 0]),
        D(1),
        B(false),
        B(false),
      ],
    ],
  });
  const cone = [
    ["cone", "surface"],
    [
      P(-1),
      I(-1),
      P(-1),
      POS([0, 0, 0]),
      VEC([0, 0, 1]),
      VEC([R, 0, 0]),
      D(1),
      B(false),
      B(false),
      D(0),
      D(1),
      D(R),
      B(false),
    ],
  ];
  const faces = [
    {
      surface: plane([0, 0, 0], [0, 0, -1], [1, 0, 0]),
      loops: [[circle(0, [0, 0, 1])]],
    },
    {
      surface: plane([0, 0, H], [0, 0, 1], [1, 0, 0]),
      loops: [[circle(H, [0, 0, 1])]],
    },
    { surface: cone, loops: [[circle(0, [0, 0, 1])], [circle(H, [0, 0, 1])]] },
  ];
  const r = tessellateSab(body(faces));
  assert.equal(r.faces, 3);
  assert.deepEqual(r.skipped, {});
  const t = r.triangles;
  const { min, max } = bbox(t);
  assert.ok(Math.abs(max[2] - H) < 1e-9 && Math.abs(min[2]) < 1e-9);
  // Todo vértice da lateral está no raio; as tampas ficam dentro dele
  let onRadius = 0;
  for (let i = 0; i < t.length; i += 3) {
    const rr = Math.hypot(t[i], t[i + 1]);
    assert.ok(rr <= R + 1e-9);
    if (Math.abs(rr - R) < 1e-9) onRadius++;
  }
  assert.ok(onRadius > 60, `${onRadius} vértices no raio`);
  // A lateral cobre a volta inteira: há pontos em todos os quadrantes a meia altura
  const quadrants = new Set();
  for (let i = 0; i < t.length; i += 3)
    if (t[i + 2] > 0.2 && t[i + 2] < 0.8)
      quadrants.add(`${Math.sign(t[i])},${Math.sign(t[i + 1])}`);
  assert.ok(quadrants.size >= 4);
});

test("superfície livre (spline) é contada e não vira geometria inventada", () => {
  const c = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ];
  const spline = [
    ["spline", "surface"],
    [P(-1), I(-1), P(-1)],
  ];
  const r = tessellateSab(body([{ surface: spline, loops: [quad(...c)] }]));
  assert.equal(r.triangles.length, 0);
  assert.deepEqual(r.skipped, { "spline-surface": 1 });
});

test("leitor do SAB reconhece tipos compostos e o fim dos dados", () => {
  const ents = parseSab(
    body([
      {
        surface: plane([0, 0, 0], [0, 0, 1], [1, 0, 0]),
        loops: [quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0])],
      },
    ]),
  );
  assert.ok(ents.some((e) => e.type === "plane-surface"));
  assert.ok(ents.some((e) => e.type === "straight-curve"));
  assert.ok(!ents.some((e) => e.type.startsWith("End")));
});

test("descompressão R2004: literais e cópia com sobreposição", () => {
  // 0x01 => 4 literais "ABCD"; opcode 0x70 => copia (0x70>>4)-1 = 6 bytes, com
  // deslocamento (0<<2)|((0x70&0x0c)>>2) = 0, isto é, repete o último byte; 0x11 encerra
  const src = new Uint8Array([0x01, 0x41, 0x42, 0x43, 0x44, 0x70, 0x00, 0x11]);
  const out = decompress(src, 10);
  assert.equal(Buffer.from(out).toString("latin1"), "ABCDDDDDDD");
});

test("ponteiros em ciclo no arquivo não travam o leitor", () => {
  const c = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ];
  const sab = Buffer.from(
    body([{ surface: plane(c[0], [0, 0, 1], [1, 0, 0]), loops: [quad(...c)] }]),
  );
  const faceIndex = parseSab(new Uint8Array(sab)).findIndex(
    (e) => e.type === "face",
  );
  // Campos da face: PTR atributo, INT histórico, PTR, PTR próximo (5 bytes cada) — aponta para ela mesma
  const marker = Buffer.from([0x0d, 4, ...Buffer.from("face", "latin1")]);
  const next = sab.indexOf(marker) + marker.length + 15;
  assert.equal(sab[next], 0x0c);
  sab.writeInt32LE(faceIndex, next + 1);
  const r = tessellateSab(new Uint8Array(sab));
  assert.equal(r.faces, 1);
});
