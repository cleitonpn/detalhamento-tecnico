// Sistema de coordenadas do objeto (algoritmo de eixo arbitrário do AutoCAD)
export function ocsAxes(n) {
  const N = n && (n.x || n.y || n.z) ? n : { x: 0, y: 0, z: 1 };
  const len = Math.hypot(N.x, N.y, N.z);
  const z = { x: N.x / len, y: N.y / len, z: N.z / len };
  const ax =
    Math.abs(z.x) < 1 / 64 && Math.abs(z.y) < 1 / 64
      ? cross({ x: 0, y: 1, z: 0 }, z)
      : cross({ x: 0, y: 0, z: 1 }, z);
  const xl = Math.hypot(ax.x, ax.y, ax.z);
  const x = { x: ax.x / xl, y: ax.y / xl, z: ax.z / xl };
  const y = cross(z, x);
  return { x, y, z };
}

export function ocs(n, p) {
  if (!n || (Math.abs(n.x) < 1e-12 && Math.abs(n.y) < 1e-12 && n.z > 0))
    return { x: p.x, y: p.y, z: p.z ?? 0 };
  const { x, y, z } = ocsAxes(n);
  const pz = p.z ?? 0;
  return {
    x: x.x * p.x + y.x * p.y + z.x * pz,
    y: x.y * p.x + y.y * p.y + z.y * pz,
    z: x.z * p.x + y.z * p.y + z.z * pz,
  };
}

const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
