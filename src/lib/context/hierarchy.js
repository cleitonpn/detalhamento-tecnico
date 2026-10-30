// Caminhos de nós do importador representam a hierarquia real da cena. Nenhuma
// relação abaixo pressupõe fabricação, compra, carga ou conexões mecânicas.
export function buildHierarchy(parts, { maxNodes = 20000, maxEdges = 50000 } = {}) {
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || !Number.isSafeInteger(maxEdges) || maxEdges < 1) throw Error("Limite de hierarquia inválido.");
  const nodes = new Map(), edges = [], repeats = new Map(), memberships = new Map();
  let truncated = false;
  const link = edge => { if (edges.length >= maxEdges) { truncated = true; return; } edges.push(edge); };
  const add = node => { if (nodes.has(node.id)) return true; if (nodes.size >= maxNodes) { truncated = true; return false; } nodes.set(node.id, node); return true; };
  for (const part of parts) {
    if (!add({ id: `part:${part.id}`, type: "part", partId: part.id })) continue;
    memberships.set(part.id, []);
    if (part.fingerprint?.exact) {
      if (!repeats.has(part.fingerprint.exact)) repeats.set(part.fingerprint.exact, []);
      repeats.get(part.fingerprint.exact).push(part.id);
    }
    for (const path of part.meshIds) {
      if (!add({ id: `mesh:${path}`, type: "mesh", path })) continue;
      link({ a: `mesh:${path}`, b: `part:${part.id}`, relation: "belongs-to", evidence: "mesh-membership" });
      memberships.get(part.id).push(path);
      const segments = path.split("/");
      let child = `mesh:${path}`;
      for (let k = segments.length - 1; k > 0; k--) {
        const parentPath = segments.slice(0, k).join("/"), parent = `group:${parentPath}`;
        if (!add({ id: parent, type: "scene-group", path: parentPath })) break;
        link({ a: child, b: parent, relation: "belongs-to", evidence: "scene-path" }); child = parent;
      }
    }
  }
  const groups = [...repeats.values()].filter(ids => ids.length > 1);
  return { nodes, edges: [...new Map(edges.map(e => [`${e.a}|${e.b}`, e])).values()], memberships, repeatedParts: groups, truncated };
}

export function hierarchySummary(part, hierarchy) {
  if (!hierarchy) return null;
  return { meshes: hierarchy.memberships.get(part.id)?.length || 0,
    repeated: hierarchy.repeatedParts.find(ids => ids.includes(part.id))?.length || 1,
    partial: hierarchy.truncated };
}
