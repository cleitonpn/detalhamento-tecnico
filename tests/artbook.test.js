import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  markerLabel,
  newArt,
  autoZones,
  wallFaces,
  buildArtSheet,
} from "../src/lib/artbook.js";
import { sheetSvg } from "../src/lib/sheet.js";

// Triângulos de uma caixa entre `min` e `max` (referencial da peça, metros)
function boxTris(min, max) {
  const g = new THREE.BoxGeometry(
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ).toNonIndexed();
  g.translate(
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  );
  return Array.from(g.attributes.position.array);
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// Parede reta de 3 m × 2,5 m × 10 cm; referencial da peça = mundo
const wall = {
  id: "parede",
  label: "Parede de fundo",
  dimensions: [3, 2.5, 0.1],
  bounds: { min: [0, 0, 0], max: [3, 2.5, 0.1] },
  frame: {
    origin: [0, 0, 0],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
  },
};
const wallFacesList = wallFaces(boxTris([0, 0, 0], [3, 2.5, 0.1]));
const front = wallFacesList.find((f) => f.nz > 0.9);
const back = wallFacesList.find((f) => f.nz < -0.9);
const box = (id, label, min, max) => ({ id, label, bounds: { min, max } });

test("marcadores seguem o Arte Guide: A … Z, AA, AB", () => {
  assert.deepEqual([0, 1, 25, 26, 27].map(markerLabel), [
    "A",
    "B",
    "Z",
    "AA",
    "AB",
  ]);
});

test("parede reta: frente e verso de 3 × 2,5 m são as maiores faces", () => {
  assert.equal(wallFacesList.length, 2); // frente e verso; as bordas de 10 cm ficam de fora
  assert.ok(near(front.w, 3) && near(front.h, 2.5));
  assert.ok(near(back.w, 3) && near(back.h, 2.5));
});

test("arte nasce com o tamanho da face e sangria de 3 cm", () => {
  const art = newArt(wall, 0, front, "Face 1");
  assert.equal(art.marker, "A");
  assert.equal(art.w, 300);
  assert.equal(art.h, 250);
  assert.equal(art.bleed, 3);
});

test("TV na frente vira interferência, medida a partir do canto superior esquerdo de quem olha", () => {
  const tv = box("tv", "TV 55", [1, 1.2, 0.1], [2.2, 1.9, 0.16]);
  const longe = box("mesa", "Mesa", [1, 0, 1.5], [2, 0.75, 2.3]);
  const piso = box("piso", "Piso", [-1, -0.1, -1], [6, 0, 6]);
  const zones = autoZones(newArt(wall, 0, front), wall, [
    wall,
    tv,
    longe,
    piso,
  ]);
  assert.equal(zones.length, 1);
  const [z] = zones;
  assert.equal(z.label, "TV 55");
  // Olhando a frente (+z), a esquerda é x = 0: a TV começa a 100 cm da esquerda e 60 cm do topo
  assert.deepEqual([z.x, z.y, z.w, z.h], [100, 60, 120, 70]);
});

test("no verso só contam peças de trás, vistas espelhadas", () => {
  const prateleira = box("p", "Prateleira", [0.2, 1, -0.3], [0.8, 1.04, 0]);
  const tv = box("tv", "TV", [1, 1.2, 0.1], [2.2, 1.9, 0.16]);
  const zones = autoZones(newArt(wall, 0, back), wall, [prateleira, tv]);
  assert.deepEqual(
    zones.map((z) => z.label),
    ["Prateleira"],
  );
  assert.equal(zones[0].x, 220); // quem olha o verso vê a parede espelhada: 3 m − 0,8 m
});

test("parede em L: cada trecho é uma face, e a TV entra só na face onde está", () => {
  // Fundo (x 0–6, z 0–0,1) e lateral esquerda (x 0–0,1, z 0–4), 3 m de altura
  const tris = [
    ...boxTris([0, 0, 0], [6, 3, 0.1]),
    ...boxTris([0, 0, 0.1], [0.1, 3, 4]),
  ];
  const L = {
    ...wall,
    id: "L",
    dimensions: [6, 3, 4],
    bounds: { min: [0, 0, 0], max: [6, 3, 4] },
  };
  const faces = wallFaces(tris);
  const fundoInterno = faces.find((f) => f.nz > 0.9 && near(f.d, 0.1));
  const lateralInterna = faces.find((f) => f.nx > 0.9 && near(f.d, 0.1));
  assert.ok(fundoInterno && lateralInterna);
  const tv = box("tv", "TV", [2, 1.2, 0.1], [3, 1.8, 0.12]);
  assert.deepEqual(
    autoZones(newArt(L, 0, fundoInterno), L, [tv]).map((z) => z.label),
    ["TV"],
  );
  assert.deepEqual(autoZones(newArt(L, 0, lateralInterna), L, [tv]), []);
});

test("revestimento fino colado na face não vira interferência; TV fina sim", () => {
  const painel = box("painel", "Painel 91", [0, 0, 0.1], [0.91, 2.5, 0.11]);
  const tvFina = box("tv", "TV 96x46", [1, 1.2, 0.1], [1.96, 1.66, 0.12]);
  const zones = autoZones(newArt(wall, 0, front), wall, [painel, tvFina]);
  assert.deepEqual(
    zones.map((z) => z.label),
    ["TV 96x46"],
  );
});

test("gabarito traz medidas, sangria, selo e interferência", () => {
  const art = {
    ...newArt(wall, 1, front, "Face 1 · 300 × 250 cm (frente)"),
    zones: [{ id: "z", label: "TV", x: 100, y: 60, w: 120, h: 70 }],
  };
  const svg = sheetSvg(
    buildArtSheet({
      project: { name: "Stand", revision: 0 },
      art,
      part: wall,
      iso: null,
      preview: true,
    }),
  );
  assert.match(svg, /300 cm/);
  assert.match(svg, /250 cm/);
  assert.match(svg, /SANGRIA 3 cm/);
  assert.match(svg, />B</);
  assert.match(svg, /\(120 × 70 cm\)/);
  assert.match(svg, /Com sangria: 306 × 256 cm/);
});

test("face padrão é a que olha para o centro do stand", async () => {
  const { defaultFace } = await import("../src/lib/artbook.js");
  // Parede no fundo de um stand de 6 × 4 m: o centro fica à frente (+z)
  const piso = box("piso", "Piso", [-1.5, -0.1, 0], [4.5, 0, 4]);
  const i = defaultFace(wallFacesList, wall, [wall, piso]);
  assert.ok(wallFacesList[i].nz > 0.9);
});

test("faces se orientam pela espessura, mesmo com triângulos invertidos", () => {
  // Mesma parede com metade dos triângulos em ordem invertida (como sai do leitor de sólidos)
  const tris = boxTris([0, 0, 0], [3, 2.5, 0.1]);
  for (let t = 0; t < tris.length; t += 18) {
    for (let k = 0; k < 3; k++)
      [tris[t + 3 + k], tris[t + 6 + k]] = [tris[t + 6 + k], tris[t + 3 + k]];
  }
  const faces = wallFaces(tris);
  const f = faces.find(
    (x) => Math.abs(x.nz) > 0.9 && Math.abs(x.d - (x.nz > 0 ? 0.1 : 0)) < 1e-6,
  );
  assert.ok(
    faces.some((x) => x.nz > 0.9 && Math.abs(x.d - 0.1) < 1e-6),
    "frente em z = 0,1 olhando para +z",
  );
  assert.ok(
    faces.some((x) => x.nz < -0.9 && Math.abs(x.d) < 1e-6),
    "verso em z = 0 olhando para −z",
  );
  assert.ok(f);
});

test("camadas empilhadas do mesmo objeto viram uma interferência só", async () => {
  const { mergeZones } = await import("../src/lib/artbook.js");
  const zones = mergeZones([
    { id: "a", label: "Peça 18", x: 377.2, y: 118.3, w: 103.5, h: 58.5 },
    { id: "b", label: "Peça 19", x: 379.1, y: 120.2, w: 99.7, h: 53 },
    { id: "c", label: "Peça 20", x: 377.2, y: 118.3, w: 103.5, h: 58.5 },
    { id: "d", label: "Balcão", x: 518.2, y: 198, w: 50, h: 100 },
  ]);
  assert.equal(zones.length, 2);
  assert.match(zones[0].label, /\(\+2\)$/);
  assert.deepEqual([zones[0].w, zones[0].h], [103.5, 58.5]);
});
