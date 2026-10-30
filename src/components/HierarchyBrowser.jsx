import { useMemo, useState } from "react";

export default function HierarchyBrowser({ hierarchy, project, scene, onSelect }) {
  const [query, setQuery] = useState(""), [page, setPage] = useState(0);
  const data = useMemo(() => {
    const children = new Map(), parent = new Map(), owners = new Map(), names = new Map();
    scene?.traverse(node => { if (node.userData.dtPath && node.name) names.set(node.userData.dtPath, node.name); });
    for (const e of hierarchy.edges) {
      if (e.evidence === "mesh-membership") owners.set(e.a, e.b.slice(5));
      if (e.evidence === "scene-path") { if (!children.has(e.b)) children.set(e.b, []); children.get(e.b).push(e.a); parent.set(e.a, e.b); }
    }
    const byId = new Map(project.parts.map(p => [p.id, p]));
    const label = id => {
      const node = hierarchy.nodes.get(id), owner = byId.get(owners.get(id));
      const imported = names.get(node?.path);
      return `${owner?.label || imported || (node?.type === "scene-group" ? "Grupo importado" : "Malha")}${owner && imported && imported !== owner.label ? ` (${imported})` : ""} · ${node?.path || id}`;
    };
    const roots = [...hierarchy.nodes.values()].filter(n => ["scene-group", "mesh"].includes(n.type) && !parent.has(n.id)).map(n => n.id);
    return { children, owners, label, roots };
  }, [hierarchy, project.parts, scene]);
  const matches = [...hierarchy.nodes.values()].filter(n => n.type !== "part" && data.label(n.id).toLowerCase().includes(query.toLowerCase()));
  function Node({ id, depth = 0 }) {
    const [open, setOpen] = useState(depth === 0), children = data.children.get(id) || [], owner = data.owners.get(id);
    if (depth > 100) return <li>Limite de profundidade atingido.</li>;
    return <li role="treeitem" aria-expanded={children.length ? open : undefined}>
      {children.length ? <>
        <button className="text-button" onClick={() => setOpen(!open)}>{open ? "−" : "+"} {data.label(id)} ({children.length})</button>
        {open && <ul role="group">{children.slice(0, 200).map(child => <Node key={child} id={child} depth={depth + 1} />)}{children.length > 200 && <li>Mais de 200 filhos: use a busca para localizar os demais.</li>}</ul>}
      </> : <button className="text-button" disabled={!owner} onClick={() => onSelect(owner)}>{data.label(id)}</button>}
    </li>;
  }
  return <>
    <h2>Hierarquia do modelo</h2>
    <p className="helper">Grupos e malhas da cena importada. Selecionar uma malha abre a peça responsável; não reúne nem divide peças automaticamente.</p>
    {hierarchy.truncated && <p role="status">Hierarquia parcial: limite de nós ou vínculos atingido.</p>}
    <label>Buscar grupo, caminho ou peça<input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
    {query ? <>
      <p>{matches.length} resultado(s).</p>
      <ul>{matches.slice(page * 100, (page + 1) * 100).map(n => <li key={n.id}><button className="text-button" disabled={!data.owners.has(n.id)} onClick={() => onSelect(data.owners.get(n.id))}>{data.label(n.id)}</button></li>)}</ul>
      <button disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button> <button disabled={(page + 1) * 100 >= matches.length} onClick={() => setPage(page + 1)}>Próxima</button>
    </> : <ul role="tree" aria-label="Grupos e malhas da cena">{data.roots.map(id => <Node key={id} id={id} />)}</ul>}
    <p className="helper">{hierarchy.nodes.size} nós · {hierarchy.edges.length} vínculos · {hierarchy.repeatedParts.length} grupos com impressão geométrica repetida. Repetição não comprova identidade ou aprovação.</p>
  </>;
}
