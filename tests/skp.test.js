import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { parseSkp, skpVersion } from "../src/lib/skp/parse.js";
import { SkpSceneBuilder, genericSkpName } from "../src/lib/skp/scene.js";
import { partitionScene } from "../src/lib/model.js";

// ---- Montador de .skp sintético, no formato lido por engenharia reversa ----
const IN = 1 / 2.54; // cm -> polegadas (unidade interna do SketchUp)
const cat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const node = (tag, ...kids) => {
  const body = cat(kids);
  const head = new Uint8Array(6);
  new DataView(head.buffer).setUint16(0, tag, true);
  new DataView(head.buffer).setUint32(2, body.length, true);
  return cat([head, body]);
};
const u24 = (v) => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255]);
const u8 = (v) => new Uint8Array([v]);
const f64 = (...vs) => {
  const b = new Uint8Array(8 * vs.length);
  vs.forEach((v, i) => new DataView(b.buffer).setFloat64(8 * i, v, true));
  return b;
};
const txt = (s) => new TextEncoder().encode(s);
const idBox = (id) => node(0x5dc, node(0x5de, u24(id)));
const header = (id, material) =>
  node(
    0x7d0,
    idBox(id),
    ...(material ? [node(0x7d1, u24(material))] : []),
    node(0x7d3, u8(6)),
  );

let nextId = 1000;
/** Entidades: faces planas (listas de laços de pontos em cm) e instâncias. */
function entities(defId, faces = [], instances = [], groups = []) {
  const verts = [],
    edges = [],
    faceNodes = [];
  const vid = new Map();
  const vertex = (p) => {
    const k = p.join(",");
    if (!vid.has(k)) {
      const id = nextId++;
      vid.set(k, id);
      verts.push(
        node(0x9c4, idBox(id), node(0x9c5, f64(...p.map((v) => v * IN)))),
      );
    }
    return vid.get(k);
  };
  for (const { loops, material } of faces) {
    const loopNodes = loops.map((pts) => {
      const uses = pts.map((p, i) => {
        const a = vertex(p),
          b = vertex(pts[(i + 1) % pts.length]);
        const id = nextId++;
        edges.push(
          node(0xbb8, header(id), node(0xbb9, u24(a)), node(0xbba, u24(b))),
        );
        return node(0xfa0, node(0xfa1, u24(id)), node(0xfa2, u8(0)));
      });
      return node(0x1194, node(0x1195, ...uses));
    });
    // Normal pelo produto vetorial dos três primeiros pontos do contorno
    const [p, q, r] = loops[0];
    const u = q.map((v, k) => v - p[k]),
      w = r.map((v, k) => v - p[k]);
    const n = [
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ];
    const len = Math.hypot(...n);
    faceNodes.push(
      node(
        0xdac,
        header(nextId++, material),
        node(0xdad, f64(...n.map((v) => v / len), 0)),
        node(0xdae, ...loopNodes),
      ),
    );
  }
  const inst = (i) =>
    node(
      0x1964,
      header(nextId++, i.material),
      node(0x1965, txt(i.name || "")),
      node(0x1966, f64(...i.axes.flat(), ...i.at.map((v) => v * IN), 1)),
      node(0x1967, u24(i.def)),
    );
  return node(
    0x1388,
    header(defId),
    node(0x1389, ...verts),
    node(0x138a, ...edges),
    node(0x138b, ...faceNodes),
    node(0x138c, ...instances.map(inst)),
    node(0x138d, ...groups.map((g) => node(0x1d4c, inst(g)))),
  );
}
/** Caixa (6 faces) de w × d × h cm a partir da origem. */
function box(w, d, h, material) {
  const P = (x, y, z) => [x, y, z];
  return [
    [P(0, 0, 0), P(0, d, 0), P(w, d, 0), P(w, 0, 0)],
    [P(0, 0, h), P(w, 0, h), P(w, d, h), P(0, d, h)],
    [P(0, 0, 0), P(w, 0, 0), P(w, 0, h), P(0, 0, h)],
    [P(0, d, 0), P(0, d, h), P(w, d, h), P(w, d, 0)],
    [P(0, 0, 0), P(0, 0, h), P(0, d, h), P(0, d, 0)],
    [P(w, 0, 0), P(w, d, 0), P(w, d, h), P(w, 0, h)],
  ].map((l) => ({ loops: [l], material }));
}
const I = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const ROT90 = [
  [0, 1, 0],
  [-1, 0, 0],
  [0, 0, 1],
];
const definition = (id, name, ents) =>
  node(0x157c, ents, node(0x157d, new Uint8Array(16)), node(0x157e, txt(name)));
const utf16 = (s) => {
  const b = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) b[2 * i] = s.charCodeAt(i);
  return b;
};

function sampleSkp() {
  const MDF = 77001,
    ADESIVO = 77002;
  const defs = [
    // Testeira: componente com nome próprio, 300 × 3 × 100 cm
    definition(501, "Testeira 300", entities(501, box(300, 3, 100, ADESIVO))),
    // Balcão: grupo genérico só com faces, 100 × 60 × 75 cm (material herdado da instância)
    definition(502, "Agrupar#2", entities(502, box(100, 60, 75))),
    // Frasco de 3 cm
    definition(503, "Agrupar#9", entities(503, box(3, 3, 8))),
    // Fileira com 30 frascos
    definition(
      504,
      "Agrupar#3",
      entities(
        504,
        [],
        [],
        Array.from({ length: 30 }, (_, i) => ({
          def: 503,
          axes: I,
          at: [4 * i, 0, 0],
        })),
      ),
    ),
    // Painel 100 × 100 com furo de 20 × 20 (face com dois laços)
    definition(
      505,
      "Agrupar#5",
      entities(505, [
        {
          loops: [
            [
              [0, 0, 0],
              [100, 0, 0],
              [100, 100, 0],
              [0, 100, 0],
            ],
            [
              [40, 40, 0],
              [40, 60, 0],
              [60, 60, 0],
              [60, 40, 0],
            ],
          ],
          material: MDF,
        },
      ]),
    ),
    // Stand: grupo genérico que contém o balcão, a fileira de frascos e o painel
    definition(
      506,
      "Agrupar#1",
      entities(
        506,
        [],
        [],
        [
          { def: 502, axes: I, at: [0, 0, 0], material: MDF },
          { def: 504, axes: I, at: [200, 0, 75] },
          { def: 505, axes: I, at: [0, 300, 0] },
        ],
      ),
    ),
  ];
  const root = node(
    0x1f4,
    node(0x1f9, node(0x1770, node(0x1771, ...defs))),
    node(
      0x1f6,
      entities(
        600,
        [],
        [{ def: 501, axes: ROT90, at: [500, 0, 340], name: "" }],
        [{ def: 506, axes: I, at: [0, 0, 0] }],
      ),
    ),
    node(
      0x1f7,
      node(
        0x30d4,
        node(
          0x30d5,
          ...[
            [MDF, "MDF Branco"],
            [ADESIVO, "Adesivo"],
          ].map(([id, name]) =>
            node(
              0x32c8,
              idBox(id),
              node(0x32cc, txt(name)),
              node(
                0x32ce,
                node(0x2134, txt(`materials/${name}/thumbnail.jpg`)),
              ),
            ),
          ),
        ),
      ),
    ),
    node(
      0x1f8,
      node(
        0x3a98,
        node(
          0x3a99,
          node(0x3c8c, idBox(9001), node(0x3c8d, txt("Mobiliário"))),
        ),
      ),
    ),
  );
  const xml = (r, g, b) =>
    `<mat:material name="x" colorRed="${r}" colorGreen="${g}" colorBlue="${b}" trans="0" useTrans="0" hasTexture="0"/>`;
  const zip = zipSync({
    "model.dat": root,
    "materials/MDF Branco/material.xml": strToU8(xml(250, 250, 250)),
    "materials/Adesivo/material.xml": strToU8(xml(220, 40, 160)),
  });
  return cat([
    new Uint8Array([0xff, 0xfe, 0xff, 0x0e]),
    utf16("SketchUp Model"),
    new Uint8Array([0xff, 0xfe, 0xff, 0x0a]),
    utf16("{26.2.243}"),
    zip,
  ]);
}

test("cabeçalho do SketchUp: versão lida e arquivo estranho recusado", () => {
  assert.equal(skpVersion(sampleSkp()), "26.2.243");
  assert.throws(
    () => parseSkp(new Uint8Array(64)),
    /não é um modelo do SketchUp/,
  );
});

test(".skp lido direto: faces, furos, materiais e tags", () => {
  const m = parseSkp(sampleSkp());
  assert.equal(m.materials.length, 2);
  assert.deepEqual(m.materials[1].color, [220, 40, 160]);
  assert.equal(m.layers[0].name, "Mobiliário");
  assert.equal(m.stats.holes, 1);
  assert.equal(m.stats.failed, 0);
  // Painel com furo: 100 × 100 − 20 × 20 = 9600 cm²
  const panel = Object.values(m.definitions).find(
    (d) => d.name === "Agrupar#5",
  );
  const p = panel.meshes[0].positions;
  let area = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i],
      uy = p[i + 4] - p[i + 1];
    const vx = p[i + 6] - p[i],
      vy = p[i + 7] - p[i + 1];
    area += Math.abs(ux * vy - uy * vx) / 2;
  }
  assert.ok(Math.abs(area * 2.54 * 2.54 - 9600) < 0.5, `área ${area * 6.4516}`);
});

test("peças do SketchUp: componente com nome inteiro, frascos reunidos, medidas em metros", () => {
  const scene = new SkpSceneBuilder(parseSkp(sampleSkp())).build();
  const { parts } = partitionScene(scene, "m");
  const byLabel = (re) => parts.filter((p) => re.test(p.label));
  assert.equal(parts.length, 4, parts.map((p) => p.label).join(", "));
  const [testeira] = byLabel(/Testeira 300/);
  // Girada 90° no SketchUp: medida no eixo do próprio componente
  assert.deepEqual(
    testeira.dimensions.map((v) => Math.round(v * 1000) / 10),
    [300, 100, 3],
  );
  assert.ok(Math.abs(testeira.bounds.min[1] - 3.4) < 1e-6, "a 3,40 m do chão");
  assert.deepEqual(testeira.materialsOriginal, ["Adesivo"]);
  // Balcão: grupo genérico só com faces, material herdado da instância
  const balcao = parts.find(
    (p) =>
      Math.abs(p.dimensions[0] - 1) < 1e-6 &&
      Math.abs(p.dimensions[1] - 0.75) < 1e-6,
  );
  assert.ok(balcao, "balcão 100 × 75 × 60");
  assert.deepEqual(balcao.materialsOriginal, ["MDF Branco"]);
  // 30 frascos de 3 cm viram uma peça só (fileira de 119 cm), numa malha só
  const fileira = parts.find((p) => Math.abs(p.dimensions[0] - 1.19) < 1e-6);
  assert.ok(fileira, "frascos reunidos");
  assert.equal(fileira.meshIds.length, 1);
});

test("nomes automáticos do SketchUp não viram nome de peça", () => {
  for (const n of [
    "Agrupar#12",
    "Group#3",
    "Componente#14",
    "Shape Bender Component#1",
    "",
  ])
    assert.ok(genericSkpName(n), n);
  for (const n of ["BANQUETA BRANCA", "Testeira 300", "Estante de Aço"])
    assert.ok(!genericSkpName(n), n);
});
