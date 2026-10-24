import { Check, Layers, Split, Info } from "lucide-react";
import { KINDS, materialLabel, partIssues } from "../domain/project.js";
import { formatM } from "../lib/drawings.js";

export default function Inspector({
  parts,
  materials,
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
  const review = (key, value) => onChange({ review: { [key]: value } });
  const kind = same("kind");
  const construction = materials.filter((m) =>
    kind === "metalon" ? m.family === "metal" : m.family !== "finish",
  );
  const finishes = materials.filter(
    (m) => m.family === "finish" || m.family === "wood",
  );
  const issue = parts.flatMap((p) => partIssues(p))[0];
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
                      green: "Reconhecida com segurança",
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
                  · {Math.round(first.auto.confidence * 100)}%
                </span>
                <strong>
                  {KINDS[first.auto.kind] || "A classificar"}
                  {first.auto.materialId &&
                    ` · ${materialLabel(materials.find((m) => m.id === first.auto.materialId))}`}
                  {first.auto.finishId &&
                    ` · ${materialLabel(materials.find((m) => m.id === first.auto.finishId))}`}
                </strong>
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
