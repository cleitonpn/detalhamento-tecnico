import test from "node:test";
import assert from "node:assert/strict";
import { pickedArtFace } from "../src/lib/artFacePicking.js";

const faces = [{ nx: 0, nz: 1, d: 0, u0: -3, u1: 0, y0: 0, y1: 2.5 },
  { nx: 0, nz: -1, d: -.1, u0: 0, u1: 3, y0: 0, y1: 2.5 }];
const part = { bounds: { min: [10, 2, 4] } };
test("clique em metros identifica frente e verso sem depender do sentido dos triângulos", () => {
  assert.equal(pickedArtFace(part, faces, [11, 3, 4], [0, 0, 1]), 0);
  assert.equal(pickedArtFace(part, faces, [11, 3, 4], [0, 0, -1]), 0);
  assert.equal(pickedArtFace(part, faces, [11, 3, 4.1], [0, 0, -1]), 1);
  assert.equal(pickedArtFace(part, faces, [11, 3, 4.1], [0, 1, 0]), -1);
  assert.equal(pickedArtFace(part, faces, [14, 3, 4], [0, 0, 1]), -1);
  assert.equal(pickedArtFace(part, faces, [11, 9, 4], [0, 0, 1]), -1);
  assert.equal(pickedArtFace(part, faces, [11, 3, 4.05], [0, 0, 1]), -1);
});
test("referencial girado e deslocado transforma o ponto e a normal antes da associação", () => {
  const angle = 37 * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const rotated = { frame: { origin: [10, 2, 4], axes: [[c, 0, -s], [0, 1, 0], [s, 0, c]] } };
  assert.equal(pickedArtFace(rotated, faces, [10 + c, 3, 4 - s], [s, 0, c]), 0);
  assert.equal(pickedArtFace(rotated, faces, [10 + c + .1 * s, 3, 4 - s + .1 * c], [-s, 0, -c]), 1);
  assert.equal(pickedArtFace(rotated, faces, [NaN, 3, 4], [s, 0, c]), -1);
});
