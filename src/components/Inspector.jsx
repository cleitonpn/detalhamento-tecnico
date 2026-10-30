import { Check, Layers, Split, Info } from "lucide-react";
import { KINDS, materialLabel, partIssues, SEMANTIC_ROLES, DESTINATIONS, semanticRoleOf, destinationOf } from "../domain/project.js";
import ImportWarnings from "./ImportWarnings.jsx";
import { inferContextRole, contextFacts } from "../lib/context/relations.js";
import { hierarchySummary } from "../lib/context/hierarchy.js";
import { formatM } from "../lib/drawings.js";
import ConstructionPanel from "./ConstructionPanel.jsx";

export default function Inspector({
  parts,
  materials,
  importWarnings,
  relations,
  relationAnalysis,
  hierarchy,
  projectParts = [],
  project,
  analysis,
  onCatalog,
  onHierarchy,
  onPreview,
  onChange,
  onConfirm,
  onMerge,
  onSplit,
}) {
  if (!parts.length)
    return (
      <aside className="inspector">
        <div className="panel-heading">
          <Layers size={17} />
          <h2>Validar uma peça</h2>
        </div>
        <div className="empty-inspector">
          <div className="icon-orbit">
            <Layers size={28} />
          </div>
          <h3>Comece pela seleção</h3>
          <p>
            Clique em uma peça no modelo ou na lista. Use Shift para selecionar
            mais de uma.
          </p>
          <div className="tip">
            <Info size={16} />
            <span>
              A ferramenta sugere os conjuntos. Você confirma como cada um será
              construído.
            </span>
          </div>
        </div>
      </aside>
    );
  const first = parts[0],
    multiple = parts.length > 1;
  // Cópias da mesma peça (mesma impressão digital): o painel trata como uma só
  const identical =
    multiple &&
    !!first.fingerprint?.exact &&
    parts.every((p) => p.fingerprint?.exact === first.fingerprint.exact);
  const same = (key) =>
    parts.every((p) => p.review[key] === first.review[key])
      ? first.review[key]
      : "";
  const review = (key, value) => onChange({ review: { [key]: value, ...(key === "semanticRole" ? { identityEvidence: null, identityNeedsReview: false } : {}) } });
  const kind = same("kind");
  const construction = materials.filter((m) =>
    kind === "metalon" ? m.family === "metal" : m.family !== "finish",
  );
  const finishes = materials.filter(
    (m) => m.family === "finish" || m.family === "wood",
  );
  const issue = parts.flatMap((p) => partIssues(p))[0];
  const neighbors = relations?.neighbors.get(first.id) || [];
  const contextual = inferContextRole(first, relations, projectParts);
  const structure = hierarchySummary(first, hierarchy), facts = contextFacts(first, relations, projectParts);
  return (
    <aside className="inspector">
      <div className="panel-heading">
        <Layers size={17} />
        <h2>
          {identical
            ? `${parts.length} peças iguais`
            : multiple
              ? `${parts.length} peças selecionadas`
              : "Validar uma peça"}
        </h2>
      </div>
      <div className="inspector-content">
        <ImportWarnings warnings={importWarnings} />
        {relationAnalysis?.busy && <div role="status" aria-label="Análise de contexto em andamento">{relationAnalysis.testedPairs ? `Analisando contatos: ${relationAnalysis.testedPairs} pares verificados` : `Preparando contatos: ${relationAnalysis.percent}%`} <button className="text-button" onClick={relationAnalysis.cancel}>Cancelar análise de contexto</button></div>}
        {relationAnalysis?.error && <div className="helper" role="status">{relationAnalysis.error} <button className="text-button" onClick={relationAnalysis.restart}>Reanalisar contexto</button></div>}
        {relations?.geometryPreparationLimited && <p className="helper">A análise espacial omitiu geometria por limite de preparação. Ausência de contato não comprova separação.</p>}
        {(!multiple || identical) && (
          <>
            <label className="field-label" htmlFor="part-name">
              Nome da peça
            </label>
            <input
              id="part-name"
              value={first.label}
              onChange={(e) => onChange({ label: e.target.value })}
            />
            <div className="measure-card">
              <span>Medidas extraídas do modelo</span>
              <strong>
                {first.dimensions.map(formatM).join(" × ")} <small>m</small>
              </strong>
              <p>
                {first.measurementBasis === "world-assembly"
                  ? "Conjunto medido nos eixos do stand."
                  : "Medidas na orientação original da peça."}
              </p>
            </div>
            {first.auto ? (
              <div className={`suggestion auto ${first.auto.level}`}>
                <span className="eyebrow">
                  <i className={`auto-dot ${first.auto.level}`} />
                  {
                    {
                      green: "Evidência forte para conferir",
                      yellow: "Sugestão para conferir",
                      red: "Precisa de decisão",
                    }[first.auto.level]
                  }{" "}
                  ·{" "}
                  {{
                    memory: "memória",
                    rules: "regras",
                    learning: "aprendizado",
                    "rules+learning": "regras + aprendizado",
                  }[first.auto.source] || "regras"}{" "}
                  · evidência de tipo {Math.round((first.auto.scores?.type ?? first.auto.confidence) * 100)}/100
                </span>
                <strong>
                  {KINDS[first.auto.kind] || "A classificar"}
                  {first.auto.materialId &&
                    ` · ${materialLabel(materials.find((m) => m.id === first.auto.materialId))}`}
                  {first.auto.finishId &&
                    ` · ${materialLabel(materials.find((m) => m.id === first.auto.finishId))}`}
                </strong>
                <p>
                  {first.auto.materialId
                    ? `Material: hipótese a conferir${first.auto.scores?.material != null ? ` · evidência ${Math.round(first.auto.scores.material * 100)}/100` : ""}.`
                    : "Material: não identificado ou não aplicável."}
                  {" "}A pontuação não é uma probabilidade de acerto. Medidas e solução construtiva exigem conferência própria.
                </p>
                <ul>
                  {first.auto.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                {first.auto.kind !== "unclassified" && (
                  <button
                    className="text-button"
                    onClick={() =>
                      onChange({
                        review: {
                          kind: first.auto.kind,
                          materialId: first.auto.materialId || "",
                          finishId: first.auto.finishId || "",
                        },
                      })
                    }
                  >
                    Usar sugestão
                  </button>
                )}
              </div>
            ) : (
              <div className="suggestion">
                <span className="eyebrow">Sugestão para conferir</span>
                <strong>
                  {KINDS[first.suggestion.kind] || "A classificar"}
                </strong>
                <p>{first.suggestion.reason}</p>
              </div>
            )}
          </>
        )}
        <label className="field-label" htmlFor="part-kind">
          O que é esta peça?
        </label>
        <select
          id="part-kind"
          value={kind}
          onChange={(e) =>
            onChange({
              review: {
                kind: e.target.value,
                ...(e.target.value === "metalon"
                  ? { materialId: "metalon-custom" }
                  : {}),
              },
            })
          }
        >
          {multiple && !kind && <option value="">Tipos diferentes</option>}
          {Object.entries(KINDS).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <label className="field-label" htmlFor="part-role">Identidade do objeto</label>
        <select id="part-role" value={same("semanticRole") || ""} onChange={e => review("semanticRole", e.target.value)}>
          <option value="">{multiple ? "Seguir leitura de cada peça" : `Automática: ${SEMANTIC_ROLES[semanticRoleOf(first)]}`}</option>
          {Object.entries(SEMANTIC_ROLES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <label className="field-label" htmlFor="part-destination">Destino da peça</label>
        <select id="part-destination" value={same("destination") || ""} onChange={e => review("destination", e.target.value)}>
          <option value="">{multiple ? "Seguir classificação de cada peça" : `Seguir classificação: ${DESTINATIONS[destinationOf(first)]}`}</option>
          {Object.entries(DESTINATIONS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <p className="helper">A identidade permanece registrada mesmo quando o objeto fica fora do caderno técnico.</p>
        {!multiple && structure && <div className="helper" aria-label="Hierarquia do modelo">
          {structure.meshes} malha(s) vinculada(s) à peça · {structure.repeated} ocorrência(s) com a mesma impressão geométrica.
          <p>Hierarquia da cena e repetição não comprovam construção ou aprovação das cópias.</p>
          {structure.partial && <p>Hierarquia parcial: limite de nós atingido.</p>}
          <button className="text-button" onClick={onHierarchy}>Explorar hierarquia do modelo</button>
        </div>}
        {!multiple && facts.map(f => <p className="helper" key={`${f.relation}:${f.otherId}`}>{f.text}</p>)}
        {!multiple && neighbors.length > 0 && (
          <div className="context-relations helper" aria-label="Relações espaciais">
            <strong>Contexto geométrico</strong>
            <ul>{neighbors.slice(0, 6).map(e => {
              const other = projectParts.find(p => p.id === (e.a === first.id ? e.b : e.a));
              return <li key={JSON.stringify([e.a, e.b])}>
                {other?.label || "Peça"}: {e.verified
                  ? `contato ${ {horizontal: "horizontal", lateral: "lateral", inclined: "inclinado"}[e.orientation] || "geométrico"} compatível (tolerância ${relations.contactTolerance * 1000} mm)`
                  : "envelopes próximos; contato não confirmado"}.
              </li>;
            })}</ul>
            <p>Contato geométrico não verifica suporte estrutural, fixação ou capacidade de carga.</p>
            {relations.truncated && <p>Análise parcial: limite de pares atingido.</p>}
            {relations.geometryPreparationLimited && <p>Análise parcial: limite de preparação da geometria atingido. Nenhuma geometria omitida foi reconstruída por suposição.</p>}
            {neighbors.some(e => e.geometryTruncated) && <p>Análise parcial de superfícies: não encontrar contato não comprova separação.</p>}
          </div>
        )}
        {!multiple && contextual && (
          <div className="suggestion">
            <strong>{SEMANTIC_ROLES[contextual.role]} — hipótese contextual</strong>
            <p>{contextual.reason}</p>
            <button className="text-button" onClick={() => onChange({ review: { semanticRole: contextual.role, identityNeedsReview: false,
              identityEvidence: { source: "context-3", role: contextual.role, reason: contextual.reason, fileHash: project.file.hash,
                sourceUnit: project.sourceUnit, relatedPartIds: neighbors.filter(e => e.verified).slice(0, 20).map(e => e.a === first.id ? e.b : e.a),
                truncated: neighbors.filter(e => e.verified).length > 20 } } })}>Usar identidade contextual</button>
          </div>
        )}
        {!multiple && first.review.identityEvidence && <div className="helper" aria-label="Evidência da identidade contextual">
          <p>Decisão humana a partir de {first.review.identityEvidence.source}: {first.review.identityEvidence.reason}</p>
          <p>Arquivo {first.review.identityEvidence.fileHash.slice(0, 12)} · unidade {first.review.identityEvidence.sourceUnit} · {first.review.identityEvidence.relatedPartIds.length} vínculos registrados{first.review.identityEvidence.truncated ? " (lista parcial)" : ""}.</p>
          {first.review.identityNeedsReview && <label className="check-field"><input type="checkbox" checked={false} onChange={() => review("identityNeedsReview", false)} />Conferi novamente a identidade contextual após mudar a escala.</label>}
          <button className="text-button" onClick={() => onChange({ review: { identityEvidence: null, identityNeedsReview: false } })}>Descartar evidência contextual, mantendo a identidade</button>
        </div>}
        {parts.some(p => p.importWarnings?.length && destinationOf(p) === "technical") && (
          <label className="check-field">
            <input type="checkbox" checked={parts.every(p => p.review.importReviewed)}
              onChange={e => review("importReviewed", e.target.checked)} />
            <span>Conferi os alertas do arquivo e a geometria das peças selecionadas.</span>
          </label>
        )}
        {kind !== "ignore" && (
          <>
            <label className="field-label" htmlFor="part-material">
              {kind === "finish"
                ? "Material do revestimento"
                : "Material de construção"}
            </label>
            <select
              id="part-material"
              value={same("materialId")}
              onChange={(e) => review("materialId", e.target.value)}
            >
              <option value="">Selecionar material</option>
              {(kind === "finish" ? materials : construction).map((m) => (
                <option key={m.id} value={m.id}>
                  {materialLabel(m)}
                </option>
              ))}
            </select>
            {kind !== "finish" && (
              <>
                <label className="field-label" htmlFor="part-finish">
                  Revestimento / acabamento
                </label>
                <select
                  id="part-finish"
                  value={same("finishId")}
                  onChange={(e) => review("finishId", e.target.value)}
                >
                  <option value="">Sem revestimento informado</option>
                  {finishes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {materialLabel(m)}
                    </option>
                  ))}
                </select>
              </>
            )}
            <label className="check-field">
              <input
                type="checkbox"
                checked={parts.every((p) => p.review.dimensionsConfirmed)}
                onChange={(e) =>
                  review("dimensionsConfirmed", e.target.checked)
                }
              />
              <span>
                Conferi as medidas e a unidade{" "}
                {multiple ? "das peças selecionadas" : "desta peça"}.
              </span>
            </label>
          </>
        )}
        <label className="field-label" htmlFor="part-notes">
          Observações de construção
        </label>
        <textarea
          id="part-notes"
          rows={3}
          maxLength={1200}
          placeholder="Ex.: fechamento com compensado, estrutura interna, reforços e forma de montagem."
          value={same("notes") || ""}
          onChange={(e) => review("notes", e.target.value)}
        />
        <p className="helper">
          A geometria e o acabamento visual não informam sozinhos a construção
          interna.
        </p>
        {!multiple && project && <ConstructionPanel key={first.id} project={project} part={first} analysis={analysis}
          onChange={patch => onChange({ review: patch })} onCatalog={onCatalog} onPreview={onPreview} />}
        <button
          className="button primary full"
          disabled={Boolean(issue)}
          title={issue || ""}
          onClick={onConfirm}
        >
          <Check size={17} />
          {parts.every((p) => p.review.confirmed)
            ? "Peça validada"
            : multiple
              ? "Validar selecionadas"
              : "Validar peça"}
        </button>
        {issue && <p className="validation-hint">{issue}</p>}
        <div className="group-actions">
          {multiple ? (
            <button className="button secondary full" onClick={onMerge}>
              <Layers size={16} />
              Reunir em um conjunto
            </button>
          ) : (
            <button
              className="button secondary full"
              disabled={first.meshIds.length < 2}
              onClick={onSplit}
            >
              <Split size={16} />
              Separar as malhas
            </button>
          )}
        </div>
        {!multiple && (
          <p className="helper">
            {first.meshIds.length} malha(s) · Material visual:{" "}
            {first.materialsOriginal.join(", ")}
          </p>
        )}
      </div>
    </aside>
  );
}
