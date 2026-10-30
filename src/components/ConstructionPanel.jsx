import { useEffect, useMemo, useState } from "react";
import { formatM } from "../lib/drawings.js";
import { constructionAnalysisAsync } from "../lib/construction/asyncAnalysis.js";
import { CONSTRUCTION_PREVIEW_VERSION } from "../lib/construction/preview.js";
import { constructionRecipes, summarizeConstructionGeometry, assessConstruction, constructionPreview } from "../lib/construction/index.js";

const layerNames = { structure: "Estrutura", substrate: "Fechamento", finish: "Acabamento" };
const geometryNames = { unknown: "insuficiente", "planar-candidate": "sem arco relevante detectado", "circular-candidate": "candidata circular", complex: "complexa / curva livre" };
const refKey = ref => ref ? `${ref.id}@${ref.version}` : "";

function ParameterInput({ parameter, value, onValue }) {
  const [raw, setRaw] = useState(value ?? "");
  useEffect(() => setRaw(value ?? ""), [value]);
  const n = Number(raw), valid = raw === "" || (Number.isFinite(n) && (parameter.allowZero ? n >= 0 : n > 0) && (parameter.key !== "lossRatio" || n <= 1));
  return <input type="number" min={0} max={parameter.key === "lossRatio" ? 1 : undefined} step="any" value={raw}
    aria-invalid={!valid} onChange={e => {
      const text = e.target.value, number = Number(text);
      setRaw(text);
      if (text === "" || (Number.isFinite(number) && (parameter.allowZero ? number >= 0 : number > 0) && (parameter.key !== "lossRatio" || number <= 1)))
        onValue(text === "" ? undefined : number);
    }} onBlur={() => { if (!valid) setRaw(value ?? ""); }} />;
}

export default function ConstructionPanel({ project, part, analysis, onChange, onCatalog, onPreview }) {
  const [open, setOpen] = useState(false), [geometryAnalysis, setGeometryAnalysis] = useState(null), [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false), [percent, setPercent] = useState(0), [generation, setGeneration] = useState(0);
  const [controller, setController] = useState(null);
  useEffect(() => {
    setGeometryAnalysis(null);
    if (!open || !analysis?.meshMap) return;
    const abort = new AbortController(); setController(abort); setAnalyzing(true); setError(""); setPercent(0);
    constructionAnalysisAsync(part, analysis.meshMap, project.sourceUnit, { signal: abort.signal, onProgress: setPercent })
      .then(result => { if (!abort.signal.aborted) setGeometryAnalysis(result); })
      .catch(e => { if (!abort.signal.aborted) setError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setAnalyzing(false); });
    return () => abort.abort();
  }, [open, part.id, part.meshIds, part.dimensions, part.frame, analysis, project.sourceUnit, generation]);
  const recipes = useMemo(() => constructionRecipes(project.constructionRecipes), [project.constructionRecipes]);
  const proposal = part.review.construction;
  const recipe = recipes.find(r => r.id === proposal?.recipeId && r.version === proposal?.recipeVersion);
  const geometry = summarizeConstructionGeometry(geometryAnalysis, {
    part, selectedArcId: proposal?.referenceArc?.id, selectedView: proposal?.referenceArc?.view,
    referenceSurface: proposal?.referenceArc?.surface,
  });
  let assessed = null;
  if (proposal) {
    try { assessed = assessConstruction(proposal, { catalog: project.constructionCatalog, recipes: project.constructionRecipes, geometry, part }); }
    catch (e) { assessed = { missing: [e.message], alternatives: {} }; }
  }
  const change = patch => onChange({ construction: { ...proposal, ...patch } });
  const preview = constructionPreview(part, proposal, assessed, geometry);
  return <details className="construction-panel" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Solução construtiva proposta</summary>
    {open && <>
      <p className="helper">Camadas e parâmetros da empresa. Não é cálculo estrutural, lista de corte ou liberação de fabricação.</p>
      <button className="button secondary full" onClick={onCatalog}>Catálogo e padrões construtivos</button>
      <label className="field">Receita construtiva
        <select aria-label="Receita construtiva" value={proposal ? `${proposal.recipeId}@${proposal.recipeVersion}` : ""} onChange={e => {
          const selected = recipes.find(r => refKey(r) === e.target.value);
          onChange({ construction: selected ? { schemaVersion: 1, recipeId: selected.id, recipeVersion: selected.version,
            layers: {}, parameters: {}, referenceArc: null, notes: "" } : null });
        }}>
          <option value="">Sem proposta</option>
          {recipes.map(r => <option key={refKey(r)} value={refKey(r)}>{r.name} · v{r.version} · {r.approved ? "aprovado pela equipe" : "rascunho"}</option>)}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {analyzing ? <div role="status" aria-label="Análise de construção em andamento">Analisando seções: {percent}% <button className="text-button" onClick={() => { controller?.abort(); setAnalyzing(false); setError("Análise cancelada. Nenhuma hipótese foi aplicada."); }}>Cancelar análise</button></div> : error && <button className="text-button" onClick={() => setGeneration(n => n + 1)}>Reanalisar geometria</button>}
      {proposal && recipe && <>
        {Object.entries(layerNames).map(([role, label]) => <label className="field" key={role}>{label} da proposta
          <select value={refKey(proposal.layers[role])} onChange={e => {
            const material = (project.constructionCatalog || []).find(m => refKey(m) === e.target.value);
            change({ layers: { ...proposal.layers, [role]: material ? { id: material.id, version: material.version } : null } });
          }}>
            <option value="">{recipe.layers[role].required ? "Selecionar material cadastrado" : "Não informado (opcional)"}</option>
            {(project.constructionCatalog || []).filter(m => recipe.layers[role].families.includes(m.family)).map(m =>
              <option key={refKey(m)} value={refKey(m)}>{m.name} · v{m.version} · {m.approved ? "aprovado" : "rascunho"}</option>)}
          </select>
        </label>)}
        <p className="helper">Referência do modelo: {part.dimensions.map(formatM).join(" × ")} m. Os campos abaixo não são preenchidos por suposição.</p>
        {recipe.parameters.map(p => <label key={p.key} className="field">{p.label} ({p.unit === "ratio" ? "fração 0–1" : p.unit})
          <ParameterInput parameter={p} value={proposal.parameters[p.key]} onValue={value => {
              const parameters = { ...proposal.parameters };
              if (value === undefined) delete parameters[p.key];
              else parameters[p.key] = value;
              change({ parameters });
          }} />
        </label>)}
        {recipe.geometry === "circular" && <>
          <label className="field">Arco de referência
            <select value={proposal.referenceArc ? `${proposal.referenceArc.view}:${proposal.referenceArc.id}` : ""} onChange={e => {
              const arc = geometry.candidates.find(a => `${a.view}:${a.id}` === e.target.value);
              change({ referenceArc: arc ? { id: arc.id, view: arc.view, surface: "internal", representsSurface: false } : null });
            }}>
              <option value="">Selecionar arco detectado</option>
              {geometry.candidates.map(a => <option key={`${a.view}:${a.id}`} value={`${a.view}:${a.id}`}>{a.id} · {a.view} · R {formatM(a.radiusM)} m · desvio {formatM(a.deviationM * 1000)} mm</option>)}
            </select>
          </label>
          {proposal.referenceArc && <>
            <label className="field">Superfície de referência
              <select value={proposal.referenceArc.surface} onChange={e => change({ referenceArc: { ...proposal.referenceArc, surface: e.target.value, representsSurface: false } })}>
                <option value="internal">Interna</option><option value="external">Externa</option><option value="neutral">Neutra (a conferir)</option>
              </select>
            </label>
            <label className="check-field"><input type="checkbox" checked={!!proposal.referenceArc.representsSurface}
              onChange={e => change({ referenceArc: { ...proposal.referenceArc, representsSurface: e.target.checked } })} />Confirmei que este arco representa o fechamento, não apenas um canto arredondado.</label>
          </>}
        </>}
        {recipe.geometry === "straight" && <>
          <label className="field">Referência reta para estrutura
            <select aria-label="Referência reta para estrutura" value={proposal.referenceLine?.id || ""} onChange={e => change({ referenceLine: e.target.value ? { id: e.target.value, representsSurface: false } : null })}>
              <option value="">Escolher linha comum às três seções</option>
              {geometry.surfaceSections?.lines.map(line => <option key={line.id} value={line.id}>{line.id} · {formatM(line.lengthM)} m</option>)}
            </select>
          </label>
          {proposal.referenceLine && <label className="check-field"><input type="checkbox" checked={proposal.referenceLine.representsSurface}
            onChange={e => change({ referenceLine: { ...proposal.referenceLine, representsSurface: e.target.checked } })} />Confirmei a linha do fechamento que será usada como referência dos eixos.</label>}
        </>}
        <p className="helper">Leitura geométrica: {geometryNames[geometry.kind]}. {geometry.warnings.join(" ")}</p>
        {geometry.surfaceSections && <p className="helper">Método: cortes da malha em {geometry.surfaceSections.sections.map(s => `${formatM(s.heightM)} m`).join(", ") || "nenhuma seção suficiente"}. Tolerância entre cortes: {formatM(geometry.surfaceSections.toleranceM * 1000)} mm. {geometry.surfaceSections.truncated ? "Análise limitada; não usar como superfície completa." : "Sem prova automática de continuidade entre os cortes."}</p>}
        {geometry.surfaceSections?.sections.some(s => s.estimatedRadiiM?.length) && <details><summary>Conferir raios por seção</summary>
          <ul>{geometry.surfaceSections.sections.map((s, i) => <li key={i}>Altura {formatM(s.heightM)} m: {(s.estimatedRadiiM || []).map(formatM).join(", ") || "sem ajuste circular"} m · resíduo máximo {formatM((s.maxResidualM || 0) * 1000)} mm.</li>)}</ul>
          <p className="helper">Raio ajustado à malha, não precisão garantida da peça física. Curvas múltiplas/livres não recebem planificação circular única.</p>
        </details>}
        {geometry.development && <p>R × ângulo = {formatM(geometry.development.lengthM)} m na referência escolhida. Não é comprimento de corte.</p>}
        <label className="field">Notas da proposta
          <textarea rows={3} maxLength={1200} value={proposal.notes || ""} onChange={e => change({ notes: e.target.value })} />
        </label>
        {part.review.constructionNeedsReview && <label className="check-field"><input type="checkbox" checked={false}
          onChange={() => onChange({ constructionNeedsReview: false })} />A escala mudou. Conferi novamente todos os parâmetros e a referência geométrica.</label>}
        <div role="status" aria-label="Pendências construtivas">
          <strong>{assessed?.missing.length ? "Proposta incompleta" : "Proposta para revisão técnica"}</strong>
          <ul>{assessed?.missing.map(m => <li key={m}>{m}</li>)}</ul>
          <p>Não libera fabricação ou dimensiona conexões e estabilidade.</p>
        </div>
        {(recipe.layout || recipe.components?.length > 0) && <>
          <label className="check-field"><input type="checkbox" checked={proposal.structureSurveyed === true} onChange={e => change({ structureSurveyed: e.target.checked,
            geometryVersion: geometry.methodVersion || "insufficient", previewVersion: CONSTRUCTION_PREVIEW_VERSION })} />Conferi a estrutura já modelada. Esta proposta ficará separada, sem somar peças automaticamente.</label>
          {proposal.structureSurveyed && (proposal.geometryVersion !== geometry.methodVersion || proposal.previewVersion !== CONSTRUCTION_PREVIEW_VERSION) &&
            <button className="text-button" disabled={analyzing || !geometryAnalysis} onClick={() => change({ geometryVersion: geometry.methodVersion, previewVersion: CONSTRUCTION_PREVIEW_VERSION })}>Atualizar conferência para o método atual</button>}
          <p className="helper">{preview.reason}</p>
          <button className="button secondary full" disabled={preview.status === "blocked"} onClick={() => onPreview?.({ partId: part.id, ...preview })}>{recipe.components?.length ? "Mostrar componentes propostos no 3D" : "Mostrar eixos propostos no 3D"}</button>
          {preview.quantities && <div aria-label="Quantitativos preliminares">
            {preview.quantities.kind === "components" ? <>
              <p>{preview.quantities.panelCount} painéis · {preview.quantities.profileCount} perfis/reforços · {preview.quantities.connectionCount} marcadores de ligação.</p>
              <p>{formatM(preview.quantities.panelAreaM2)} m² em painéis de referência · {formatM(preview.quantities.axisLengthM)} m em eixos de perfis.</p>
            </> : <>
            <p>{preview.quantities.count} montantes propostos · {formatM(preview.quantities.axisLengthM)} m de eixos · {formatM(preview.quantities.referenceAreaM2)} m² de área de referência.</p>
            <p>Reserva configurada: {formatM(preview.quantities.axisAllowanceM)} m de eixos. Espaçamento efetivo: {formatM(preview.quantities.actualSpacingM)} m.</p>
            </>}
            <p className="helper">{preview.quantities.notice}</p>
          </div>}
        </>}
      </>}
    </>}
  </details>;
}
