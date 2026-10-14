import { useEffect, useMemo, useState } from "react";
import { FileDown, FileJson, CheckCircle2, ArrowRight } from "lucide-react";
import { progress } from "../domain/project.js";
import {
  downloadPdf,
  overviewSheet,
  partSheet,
  sheetParts,
} from "../lib/drawings.js";
import { sheetSvg } from "../lib/sheet.js";

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
    [exporting, setExporting] = useState(false),
    [sheet, setSheet] = useState(null);
  const p = progress(project);
  // O caderno mostra só o que a equipe validou
  const parts = useMemo(() => sheetParts(project), [project]);
  // Abre na vista geral; uma peça removida do caderno também volta para ela
  const index = parts.findIndex((x) => x.id === partId);
  const part = index >= 0 ? parts[index] : null;
  const preview = !release || project.status !== "validated";

  useEffect(() => {
    if (!parts.length) {
      setSheet(null);
      return;
    }
    // Linhas ocultas, raios e vistas 3D levam alguns instantes em modelos grandes
    setSheet(null);
    const timer = setTimeout(() => {
      try {
        setSheet(
          sheetSvg(
            part
              ? partSheet(project, part, analysis.meshMap, index, preview)
              : overviewSheet(project, parts, analysis.meshMap, preview),
          ),
        );
      } catch (e) {
        onError(`Não foi possível desenhar a folha. ${e.message}`);
      }
    }, 30);
    return () => clearTimeout(timer);
  }, [part, parts, index, project, analysis, preview, onError]);

  return (
    <section className="documents-screen">
      <div className="section-title">
        <div>
          <span className="eyebrow">Do modelo para a equipe</span>
          <h1>Caderno técnico</h1>
          <p>
            Vista geral do stand com as peças destacadas e uma folha por peça
            validada: vistas na mesma escala, cotas em mm, raios das partes
            curvas e perspectiva de apoio.
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
            {release
              ? `Revisão ${release.revision} registrada`
              : parts.length
                ? `${parts.length} ${parts.length === 1 ? "peça validada" : "peças validadas"} no caderno`
                : "Nenhuma peça validada ainda"}
          </strong>
          <p>
            Peças sem validação não aparecem aqui. Selecione e valide na etapa
            anterior as peças que quer detalhar.{" "}
            {release
              ? `${parts.length} peças validadas no caderno.`
              : p.pending
                ? `Para registrar uma revisão oficial, todas as ${p.total} peças precisam estar validadas ou ignoradas (faltam ${p.pending}).`
                : "Tudo validado: a revisão já pode ser registrada."}
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
          {parts.length > 0 && (
            <button
              className={`drawing-item ${!part ? "active" : ""}`}
              onClick={() => setPartId(null)}
            >
              <span>00</span>
              <strong>Vista geral do stand</strong>
            </button>
          )}
          {parts.map((p, i) => (
            <button
              key={p.id}
              className={`drawing-item ${p.id === part?.id ? "active" : ""}`}
              onClick={() => setPartId(p.id)}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              <strong>{p.label}</strong>
              <CheckCircle2 size={15} />
            </button>
          ))}
          {!parts.length && (
            <p className="drawing-empty">
              Volte à validação, selecione as peças que quer detalhar, confira
              tipo e medidas e clique em validar.
            </p>
          )}
        </aside>
        <div className="drawing-paper sheet-paper">
          {!parts.length ? (
            <p>As folhas técnicas aparecem aqui depois da validação.</p>
          ) : sheet ? (
            <div
              className="technical-sheet"
              dangerouslySetInnerHTML={{ __html: sheet }}
            />
          ) : (
            <p className="sheet-loading">
              Desenhando vistas, linhas ocultas e raios…
            </p>
          )}
        </div>
      </div>
      <div className="document-export">
        <p>
          {preview
            ? "Sem revisão registrada, o PDF sai marcado como PRÉVIA."
            : "PDF da revisão registrada."}
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
          disabled={!parts.length || exporting}
          onClick={async () => {
            setExporting(true);
            try {
              await downloadPdf(project, parts, analysis.meshMap, { preview });
            } catch (e) {
              onError(e.message);
            } finally {
              setExporting(false);
            }
          }}
        >
          <FileDown size={16} />
          {exporting
            ? "Gerando PDF…"
            : preview
              ? "Baixar prévia em PDF"
              : "Baixar caderno PDF"}
        </button>
      </div>
    </section>
  );
}
