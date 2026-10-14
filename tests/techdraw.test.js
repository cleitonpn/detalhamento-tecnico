import test from "node:test";
import assert from "node:assert/strict";
import {
  detectArcs,
  fitCircle,
  chainStations,
  pickScale,
} from "../src/lib/techdraw.js";

// Polígono que aproxima um arco, como o SketchUp exporta (vértices sobre o círculo)
function arc(cx, cy, r, from, to, segments) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = from + ((to - from) * i) / segments;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
const toLines = (pts) =>
  pts.slice(1).map((p, i) => [pts[i][0], pts[i][1], p[0], p[1]]);
const close = (a, b, tol) => Math.abs(a - b) <= tol;

test("ajuste de círculo recupera centro e raio", () => {
  const fit = fitCircle(arc(1.2, -0.4, 0.45, 0, Math.PI / 2, 6));
  assert.ok(close(fit.r, 0.45, 1e-9));
  assert.ok(close(fit.cx, 1.2, 1e-9) && close(fit.cy, -0.4, 1e-9));
});

test("círculo completo de 24 segmentos vira diâmetro", () => {
  const [a] = detectArcs(toLines(arc(0, 0, 0.45, 0, 2 * Math.PI, 24)));
  assert.ok(a.full);
  assert.ok(close(a.r, 0.45, 1e-6));
  assert.equal(a.confidence, "alta");
});

test("arco de 90° com poucos segmentos é aceito com confiança reduzida", () => {
  const arcs = detectArcs(toLines(arc(0, 0, 0.6, 0, Math.PI / 2, 3)));
  assert.equal(arcs.length, 1);
  assert.ok(close(arcs[0].r, 0.6, 1e-6));
  assert.ok(close(Math.abs(arcs[0].sweep), Math.PI / 2, 1e-6));
  assert.ok(close(arcs[0].length, 0.6 * (Math.PI / 2), 1e-6));
  assert.equal(arcs[0].confidence, "baixa");
});

test("retângulo de cantos arredondados: quatro raios, retas ignoradas", () => {
  const r = 0.1,
    w = 1.2,
    h = 0.6,
    s = 6;
  const pts = [
    ...arc(w - r, r, r, -Math.PI / 2, 0, s),
    ...arc(w - r, h - r, r, 0, Math.PI / 2, s),
    ...arc(r, h - r, r, Math.PI / 2, Math.PI, s),
    ...arc(r, r, r, Math.PI, 1.5 * Math.PI, s),
  ];
  pts.push(pts[0]);
  const arcs = detectArcs(toLines(pts));
  assert.equal(arcs.length, 4);
  arcs.forEach((a) => {
    assert.ok(close(a.r, r, 1e-6));
    assert.ok(close(Math.abs(a.sweep), Math.PI / 2, 1e-6));
  });
});

test("balcão curvo: contornos interno e externo concêntricos dão a espessura", () => {
  const outer = arc(0, 0, 1.0, 0, Math.PI, 16),
    inner = arc(0, 0, 0.98, 0, Math.PI, 16);
  const arcs = detectArcs([...toLines(outer), ...toLines(inner)]);
  assert.equal(arcs.length, 2);
  assert.equal(arcs[0].role, "externo");
  assert.equal(arcs[1].role, "interno");
  assert.ok(close(arcs[0].thickness, 0.02, 1e-6));
});

test("contornos sobrepostos (topo e base) não duplicam o raio", () => {
  const lines = toLines(arc(0, 0, 0.5, 0, Math.PI / 2, 8));
  assert.equal(detectArcs([...lines, ...lines.map((l) => [...l])]).length, 1);
});

test("elipse e retas não recebem raio único", () => {
  const ellipse = [];
  for (let i = 0; i <= 24; i++) {
    const a = (2 * Math.PI * i) / 24;
    ellipse.push([0.8 * Math.cos(a), 0.3 * Math.sin(a)]);
  }
  assert.equal(detectArcs(toLines(ellipse)).length, 0);
  const box = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ];
  assert.equal(detectArcs(toLines(box)).length, 0);
});

test("cotas parciais e escala normalizada", () => {
  const lines = [
    [0, 0, 0, 0, 1, 0],
    [0.4, 0, 0, 0.4, 1, 0],
    [1.2, 0, 0, 1.2, 1, 0],
    [0.4005, 0, 0, 0.4005, 1, 0],
  ];
  assert.deepEqual(chainStations(lines, "x", 1.2, 1), [0, 0.4, 1.2]);
  assert.equal(pickScale([[2, 1]], [60, 60]), 40);
  assert.equal(pickScale([[0.4, 0.3]], [60, 60]), 10);
});

test("arco tangente a retas mede o ângulo completo, até os pontos de tangência", () => {
  // Reta, arco de 90° com 31 segmentos e reta: o vértice de tangência tem meio passo de giro
  const pts = [[-1, 0.5], ...arc(0, 0, 0.5, Math.PI / 2, 0, 31), [0.5, -1]];
  const [a] = detectArcs(toLines(pts));
  assert.ok(close(a.r, 0.5, 1e-6));
  assert.ok(
    close(Math.abs(a.sweep), Math.PI / 2, 1e-6),
    `ângulo ${(Math.abs(a.sweep) * 180) / Math.PI}`,
  );
});

test("arco continua através de um nó onde chega outra aresta", () => {
  const pts = arc(0, 0, 0.5, 0, Math.PI / 2, 30);
  // Uma aresta vertical chega no 2º vértice e quebra a cadeia ali
  const lines = [...toLines(pts), [pts[1][0], pts[1][1], pts[1][0], -0.4]];
  const [a] = detectArcs(lines);
  assert.ok(
    close(Math.abs(a.sweep), Math.PI / 2, 1e-6),
    `ângulo ${(Math.abs(a.sweep) * 180) / Math.PI}`,
  );
});

test("cilindro facetado: silhuetas laterais aparecem na vista frontal", async () => {
  const THREE = await import("three");
  const { smoothEdges, silhouettes } = await import("../src/lib/techdraw.js");
  const geo = new THREE.CylinderGeometry(
    0.3,
    0.3,
    1,
    24,
    1,
    false,
  ).toNonIndexed();
  geo.translate(0.3, 0.5, 0.3);
  const tri = geo.attributes.position.array;
  const smooth = smoothEdges(tri);
  const front = silhouettes(smooth, "front");
  // Duas geratrizes de contorno (esquerda e direita), verticais
  assert.equal(front.length, 2);
  front.forEach(([a, b]) =>
    assert.ok(Math.abs(Math.abs(a[1] - b[1]) - 1) < 1e-6),
  );
  assert.equal(silhouettes(smooth, "top").length, 0);
});

test("caixa de cantos arredondados (estofado): contorno lateral vem da silhueta", async () => {
  const THREE = await import("three");
  const { RoundedBoxGeometry } =
    await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
  const { smoothEdges, silhouettes } = await import("../src/lib/techdraw.js");
  const geo = new RoundedBoxGeometry(0.9, 0.75, 0.9, 4, 0.08).toNonIndexed();
  geo.translate(0.45, 0.375, 0.45);
  const front = silhouettes(
    smoothEdges(geo.attributes.position.array),
    "front",
  );
  const xs = front.flatMap(([a, b]) => [a[0], b[0]]);
  // O contorno toca as duas laterais da peça
  assert.ok(
    Math.min(...xs) < 0.001 && Math.max(...xs) > 0.899,
    `${Math.min(...xs)} ${Math.max(...xs)}`,
  );
  void THREE;
});
