import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Download,
  Plus,
  Search,
  Trash2,
  RotateCw,
  Wand2,
} from "lucide-react";
import { sheetSvg } from "../lib/sheet.js";
import {
  newArt,
  autoZones,
  partFaces,
  defaultFace,
  faceLabel,
  worldTriangles,
  markerLabel,
  artSheet,
  buildArtMap,
  downloadArtPdf,
} from "../lib/artbook.js";
import { fmtLen } from "../lib/techdraw.js";
import { artEligibility } from "../lib/artEligibility.js";
import ImportWarnings from "./ImportWarnings.jsx";
import { createSpatialIndex } from "../lib/context/spatial.js";
import { ZONE_KINDS, zoneKind, refreshZones } from "../lib/artZones.js";
import Viewer from "./Viewer.jsx";
import { pickedArtFace } from "../lib/artFacePicking.js";

// As artes ficam neste navegador, por projeto (como no Arte Guide)
const key = (id) => `dt.arts.${id}`;
function load(id) {
  try {
    return JSON.parse(localStorage.getItem(key(id)) || "[]");
  } catch {
    return [];
  }
}
function save(id, arts) {
  try {
    localStorage.setItem(key(id), JSON.stringify(arts));
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
}
const relabel = (arts) =>
  arts.map((a, i) => ({ ...a, marker: markerLabel(i) }));
const num = (v) => {
  const n = Math.abs(parseFloat(String(v).replace(",", ".")));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Caderno de arte: escolhe as paredes, ajusta cada arte (tamanho, sangria,
 * interferências) e baixa o PDF com o mapa de instalação e um gabarito por arte.
 */
export default function ArtBook({
  project,
  analysis,
  scene,
  onBack,
  onError,
  onNotice,
}) {
  const [arts, setArts] = useState(() => load(project.id)),
    [current, setCurrent] = useState("map"),
    [query, setQuery] = useState(""),
    [showAll, setShowAll] = useState(false),
    [pickingFace, setPickingFace] = useState(false),
    [pickerView, setPickerView] = useState("perspective"),
    [pendingPart, setPendingPart] = useState(null),
    [corner, setCorner] = useState("auto"),
    [shownCorner, setShownCorner] = useState(0),
    [sheet, setSheet] = useState(null),
    [busy, setBusy] = useState(false);

  useEffect(() => save(project.id, arts), [project.id, arts]);
  const art = arts.find((a) => a.id === current);
  const partOf = (a) => project.parts.find((p) => p.id === a.partId);

  useEffect(() => {
    if (!arts.length) {
      setSheet(null);
      return;
    }
    setSheet(null);
    const timer = setTimeout(() => {
      try {
        if (art) setSheet(sheetSvg(artSheet(project, art, analysis.meshMap)));
        else {
          const built = buildArtMap(project, arts, analysis.meshMap, corner);
          setSheet(sheetSvg(built));
          setShownCorner(built.corner);
        }
      } catch (e) {
        onError(`Não foi possível desenhar o caderno. ${e.message}`);
      }
    }, 30);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art, arts, project, analysis, corner, onError]);

  // Faces planas da peça (calculadas sob demanda e guardadas por peça)
  const facesOf = useMemo(() => {
    const cache = new Map();
    return (part) => {
      if (!part) return [];
      if (!cache.has(part.id))
        cache.set(
          part.id,
          partFaces(part, analysis.meshMap, project.sourceUnit, project.parts),
        );
      return cache.get(part.id);
    };
  }, [analysis, project.sourceUnit, project.parts]);

  const visible = useMemo(() => project.parts.filter(p => {
    if (!p.label.toLowerCase().includes(query.toLowerCase())) return false;
    if (showAll || arts.some(a => a.partId === p.id)) return true;
    return artEligibility(p).candidate && facesOf(p).length > 0;
  }), [project.parts, query, showAll, arts, facesOf]);

  // Geometria real de cada peça (no mundo), para medir o que fica diante da face
  const zoneOptions = useMemo(() => {
    const cache = new Map();
    return {
      spatialIndex: createSpatialIndex(project.parts),
      trianglesOf: (part) => {
        if (!cache.has(part.id))
          cache.set(
            part.id,
            worldTriangles(part, analysis.meshMap, project.sourceUnit),
          );
        return cache.get(part.id);
      },
    };
  }, [analysis, project.sourceUnit, project.parts]);
  const zonesFor = (a, part) => autoZones(a, part, project.parts, zoneOptions);

  // Artes salvas antes do contorno da face: completa a face com o contorno atual
  useEffect(() => {
    if (
      !arts.some(
        (a) => a.face && typeof a.face === "object" && !("outline" in a.face),
      )
    )
      return;
    setArts((list) =>
      list.map((a) => {
        if (!a.face || typeof a.face !== "object" || "outline" in a.face)
          return a;
        const face = facesOf(partOf(a)).find((f) => f.key === a.face.key);
        return { ...a, face: { ...a.face, outline: face?.outline || null } };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facesOf]);

  function addPart(part, override = false) {
    const eligibility = artEligibility(part);
    if (eligibility.blocked) return;
    if (!eligibility.candidate && !override) {
      setPendingPart(part);
      return;
    }
    const faces = facesOf(part);
    if (!faces.length) {
      onError("Nenhuma face plana vertical adequada foi detectada. Não é possível gerar um gabarito plano confiável desta peça.");
      return;
    }
    // Começa pela face livre que olha para o centro do stand; face encostada em
    // outra peça (testeira por fora da parede) dá lugar à face vista
    const i = defaultFace(faces, part, project.parts, zoneOptions);
    const created = newArt(
      part,
      arts.length,
      faces[i] || null,
      faces[i] ? faceLabel(faces[i], i) : "",
    );
    created.zones = zonesFor(created, part);
    created.eligibilityOverride = override;
    const next = relabel([...arts, created]);
    setArts(next);
    setCurrent(created.id);
    setPendingPart(null);
  }
  const update = (patch) =>
    setArts((list) =>
      list.map((a) => (a.id === art.id ? { ...a, ...patch } : a)),
    );
  const updateZone = (zid, patch) =>
    update({
      zones: art.zones.map((z) => (z.id === zid ? { ...z, ...patch, auto: false } : z)),
    });

  function detect() {
    const part = partOf(art);
    if (!part) return;
    const found = zonesFor(art, part);
    update({ zones: refreshZones(art.zones, found) });
    onNotice(
      found.length
        ? `${found.length} obstrução(ões) visual(is) encontrada(s). Confirme manualmente os recortes necessários.`
        : "Nenhuma peça encostada nesta face.",
    );
  }

  // Trocar de face muda o tamanho da arte e refaz as interferências automáticas
  function chooseFace(i) {
    const part = partOf(art);
    const face = facesOf(part)[i];
    if (!face) return;
    const base = newArt(part, 0, face, faceLabel(face, i));
    const next = {
      ...art,
      face: base.face,
      faceName: base.faceName,
      w: base.w,
      h: base.h,
    };
    next.zones = refreshZones(art.zones.map(z => ({ ...z, requiresReview: true })), zonesFor(next, part));
    setArts((list) => list.map((a) => (a.id === art.id ? next : a)));
  }

  async function pdf() {
    setBusy(true);
    try {
      await downloadArtPdf(project, arts, analysis.meshMap, corner);
    } catch (e) {
      onError(`Não foi possível gerar o PDF. ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="documents-screen art-screen">
      {pickingFace && art && scene && (
        <div className="modal-backdrop">
          <section className="modal face-picker" role="dialog" aria-label="Escolher face no modelo 3D">
            <h2>Escolher face no modelo 3D</h2>
            <p>Gire a peça e clique na superfície que receberá a arte. Só faces planas detectadas podem ser escolhidas.</p>
            <div className="face-picker-views">
              {[["perspective", "Perspectiva"], ["front", "Frente"], ["side", "Lateral"], ["top", "Planta"]].map(([id, label]) =>
                <button key={id} className="button secondary" onClick={() => setPickerView(id)}>{label}</button>)}
            </div>
            <div className="face-picker-canvas">
              <Viewer scene={scene} project={project} selected={[art.partId]} view={pickerView}
                focusTick={1} isolate={true} xray={false} onReady={() => {}} onSelect={() => {}}
                onFaceSelect={(part, point, normal) => {
                  const i = pickedArtFace(part, facesOf(part), point, normal);
                  if (i < 0) { onNotice("O ponto escolhido não corresponde a uma face plana elegível. Escolha outra superfície."); return; }
                  chooseFace(i);
                  setPickingFace(false);
                  onNotice("Face escolhida no 3D. Confira orientação, dimensões e interferências.");
                }} />
            </div>
            <button className="button secondary" onClick={() => setPickingFace(false)}>Cancelar seleção de face</button>
          </section>
        </div>
      )}
      <div className="section-title">
        <div>
          <span className="eyebrow">Comunicação visual</span>
          <h1>Caderno de arte</h1>
          <p>
            Escolha as paredes que recebem arte. Cada uma vira um gabarito A4
            com medidas, sangria e áreas de interferência, e o mapa de
            instalação mostra onde fica cada arte (A, B, C…).
          </p>
        </div>
        <button className="button secondary" onClick={onBack}>
          Voltar à validação <ArrowRight size={16} />
        </button>
      </div>
      <ImportWarnings warnings={project.importDiagnostics?.warnings} />
      <div className="art-layout">
        <aside className="export-list">
          <h2 className="art-subtitle">Superfícies para arte</h2>
          <p className="helper">Faces planas candidatas de paredes, testeiras e balcões. Confira o lado e a dimensão útil antes de produzir.</p>
          <label className="check-field">
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            <span>Mostrar todos os objetos</span>
          </label>
          {pendingPart && (
            <div className="validation-hint" role="note">
              <p>{pendingPart.label}: {artEligibility(pendingPart).reason}</p>
              <button className="button secondary" onClick={() => addPart(pendingPart, true)}>Confirmar suporte de arte</button>
              <button className="text-button" onClick={() => setPendingPart(null)}>Cancelar exceção</button>
            </div>
          )}
          <div className="parts-search">
            <Search size={16} />
            <input
              id="art-search"
              aria-label="Buscar parede"
              placeholder="Buscar peça"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <ul>
            {visible.map((p) => {
              const used = arts.find((a) => a.partId === p.id);
              const eligibility = artEligibility(p);
              const face = eligibility.candidate ? facesOf(p)[0] : null;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`export-item ${used ? "selected" : ""}`}
                    disabled={!used && eligibility.blocked}
                    onClick={() => (used ? setCurrent(used.id) : addPart(p))}
                    title={
                      used
                        ? `Arte ${used.marker}`
                        : eligibility.reason
                    }
                  >
                    {used ? (
                      <span className="art-tag">{used.marker}</span>
                    ) : (
                      <Plus size={15} />
                    )}
                    <span className="export-name">{p.label}</span>
                    <small>
                      {face ? `${fmtLen(face.w)} × ${fmtLen(face.h)} cm · face candidata` : eligibility.blocked ? "Sem suporte físico" : "Exige seleção de face"}
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
          {!visible.length && <p className="helper">Nenhuma face candidata. Use “Mostrar todos os objetos” para avaliar uma exceção.</p>}
        </aside>

        <div className="art-preview">
          <div
            className="art-chips"
            role="tablist"
            aria-label="Folhas do caderno de arte"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!art}
              className={!art ? "active" : ""}
              onClick={() => setCurrent("map")}
            >
              Mapa
            </button>
            {arts.map((a) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={art?.id === a.id}
                className={art?.id === a.id ? "active" : ""}
                onClick={() => setCurrent(a.id)}
              >
                {a.marker}
              </button>
            ))}
            <div className="spacer" />
            {!art && arts.length > 0 && (
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  setCorner(
                    ((typeof corner === "number" ? corner : shownCorner) + 1) %
                      4,
                  )
                }
              >
                <RotateCw size={15} /> Girar vista
              </button>
            )}
            <button
              type="button"
              className="button primary"
              disabled={!arts.length || busy}
              onClick={pdf}
            >
              <Download size={16} /> {busy ? "Gerando…" : "Baixar PDF"}
            </button>
          </div>
          {!arts.length ? (
            <p className="drawing-empty">
              Clique em uma parede na lista para criar a primeira arte. O
              tamanho vem da peça e as peças encostadas nela (TV, prateleiras,
              balcão) entram como obstruções visuais, não como recortes automáticos.
            </p>
          ) : sheet ? (
            <div
              className="technical-sheet"
              dangerouslySetInnerHTML={{ __html: sheet }}
            />
          ) : (
            <p className="sheet-loading">Desenhando o caderno…</p>
          )}
        </div>

        <aside className="export-options art-form">
          {!art ? (
            <p className="muted">
              Escolha uma arte (A, B…) acima para ajustar tamanho, sangria e
              interferências.
            </p>
          ) : (
            <>
              <h2>
                Arte {art.marker} · {partOf(art)?.label}
              </h2>
              <label className="field">
                Título
                <input
                  id="art-title"
                  value={art.title}
                  onChange={(e) => update({ title: e.target.value })}
                />
              </label>
              <label className="field">
                Face da peça que recebe a arte
                <select
                  id="art-face"
                  value={Math.max(
                    0,
                    facesOf(partOf(art)).findIndex(
                      (f) => f.key === art.face?.key,
                    ),
                  )}
                  onChange={(e) => chooseFace(Number(e.target.value))}
                >
                  {facesOf(partOf(art)).map((f, i) => (
                    <option key={f.key} value={i}>
                      {faceLabel(f, i)}
                    </option>
                  ))}
                </select>
                {scene && <button className="button secondary" onClick={() => setPickingFace(true)}>Escolher face no 3D</button>}
              </label>
              <div className="field-grid">
                <label className="field">
                  Largura (cm)
                  <input
                    id="art-w"
                    inputMode="decimal"
                    value={art.w}
                    onChange={(e) => update({ w: num(e.target.value) })}
                  />
                </label>
                <label className="field">
                  Altura (cm)
                  <input
                    id="art-h"
                    inputMode="decimal"
                    value={art.h}
                    onChange={(e) => update({ h: num(e.target.value) })}
                  />
                </label>
                <label className="field">
                  Sangria (cm)
                  <input
                    id="art-bleed"
                    inputMode="decimal"
                    value={art.bleed}
                    onChange={(e) => update({ bleed: num(e.target.value) })}
                  />
                </label>
                <span />
                <label className="field">
                  Segurança larg.
                  <input
                    id="art-safe-w"
                    inputMode="decimal"
                    value={art.safeW}
                    onChange={(e) => update({ safeW: num(e.target.value) })}
                  />
                </label>
                <label className="field">
                  Segurança alt.
                  <input
                    id="art-safe-h"
                    inputMode="decimal"
                    value={art.safeH}
                    onChange={(e) => update({ safeH: num(e.target.value) })}
                  />
                </label>
              </div>
              <div className="art-zones-head">
                <strong>Interferências ({art.zones.length})</strong>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => detect()}
                >
                  <Wand2 size={14} /> Detectar
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    update({
                      zones: [
                        ...art.zones,
                        {
                          id: `m-${Date.now()}`,
                          label: "Interferência",
                          kind: "obstruction",
                          x: 0,
                          y: 0,
                          w: 30,
                          h: 30,
                        },
                      ],
                    })
                  }
                >
                  <Plus size={14} /> Manual
                </button>
              </div>
              <p className="muted small">
                Posição em cm a partir do canto superior esquerdo da arte.
                {" "}A detecção sugere obstruções visuais; recortes precisam de confirmação sua.
              </p>
              {art.zones.some(z => !z.kind) && <p className="validation-hint">Áreas antigas sem tipo foram mantidas como recortes legados. Confira cada uma.</p>}
              {art.zones.map((z) => (
                <div key={z.id} className="zone-card">
                  <div className="zone-head">
                    <input
                      aria-label="Nome da interferência"
                      value={z.label}
                      onChange={(e) =>
                        updateZone(z.id, { label: e.target.value })
                      }
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remover interferência"
                      onClick={() =>
                        update({
                          zones: art.zones.filter((x) => x.id !== z.id),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <label className="field">
                    Tipo de interferência
                    <select value={zoneKind(z)} onChange={e => updateZone(z.id, {
                      kind: e.target.value, confirmedByUser: e.target.value === "cutout", requiresReview: false,
                    })}>
                      {Object.entries(ZONE_KINDS).map(([id, title]) => <option key={id} value={id}>{title}</option>)}
                    </select>
                  </label>
                  {z.requiresReview && <div className="validation-hint">
                    <p>A face mudou. Confira o tipo, as medidas e a posição desta área.</p>
                    <button className="text-button" onClick={() => updateZone(z.id, {
                      requiresReview: false, confirmedByUser: zoneKind(z) === "cutout",
                    })}>Conferi esta área na face atual</button>
                  </div>}
                  <div className="zone-grid">
                    {[
                      ["x", "X"],
                      ["y", "Y"],
                      ["w", "Larg."],
                      ["h", "Alt."],
                    ].map(([f, label]) => (
                      <label key={f}>
                        {label}
                        <input
                          inputMode="decimal"
                          value={z[f]}
                          onChange={(e) =>
                            updateZone(z.id, { [f]: num(e.target.value) })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <label className="field">
                Observações
                <input
                  id="art-notes"
                  value={art.notes}
                  onChange={(e) => update({ notes: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="text-button danger"
                onClick={() => {
                  setArts(relabel(arts.filter((a) => a.id !== art.id)));
                  setCurrent("map");
                }}
              >
                <Trash2 size={14} /> Remover arte {art.marker}
              </button>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
