// Índice de envelopes em metros. A consulta é uma fase ampla, não prova contato.
export function createSpatialIndex(parts, { cellSize = 2, maxCells = 512 } = {}) {
  if (!(cellSize > 0) || !Number.isFinite(cellSize) || !Number.isSafeInteger(maxCells) || maxCells < 1)
    throw Error("Configuração espacial inválida.");
  const cells = new Map(), large = new Set(), valid = [];
  const range = bounds => {
    if (!bounds?.min?.every(Number.isFinite) || !bounds?.max?.every(Number.isFinite) ||
      bounds.min.length !== 3 || bounds.max.length !== 3 || bounds.min.some((n, k) => n > bounds.max[k]))
      throw Error("Envelope espacial inválido.");
    const lo = bounds.min.map(n => Math.floor(n / cellSize));
    const hi = bounds.max.map(n => Math.floor(n / cellSize));
    const count = [...lo, ...hi].every(Number.isSafeInteger)
      ? hi.reduce((n, v, k) => n * (v - lo[k] + 1), 1) : Infinity;
    return { lo, hi, count };
  };
  const visit = ({ lo, hi }, fn) => {
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) fn(`${x}|${y}|${z}`);
  };
  for (const p of parts) {
    const r = range(p.bounds);
    valid.push(p);
    if (r.count > maxCells) large.add(p);
    else visit(r, key => {
      if (!cells.has(key)) cells.set(key, new Set());
      cells.get(key).add(p);
    });
  }
  return {
    query(bounds, padding = 0) {
      if (!Number.isFinite(padding) || padding < 0) throw Error("Tolerância espacial inválida.");
      const b = { min: bounds.min.map(n => n - padding), max: bounds.max.map(n => n + padding) };
      const r = range(b), candidates = new Set(large);
      if (r.count > maxCells) valid.forEach(p => candidates.add(p));
      else visit(r, key => cells.get(key)?.forEach(p => candidates.add(p)));
      return [...candidates].filter(p => [0, 1, 2].every(k =>
        p.bounds.max[k] >= b.min[k] && p.bounds.min[k] <= b.max[k]));
    },
  };
}
