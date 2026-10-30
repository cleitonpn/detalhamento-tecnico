import { useMemo, useState } from "react";
import { SEMANTIC_ROLES, DESTINATIONS } from "../domain/project.js";
import { benchmarkTemplate, checkBenchmark, evaluateBenchmark } from "../lib/classificationBenchmark.js";
import { downloadJson } from "./Drawings.jsx";

export default function ClassificationBenchmark({ project }) {
  const partition = project.parts.map(p => p.id).sort().join("|");
  let partitionHash = 2166136261; for (const c of partition) partitionHash = Math.imul(partitionHash ^ c.charCodeAt(0), 16777619);
  const key = `detalha.benchmark.${project.file.hash}.${project.sourceUnit}.${partitionHash >>> 0}`;
  const [value, setValue] = useState(() => { try { const b = JSON.parse(localStorage.getItem(key)); return checkBenchmark(b, project); } catch { return benchmarkTemplate(project); } });
  const [query, setQuery] = useState(""), [page, setPage] = useState(0), [error, setError] = useState("");
  const parts = project.parts.filter(p => `${p.label} ${p.id}`.toLowerCase().includes(query.toLowerCase()));
  const report = useMemo(() => { try { return evaluateBenchmark(project, value); } catch { return null; } }, [project, value]);
  function change(next) { setValue(next); try { localStorage.setItem(key, JSON.stringify(next)); setError(""); } catch { setError("Não foi possível salvar o gabarito no navegador. Exporte para preservá-lo."); } }
  const annotate = (id, field, text) => {
    const annotations = [...value.annotations], index = annotations.findIndex(a => a.partId === id);
    if (index < 0) annotations.push({ partId: id, semanticRole: null, destination: null, notes: "", [field]: text || null });
    else annotations[index] = { ...annotations[index], [field]: text || null };
    change({ ...value, annotations });
  };
  return <>
    <h2>Gabarito humano da classificação</h2>
    <p className="helper">Os campos começam sem resposta. Registre o julgamento técnico independente; não copie uma sugestão sem conferir. Este gabarito não altera as peças nem alimenta o treinamento.</p>
    <label>Responsável pelo gabarito<input value={value.reviewer} maxLength={180} onChange={e => change({ ...value, reviewer: e.target.value })} /></label>
    <label>Buscar peça no gabarito<input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
    {parts.slice(page * 30, (page + 1) * 30).map(p => {
      const a = value.annotations.find(a => a.partId === p.id) || { partId: p.id, semanticRole: null, destination: null, notes: "" };
      return <fieldset key={p.id}><legend>{p.label}</legend>
        <label>Identidade esperada — {p.label}<select value={a.semanticRole || ""} onChange={e => annotate(p.id, "semanticRole", e.target.value)}>
          <option value="">Não revisada</option>{Object.entries(SEMANTIC_ROLES).map(([id, text]) => <option key={id} value={id}>{text}</option>)}
        </select></label>
        <label>Destino esperado — {p.label}<select value={a.destination || ""} onChange={e => annotate(p.id, "destination", e.target.value)}>
          <option value="">Não revisado</option>{Object.entries(DESTINATIONS).map(([id, text]) => <option key={id} value={id}>{text}</option>)}
        </select></label>
      </fieldset>;
    })}
    <button disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button> <button disabled={(page + 1) * 30 >= parts.length} onClick={() => setPage(page + 1)}>Próxima</button>
    {report && <div role="status" aria-label="Resultado do gabarito">
      <p>{report.annotatedParts}/{report.totalParts} peças anotadas. Identidade: {report.totals.semanticRole.correct}/{report.totals.semanticRole.checked} campos coincidentes. Destino: {report.totals.destination.correct}/{report.totals.destination.checked}.</p>
      <p>{report.batchDisagreements} divergência(s) em campos de peças confirmadas em lote.</p><p>{report.notice}</p>
      <ul>{report.disagreements.slice(0, 50).map(r => <li key={`${r.partId}:${r.field}`}>{r.label}: esperado {r.expected}; automático {r.predicted || "sem previsão"}.</li>)}</ul>
    </div>}
    {error && <p role="alert">{error}</p>}
    <div className="modal-actions">
      <button className="button secondary" onClick={() => { try { checkBenchmark(value, project); downloadJson(value, `${project.name}-gabarito.json`); } catch(e) { setError(e.message); } }}>Exportar gabarito</button>
      <label className="button secondary">Importar gabarito<input type="file" accept=".json" onChange={async e => {
        const file = e.target.files[0]; if (!file) return;
        try {
          if (file.size > 8000000) throw Error("Gabarito acima do limite de 8 MB.");
          const imported = checkBenchmark(JSON.parse(await file.text()), project);
          const byId = new Map(imported.annotations.map(a => [a.partId, a]));
          change({ ...imported, annotations: project.parts.map(p => byId.get(p.id) || { partId: p.id, semanticRole: null, destination: null, notes: "" }) });
        } catch (e) { setError(e.message); } finally { e.target.value = ""; }
      }} /></label>
      <button className="button secondary" disabled={!report} onClick={() => downloadJson(report, `${project.name}-avaliacao.json`)}>Exportar avaliação</button>
    </div>
  </>;
}
