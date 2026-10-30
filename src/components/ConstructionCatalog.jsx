import { useState } from "react";
import { MATERIAL_FAMILIES, constructionRecipes, checkConstructionCatalog, checkConstructionRecipes, checkComponentRules, counterComponentTemplate } from "../lib/construction/index.js";
import { SEMANTIC_ROLES } from "../domain/project.js";

const empty = { name: "", family: "timber-profile", parameters: {}, source: "", approvedBy: "", approved: false };
const refKey = r => `${r.id}@${r.version}`;
const physicalFields = { thicknessMm: "Espessura (mm)", sectionWidthMm: "Largura da seção (mm)", sectionHeightMm: "Altura da seção (mm)", minRadiusM: "Raio mínimo verificado (m)", flexDirection: "Orientação de flexão" };

export default function ConstructionCatalog({ project, onChange }) {
  const [mode, setMode] = useState("material"), [draft, setDraft] = useState(empty), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const recipes = constructionRecipes(project.constructionRecipes);
  const entries = mode === "material" ? project.constructionCatalog || [] : recipes;
  const [baseKey, setBaseKey] = useState("");
  const [componentText, setComponentText] = useState("[]");
  function choose(key) {
    setBaseKey(key); setError(""); setNotice("");
    const item = entries.find(r => refKey(r) === key);
    setComponentText(JSON.stringify(item?.components || [], null, 2));
    setDraft(item ? structuredClone({ ...item, approved: false, approvedBy: "", approvedAt: "" }) : { ...empty, parameters: {} });
  }
  function save(e) {
    e.preventDefault(); setError(""); setNotice("");
    try {
      const base = entries.find(r => refKey(r) === baseKey);
      if (mode === "recipe" && !base) throw Error("Escolha uma receita base.");
      const entry = { ...(mode === "recipe" ? base : {}), ...draft,
        id: base?.id || crypto.randomUUID(),
        version: base ? Math.max(...entries.filter(r => r.id === base.id).map(r => r.version)) + 1 : 1,
        approvedAt: draft.approved ? new Date().toISOString() : "",
      };
      if (mode === "recipe") {
        if (componentText.length > 1000000) throw Error("Definição de componentes acima do limite de 1 MB.");
        entry.components = checkComponentRules(JSON.parse(componentText));
      }
      const field = mode === "material" ? "constructionCatalog" : "constructionRecipes";
      const next = [...(project[field] || []), entry];
      if (mode === "material") checkConstructionCatalog(next);
      else { checkConstructionRecipes(next); constructionRecipes(next); }
      onChange({ ...project, [field]: next });
      setNotice(`Salvo: ${entry.name} · v${entry.version}. Versões anteriores preservadas.`);
      setBaseKey(refKey(entry));
      setDraft({ ...entry, approved: false, approvedBy: "", approvedAt: "" });
    } catch (e) { setError(e.message); }
  }
  const patch = (key, value) => setDraft(d => ({ ...d, [key]: value }));
  return <>
    <h2>Catálogo e padrões construtivos</h2>
    <p className="helper">Cadastro do projeto. Aprovação é uma declaração da equipe, não uma certificação do sistema. Use fichas e padrões técnicos verificados. Salvar uma nova versão não altera propostas anteriores.</p>
    <label>Tipo de cadastro<select value={mode} onChange={e => { setMode(e.target.value); setBaseKey(""); setComponentText("[]"); setDraft({ ...empty, parameters: {} }); setError(""); setNotice(""); }}>
      <option value="material">Material / ficha técnica</option><option value="recipe">Padrão construtivo / receita</option>
    </select></label>
    <form onSubmit={save}>
      <label>Base para nova versão<select value={baseKey} onChange={e => choose(e.target.value)}>
        <option value="">{mode === "material" ? "Novo material" : "Escolha um padrão inicial"}</option>
        {entries.map(r => <option key={refKey(r)} value={refKey(r)}>{r.name} · v{r.version} · {r.approved ? "aprovado" : "rascunho"}</option>)}
      </select></label>
      <label>Nome do cadastro<input required maxLength={180} value={draft.name} onChange={e => patch("name", e.target.value)} /></label>
      {mode === "material" && <>
        <label>Família construtiva<select value={draft.family} onChange={e => patch("family", e.target.value)}>
          {Object.entries(MATERIAL_FAMILIES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        {Object.entries(physicalFields).filter(([key]) => draft.family.includes("profile") ? key.startsWith("section") : draft.family === "flexible-sheet" ? !key.startsWith("section") : draft.family === "rigid-sheet" ? key === "thicknessMm" : false).map(([key, label]) =>
          <label key={key}>{label}<input type={key === "flexDirection" ? "text" : "number"} min={0} step="any" maxLength={180} value={draft.parameters[key] ?? ""}
            onChange={e => { const parameters = { ...draft.parameters }; if (e.target.value === "") delete parameters[key]; else parameters[key] = key === "flexDirection" ? e.target.value : Number(e.target.value); patch("parameters", parameters); }} /></label>)}
        {draft.family === "flexible-sheet" && <label>Referência do raio mínimo<select value={draft.parameters.radiusReference || ""} onChange={e => {
          const parameters = { ...draft.parameters }; if (e.target.value) parameters.radiusReference = e.target.value; else delete parameters.radiusReference; patch("parameters", parameters);
        }}><option value="">Não informada</option><option value="internal">Interna</option><option value="external">Externa</option><option value="neutral">Neutra</option></select></label>}
      </>}
      {mode === "recipe" && <>
        <p className="helper">Herda camadas, compatibilidades e campos da receita base. Medidas, espaçamento, folga e perda são informados em cada peça; nenhum valor é presumido.</p>
        <label>Geometria admitida pela receita<select value={draft.geometry || "any"} onChange={e => {
          const geometry = e.target.value, parameters = Array.isArray(draft.parameters) ? [...draft.parameters] : [];
          if (geometry === "straight" && !parameters.some(p => p.key === "widthM")) parameters.push({ key: "widthM", label: "Largura a conferir", unit: "m", allowZero: false });
          setDraft({ ...draft, geometry, parameters, approved: false });
        }}><option value="straight">Reta / prismática</option><option value="circular">Circular — exige referência confirmada</option><option value="any">Qualquer forma — componentes exigem compatibilidade própria</option></select></label>
        <fieldset><legend>Identidades admitidas</legend>{Object.entries(SEMANTIC_ROLES).filter(([id]) => id !== "render").map(([id, name]) =>
          <label className="check-field" key={id}><input type="checkbox" checked={draft.semanticRoles?.includes(id) || false} onChange={e => {
            const roles = new Set(draft.semanticRoles || []); if (e.target.checked) roles.add(id); else roles.delete(id);
            setDraft({ ...draft, semanticRoles: [...roles], approved: false });
          }} />{name}</label>)}</fieldset>
        <label>Escopo de uso do padrão<textarea rows={2} maxLength={1200} value={draft.scope || ""} onChange={e => setDraft({ ...draft, scope: e.target.value, approved: false })} /></label>
        <label>Contraindicações e verificações manuais<textarea rows={2} maxLength={1200} value={draft.contraindications || ""} onChange={e => setDraft({ ...draft, contraindications: e.target.value, approved: false })} /></label>
        <p className="helper">Esses textos são instruções para a equipe, não verificações automáticas de estabilidade ou fixação. Alterar condições exige nova aprovação.</p>
        <label className="check-field"><input type="checkbox" checked={!!draft.layout} onChange={e => {
          const next = { ...draft };
          if (e.target.checked) next.layout = { kind: "vertical-studs", spacingMeaning: "maximum-axis-distance", clearanceMeaning: "both-path-ends", heightMeaning: "reference-axis-length" };
          else delete next.layout;
          setDraft(next);
        }} />Distribuir montantes verticais: espaçamento máximo entre eixos, folga em cada ponta do percurso e altura como comprimento de eixo. Não inclui travessas ou conexões.</label>
        <details><summary>Componentes paramétricos da receita</summary>
          <p className="helper">Painéis, perfis, reforços e marcadores de ligação. Expressões usam somas de parâmetros, sem código. As coordenadas são locais, em metros; espessura e seção vêm da ficha selecionada. Reveja o esboço antes de aprovar a versão.</p>
          <button type="button" className="button secondary" onClick={() => { setComponentText(JSON.stringify(counterComponentTemplate(), null, 2)); patch("approved", false); }}>Carregar esboço de balcão não aprovado</button>
          <label>Definição dos componentes (JSON)<textarea rows={12} value={componentText} onChange={e => { setComponentText(e.target.value); patch("approved", false); }} /></label>
          <p className="helper">Exemplo de expressão: {`{"terms":[{"field":"widthM","factor":1}],"offsetM":0}`}. Campos: widthM, heightM, depthM, clearanceM, spacingM, thicknessM, sectionWidthM, sectionHeightM. Para ligação, informe detail com o documento técnico. O esboço de balcão não inclui reforços ou ligações automaticamente.</p>
        </details>
      </>}
      <label>Fonte técnica / documento<input maxLength={1000} value={draft.source} onChange={e => patch("source", e.target.value)} /></label>
      <label>Responsável pela aprovação<input maxLength={180} value={draft.approvedBy} onChange={e => patch("approvedBy", e.target.value)} /></label>
      <label className="check-field"><input type="checkbox" checked={draft.approved} onChange={e => patch("approved", e.target.checked)} />A equipe aprovou esta versão com base na fonte técnica informada.</label>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button className="button primary" type="submit">Salvar nova versão</button>
    </form>
    <p className="helper">{(project.constructionCatalog || []).length} versões de material · {(project.constructionRecipes || []).length} versões próprias de receita.</p>
  </>;
}
