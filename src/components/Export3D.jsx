import { useMemo, useState } from "react";
import {
  ArrowRight,
  Download,
  Search,
  CheckSquare,
  Square,
} from "lucide-react";
import Viewer from "./Viewer.jsx";
import { exportParts, download } from "../lib/export3d.js";
import { fmtLen } from "../lib/techdraw.js";

const noop = () => {};

/**
 * Aba à parte para levar peças a outras ferramentas: escolhe as peças, confere
 * isoladas no 3D e baixa em .glb. Não altera o projeto nem as validações.
 */
export default function Export3D({
  project,
  analysis,
  scene,
  onBack,
  onError,
  onNotice,
}) {
  const [selected, setSelected] = useState([]),
    [query, setQuery] = useState(""),
    [center, setCenter] = useState(true),
    [separate, setSeparate] = useState(false),
    [focusTick, setFocusTick] = useState(0),
    [busy, setBusy] = useState(false);

  const visible = useMemo(
    () =>
      project.parts.filter((p) =>
        `${p.label} ${p.materialsOriginal.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [project.parts, query],
  );
  const chosen = project.parts.filter((p) => selected.includes(p.id));

  function toggle(id, additive = true) {
    if (!id) return;
    setSelected((cur) =>
      additive
        ? cur.includes(id)
          ? cur.filter((x) => x !== id)
          : [...cur, id]
        : [id],
    );
    setFocusTick((t) => t + 1);
  }

  async function run() {
    setBusy(true);
    try {
      const file = await exportParts(project, chosen, analysis.meshMap, {
        center,
        separate,
      });
      download(file);
      onNotice(
        `Arquivo ${file.name} gerado (${(file.blob.size / 1048576).toFixed(2)} MB).`,
      );
    } catch (e) {
      onError(`Não foi possível exportar. ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="documents-screen export-screen">
      <div className="section-title">
        <div>
          <span className="eyebrow">Para outras ferramentas</span>
          <h1>Exportar 3D</h1>
          <p>
            Escolha as peças, confira no 3D e baixe em .glb (metros, Y para
            cima, com as cores e materiais originais). O projeto e as validações
            não mudam.
          </p>
        </div>
        <button className="button secondary" onClick={onBack}>
          Voltar à validação <ArrowRight size={16} />
        </button>
      </div>
      <div className="export-layout">
        <aside className="export-list">
          <div className="parts-search">
            <Search size={16} />
            <input
              id="export-search"
              aria-label="Buscar peça para exportar"
              placeholder="Buscar peça ou material"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="export-list-actions">
            <span>{selected.length} selecionada(s)</span>
            {selected.length > 0 && (
              <button
                type="button"
                className="text-button"
                onClick={() => setSelected([])}
              >
                Limpar
              </button>
            )}
          </div>
          <ul>
            {visible.map((p) => {
              const on = selected.includes(p.id);
              const [w, h, d] = p.dimensions;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`export-item ${on ? "selected" : ""}`}
                    aria-pressed={on}
                    onClick={() => toggle(p.id)}
                  >
                    {on ? <CheckSquare size={16} /> : <Square size={16} />}
                    <span className="export-name">{p.label}</span>
                    <small>
                      {fmtLen(w)} × {fmtLen(h)} × {fmtLen(d)} cm
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
        <div className="export-viewer">
          <Viewer
            scene={scene}
            project={project}
            selected={selected}
            view="perspective"
            focusTick={focusTick}
            isolate={selected.length > 0}
            xray={false}
            onSelect={(id) => toggle(id)}
            onReady={noop}
          />
          {!selected.length && (
            <p className="export-hint">
              Clique nas peças da lista ou no 3D para escolher o que exportar.
            </p>
          )}
        </div>
        <aside className="export-options">
          <h2>Arquivo</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={center}
              onChange={(e) => setCenter(e.target.checked)}
            />
            Centralizar e apoiar no chão
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={separate}
              onChange={(e) => setSeparate(e.target.checked)}
            />
            Um arquivo por peça (ZIP)
          </label>
          <p className="muted">
            Sem centralizar, as peças mantêm a posição que têm no stand, úteis
            para remontar o conjunto em outra ferramenta.
          </p>
          <button
            type="button"
            className="button primary"
            disabled={!selected.length || busy}
            onClick={run}
          >
            <Download size={16} />
            {busy
              ? "Gerando…"
              : separate && selected.length > 1
                ? `Exportar ${selected.length} peças (.zip)`
                : "Exportar .glb"}
          </button>
        </aside>
      </div>
    </section>
  );
}
