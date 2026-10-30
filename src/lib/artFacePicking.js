/** Associa uma interseção 3D em metros a uma face plana já detectada. */
export function pickedArtFace(part, faces, point, normal, tolerance = 0.02) {
  const origin = part.frame?.origin || part.bounds.min;
  const axes = part.frame?.axes || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (![...point, ...normal].every(Number.isFinite)) return -1;
  const dot = (a, b) => a.reduce((s, v, k) => s + v * b[k], 0);
  const local = axes.map(a => dot(a, point.map((v, k) => v - origin[k])));
  const n = axes.map(a => dot(a, normal));
  let chosen = -1, distance = Infinity;
  faces.forEach((f, i) => {
    const d = Math.abs(f.nx * local[0] + f.nz * local[2] - f.d);
    const u = -f.nz * local[0] + f.nx * local[2];
    if (Math.abs(f.nx * n[0] + f.nz * n[2]) < 0.95 || d > tolerance ||
      u < f.u0 - tolerance || u > f.u1 + tolerance || local[1] < f.y0 - tolerance || local[1] > f.y1 + tolerance) return;
    if (d < distance) { distance = d; chosen = i; }
  });
  return chosen;
}
