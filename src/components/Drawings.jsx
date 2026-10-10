import { useMemo, useState } from "react";
import { FileDown, FileJson, CheckCircle2, ArrowRight } from "lucide-react";
import { progress } from "../domain/project.js";
import { buildDrawing, drawingSvg, downloadPdf } from "../lib/drawings.js";

export function downloadJson(value, name) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Drawings({
  project,
  analysis,
  onPublish,
  release,
  onBack,
  onError,
}) {
  const [partId, setPartId] = useState(null),
    [exporting, setExporting] = useState(false);
  const p = progress(project);
  const parts = project.parts.filter((p) => p.review.kind !== "ignore");
  const part = parts.find((p) => p.id === partId) || parts[0];
  const drawings = useMemo(
    () =>
      part
        ? ["front", "top", "side"].map((v) =>
            buildDrawing(part, analysis.meshMap, project.sourceUnit, v),
          )
        : [],
    [part, analysis, project.sourceUnit],
  );
  return (
    <section className="documents-screen">
      <div className="section-title">
        <div>
          <span className="eyebrow">Do modelo para a equipe</span>
          <h1>Caderno técnico</h1>
          <p>
            Vistas e medidas das peças, com a classificação conferida por você.
          </p>
        </div>
        <button className="button secondary" onClick={onBack}>
          Voltar à validação <ArrowRight size={16} />
        </button>
      </div>
      <div className="document-status">
        <CheckCircle2 size={22} />
        <div>
          <strong>
            {p.pending
              ? `${p.pending} peças aguardam validação`
              : release
                ? `Revisão ${release.revision} registrada`
                : "Levantamento pronto para registrar"}
          </strong>
          <p>
            {p.confirmed} de {p.total} peças validadas. Este caderno cobre o
            levantamento dimensional; os detalhes internos de fabricação serão
            uma próxima etapa.
          </p>
        </div>
        <button
          className="button primary"
          disabled={Boolean(p.pending)}
          onClick={onPublish}
        >
          Registrar revisão
        </button>
      </div>
      <div className="drawing-layout">
        <aside className="drawing-list">
          <h2>Peças do caderno</h2>
          {parts.map((p, i) => (
            <button
              key={p.id}
              className={`drawing-item ${p.id === part?.id ? "active" : ""}`}
              onClick={() => setPartId(p.id)}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              <strong>{p.label}</strong>
              {p.review.confirmed && <CheckCircle2 size={15} />}
            </button>
          ))}
        </aside>
        <div className="drawing-paper">
          {part ? (
            <>
              <div className="paper-heading">
                <div>
                  <span>DETALHAMENTO · {project.name}</span>
                  <h2>{part.label}</h2>
                </div>
                <span>{release ? `REV. ${release.revision}` : "PRÉVIA"}</span>
              </div>
              <div className="orthographic-views">
                {drawings.map((drawing, i) => (
                  <div key={drawing.view}>
                    <h3>
                      {["Vista frontal", "Vista superior", "Vista lateral"][i]}
                    </h3>
                    <div
                      className="technical-svg"
                      dangerouslySetInnerHTML={{
                        __html: drawingSvg(part, drawing),
                      }}
                    />
                    {drawing.simplified && (
                      <small>
                        Envelope simplificado pela complexidade da malha.
                      </small>
                    )}
                  </div>
                ))}
              </div>
              <div className="paper-specs">
                <p>
                  <strong>Material:</strong>{" "}
                  {project.materials.find(
                    (m) => m.id === part.review.materialId,
                  )?.name || "A informar"}
                </p>
                <p>
                  <strong>Revestimento:</strong>{" "}
                  {project.materials.find((m) => m.id === part.review.finishId)
                    ?.name || "Não informado"}
                </p>
                {part.review.kind === "metalon" && (
                  <p>
                    <strong>Metalon:</strong>{" "}
                    {part.review.profileWidthMm || "?"} ×{" "}
                    {part.review.profileHeightMm || "?"} mm · parede de{" "}
                    {part.review.wallThicknessMm || "?"} mm
                  </p>
                )}
                <p>{part.review.notes || "Sem observações de construção."}</p>
              </div>
              <footer>
                Medidas em metros · Conferir especificações internas antes de
                fabricar.
              </footer>
            </>
          ) : (
            <p>Nenhuma peça incluída no caderno.</p>
          )}
        </div>
      </div>
      <div className="document-export">
        <p>
          Registre a revisão para exportar os documentos da configuração
          validada.
        </p>
        <button
          className="button secondary"
          disabled={!release || p.pending || project.status !== "validated"}
          onClick={() =>
            downloadJson(release, `${project.name}-R${release.revision}.json`)
          }
        >
          <FileJson size={16} />
          Pacote para integração
        </button>
        <button
          className="button primary"
          disabled={
            !release || p.pending || project.status !== "validated" || exporting
          }
          onClick={async () => {
            setExporting(true);
            try {
              await downloadPdf(project, parts, analysis.meshMap);
            } catch (e) {
              onError(e.message);
            } finally {
              setExporting(false);
            }
          }}
        >
          <FileDown size={16} />
          {exporting ? "Gerando PDF…" : "Baixar caderno PDF"}
        </button>
      </div>
    </section>
  );
}
