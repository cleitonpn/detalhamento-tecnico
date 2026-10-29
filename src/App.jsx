import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  Upload,
  Box,
  CheckCircle2,
  Search,
  ChevronRight,
  Focus,
  Eye,
  Layers,
  Undo2,
  Redo2,
  FileJson,
  FolderOpen,
  X,
  Link2,
  Palette,
  ArrowLeft,
  Plus,
  LoaderCircle,
  LogOut,
} from "lucide-react";
import Viewer from "./components/Viewer.jsx";
import Inspector from "./components/Inspector.jsx";
import Drawings, { downloadJson } from "./components/Drawings.jsx";
import Export3D from "./components/Export3D.jsx";
import ArtBook from "./components/ArtBook.jsx";
import Login from "./components/Login.jsx";
import materials from "./data/materials.json";
import {
  checkProject,
  confirmParts,
  createRelease,
  KINDS,
  MAX_FILE_MB,
  newProject,
  progress,
  SCALE,
  updateParts,
  mergeParts,
  splitPart,
} from "./domain/project.js";
import {
  disposeModel,
  hashFile,
  partitionScene,
  validateFile,
  isCad,
} from "./lib/model.js";
import { loadModel, useLightweightMode } from "./lib/loader.js";
import { demoFile } from "./lib/demo.js";
import { formatM } from "./lib/drawings.js";
import { localRepository } from "./services/localRepository.js";
import {
  acceptGreen,
  autoReview,
  groupIdentical,
  autoStats,
  greenPending,
  memoryEntries,
  memoryKeys,
  mergeMemory,
  refreshAuto,
  trainingSamples,
} from "./lib/auto/index.js";
import { trainModel } from "./lib/auto/learn.js";
import { cloudRepository } from "./services/cloudRepository.js";
import {
  applyStudioSource,
  productionEnvelope,
} from "./services/integration.js";
import { auth, cloudMode } from "./services/firebase.js";
// Script do 3ds Max (2023+): gera o .glb com grupos, nomes, camadas e materiais
import maxExporterUrl from "../extensions/3dsmax/detalha_exportar.py?url";

const appName = import.meta.env.VITE_APP_NAME || "Detalha";
const signature = ({ version, updatedAt, updatedBy, ...project }) =>
  JSON.stringify(project);

export default function App() {
  const [user, setUser] = useState(null),
    [authReady, setAuthReady] = useState(!cloudMode);
  const [project, setProject] = useState(null),
    [scene, setScene] = useState(null),
    [analysis, setAnalysis] = useState(null),
    [file, setFile] = useState(null);
  const [renderer, setRenderer] = useState(null),
    [selected, setSelected] = useState([]),
    [tab, setTab] = useState("validate"),
    [view, setView] = useState("perspective");
  const [isolate, setIsolate] = useState(false),
    [xray, setXray] = useState(false),
    [focusTick, setFocusTick] = useState(0);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [saveState, setSaveState] = useState(""),
    [library, setLibrary] = useState([]),
    [modal, setModal] = useState(null),
    [release, setRelease] = useState(null);
  const [history, setHistory] = useState({ past: [], future: [] }),
    [orderId, setOrderId] = useState("");
  const uploadRef = useRef(),
    restoreRef = useRef(),
    integrationRef = useRef(),
    lastSaved = useRef(""),
    queue = useRef(Promise.resolve()),
    versions = useRef({}),
    // Memória de decisões (impressão digital -> decisão humana) do espaço de trabalho
    memory = useRef(new Map()),
    // Camada 3: exemplos do espaço (chave -> exemplo) e o modelo treinado com eles
    samples = useRef(new Map()),
    model = useRef(null),
    retrain = useRef(0);
  const currentScene = useRef(null),
    requestId = useRef(0);
  const repository = cloudMode ? cloudRepository : localRepository;
  const ready = useCallback((gl) => setRenderer(gl), []);

  useEffect(() => {
    if (!cloudMode || !auth) {
      setAuthReady(true);
      return;
    }
    return onAuthStateChanged(auth, (account) => {
      setUser(account);
      setAuthReady(true);
    });
  }, []);
  useEffect(() => {
    if (cloudMode && !user) return;
    repository
      .list()
      .then(setLibrary)
      .catch((e) => {
        if (cloudMode)
          setNotice(
            "Configure o espaço de trabalho da equipe para começar a salvar no servidor.",
          );
        else setError(e.message);
      });
  }, [user, repository]);
  useEffect(
    () => () => {
      requestId.current++;
      disposeModel(currentScene.current);
    },
    [],
  );

  const persist = useCallback(
    (payload, sourceFile) => {
      const work = queue.current
        .catch(() => {})
        .then(async () => {
          setSaveState("Salvando…");
          const saved = await repository.save(
            {
              ...payload,
              version: versions.current[payload.id] ?? payload.version,
            },
            sourceFile,
          );
          versions.current[payload.id] = saved.version || 0;
          lastSaved.current = signature(saved);
          setProject((current) =>
            current?.id !== saved.id
              ? current
              : signature(current) === signature(payload)
                ? saved
                : { ...current, version: saved.version || 0 },
          );
          setLibrary((current) => [
            saved,
            ...current.filter((p) => p.id !== saved.id),
          ]);
          setSaveState(cloudMode ? "Salvo na equipe" : "Salvo neste navegador");
          return saved;
        });
      queue.current = work;
      return work;
    },
    [repository],
  );
  useEffect(() => {
    if (
      !project ||
      !file ||
      busy ||
      signature(project) === lastSaved.current ||
      (cloudMode && !user)
    )
      return;
    setSaveState("Alterações pendentes");
    const timer = setTimeout(
      () =>
        persist(project, file).catch((e) => {
          setSaveState("Não salvo");
          setError(e.message);
        }),
      700,
    );
    return () => clearTimeout(timer);
  }, [project, file, busy, user, persist]);

  function edit(next) {
    setHistory((h) => ({ past: [...h.past.slice(-39), project], future: [] }));
    setProject({ ...next, status: "review" });
    setRelease(null);
  }
  /**
   * Depois de validar: grava as decisões na memória do espaço e recalcula as
   * sugestões, para que peças idênticas fiquem verdes na hora.
   */
  function commitValidated(next, before) {
    const was = new Set(
      before.parts.filter((p) => p.review.confirmed).map((p) => p.id),
    );
    const fresh = next.parts.filter(
      (p) => p.review.confirmed && !was.has(p.id),
    );
    const entries = memoryEntries(fresh);
    for (const e of entries)
      memory.current.set(e.key, mergeMemory(memory.current.get(e.key), e));
    edit({
      ...next,
      parts: autoReview(next.parts, memory.current, next.materials, {
        model: model.current,
        projectName: next.name,
      }),
    });
    if (entries.length)
      repository
        .memoryRecord(entries)
        .catch((e) => console.warn("Não foi possível gravar na memória:", e));
    // Camada 3: cada validação vira exemplo de treino; o modelo é retreinado em
    // segundo plano e passa a valer nas próximas sugestões
    const fresh2 = trainingSamples(next, fresh);
    if (fresh2.length) {
      for (const s of fresh2) samples.current.set(s.key, s);
      repository
        .samplesRecord(fresh2)
        .catch((e) =>
          console.warn("Não foi possível gravar o aprendizado:", e),
        );
      clearTimeout(retrain.current);
      retrain.current = setTimeout(() => {
        model.current = trainModel([...samples.current.values()]);
      }, 1500);
    }
    return fresh.length;
  }
  // Item da lista com peças iguais: seleciona todas as cópias juntas
  function selectMany(ids, additive = false) {
    setSelected((current) =>
      additive
        ? ids.every((id) => current.includes(id))
          ? current.filter((id) => !ids.includes(id))
          : [...new Set([...current, ...ids])]
        : ids,
    );
  }
  function select(id, additive = false) {
    if (!id) {
      setSelected([]);
      return;
    }
    setSelected((current) =>
      additive
        ? current.includes(id)
          ? current.filter((n) => n !== id)
          : [...current, id]
        : [id],
    );
  }
  function travel(direction) {
    const target =
      direction === "undo" ? history.past.at(-1) : history.future[0];
    if (!target) return;
    if (target.sourceUnit !== project.sourceUnit)
      setAnalysis(partitionScene(scene, target.sourceUnit));
    setHistory((h) =>
      direction === "undo"
        ? { past: h.past.slice(0, -1), future: [project, ...h.future] }
        : { past: [...h.past, project], future: h.future.slice(1) },
    );
    setProject({
      ...target,
      version: project.version,
      revision: project.revision,
      status: "review",
    });
    setSelected([]);
    setRelease(null);
  }
  async function openFile(sourceFile, restored = null, registered = null) {
    if (!renderer) {
      setError("Aguarde a visualização 3D ficar pronta.");
      return;
    }
    const token = ++requestId.current;
    setBusy("Lendo o modelo e organizando as peças…");
    setError("");
    setNotice("");
    let nextScene;
    try {
      await validateFile(sourceFile);
      if (project && file) {
        await queue.current;
        if (signature(project) !== lastSaved.current)
          await persist(project, file);
      }
      setBusy("Conferindo a identidade do arquivo…");
      const buffer = await sourceFile.arrayBuffer();
      const hash = await hashFile(sourceFile, buffer);
      if (restored && hash !== restored.file.hash)
        throw Error("O arquivo salvo não corresponde ao projeto.");
      const lightweight = useLightweightMode(sourceFile);
      setBusy(
        /\.skp$/i.test(sourceFile.name)
          ? "Lendo o modelo do SketchUp e montando as peças…"
          : isCad(sourceFile.name)
            ? "Lendo o desenho DWG e montando as peças 3D…"
            : lightweight
              ? "Lendo a geometria em modo leve, sem texturas…"
              : "Lendo o modelo e suas texturas…",
      );
      nextScene = await loadModel(sourceFile, renderer, { buffer });
      setBusy("Organizando as peças e calculando as medidas…");
      const nextAnalysis = partitionScene(
        nextScene,
        restored?.sourceUnit || nextScene.userData.dtSourceUnit || "m",
      );
      const base = restored || {
        ...newProject(sourceFile, { ...nextAnalysis, hash }),
        sourceUnit: nextScene.userData.dtSourceUnit || "m",
        materials,
      };
      // Camadas 1 e 2: memória de peças já validadas + regras geométricas
      setBusy("Reconhecendo as peças (memória e regras)…");
      let known = new Map();
      try {
        // A memória ajuda, mas nunca segura a abertura do projeto
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(Error("tempo esgotado")), 8000),
        );
        known = new Map(
          Object.entries(
            await Promise.race([
              repository.memoryLookup(memoryKeys(base.parts)),
              timeout,
            ]),
          ),
        );
      } catch (e) {
        console.warn("Memória de peças indisponível:", e);
      }
      // Camada 3: modelo próprio treinado com as peças já validadas no espaço
      try {
        const timeoutSamples = new Promise((_, reject) =>
          setTimeout(() => reject(Error("tempo esgotado")), 8000),
        );
        const list = await Promise.race([
          repository.samplesList(),
          timeoutSamples,
        ]);
        samples.current = new Map(list.map((s) => [s.key, s]));
        model.current = trainModel([...samples.current.values()]);
      } catch (e) {
        console.warn("Aprendizado indisponível:", e);
        model.current = null;
      }
      const next = refreshAuto(base, known, base.materials, {
        model: model.current,
      });
      checkProject(next);
      if (token !== requestId.current) {
        disposeModel(nextScene);
        return;
      }
      disposeModel(currentScene.current);
      currentScene.current = nextScene;
      setScene(nextScene);
      setAnalysis(nextAnalysis);
      setFile(sourceFile);
      setProject(next);
      versions.current[next.id] = next.version || 0;
      lastSaved.current = restored ? signature(restored) : "";
      setSelected([]);
      setHistory({ past: [], future: [] });
      setRelease(registered);
      setTab("validate");
      setModal(null);
      setView("perspective");
      setFocusTick(0);
      setIsolate(false);
      setXray(false);
      memory.current = known;
      const cad = nextScene.userData.dtCad;
      const skp = nextScene.userData.dtSkp;
      if (skp && !restored)
        setNotice(
          `Modelo do SketchUp ${skp.version} aberto direto: ${skp.faces.toLocaleString("pt-BR")} faces e ${skp.instances.toLocaleString("pt-BR")} grupos/componentes. Componentes com nome viram uma peça inteira e itens pequenos (produtos expostos) ficam reunidos. Confira as peças antes de validar.`,
        );
      else if (cad && !restored)
        setNotice(
          [
            `Desenho aberto direto do DWG, em ${nextScene.userData.dtSourceUnit}. Confira a unidade em Dados do projeto.`,
            cad.unitMismatch &&
              "O cabeçalho do arquivo indicava outra unidade; a escolhida segue o tamanho do desenho.",
            cad.solidsConverted &&
              `${cad.solidsConverted} sólido(s) do AutoCAD convertido(s) em peças 3D.`,
            cad.solidFacesSkipped &&
              `${cad.solidFacesSkipped} face(s) com superfície livre (spline) ficaram de fora desses sólidos; confira as peças.`,
            cad.solids3d &&
              `${cad.solids3d} sólido(s) do AutoCAD não puderam ser lidos (arquivo anterior ao AutoCAD 2013 ou geometria não suportada). No AutoCAD, use MESHSMOOTH neles e salve de novo.`,
          ]
            .filter(Boolean)
            .join(" "),
        );
      else if (lightweight)
        setNotice(
          "Modelo aberto em modo leve, sem texturas, para reduzir o uso de memória. A geometria, as medidas e o GLB original foram preservados.",
        );
      if (!restored) {
        const st = autoStats(next);
        const learned = model.current
          ? ` Aprendizado: modelo treinado com ${model.current.size} peças validadas${model.current.accuracy != null ? ` (acerto estimado ${Math.round(model.current.accuracy * 100)}%)` : ""}.`
          : "";
        const summary = `Reconhecimento automático: ${st.green} peça(s) prontas para aceitar, ${st.yellow} para conferir e ${st.red} para decidir.${learned}`;
        setNotice((current) => (current ? `${current} ${summary}` : summary));
      }
    } catch (e) {
      if (nextScene && nextScene !== currentScene.current)
        disposeModel(nextScene);
      setError(e.message);
    } finally {
      if (token === requestId.current) setBusy("");
    }
  }
  async function publish() {
    setBusy("Registrando a revisão validada…");
    setError("");
    try {
      const saved = await persist(project, file);
      const candidate = createRelease(saved, (saved.revision || 0) + 1);
      const result = await repository.publish(saved, candidate);
      const frozen = cloudMode ? result.release : candidate;
      const validated = {
        ...saved,
        status: "validated",
        revision: frozen.revision,
        version: result.version || saved.version,
      };
      versions.current[project.id] = validated.version;
      await (cloudMode ? Promise.resolve() : repository.save(validated, file));
      lastSaved.current = signature(validated);
      setProject(validated);
      setRelease(frozen);
      setNotice(
        `Revisão ${frozen.revision} registrada. O caderno pode ser exportado.`,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  const p = progress(project),
    selectedParts = project?.parts.filter((p) => selected.includes(p.id)) || [];
  const visible =
    project?.parts.filter(
      (p) =>
        `${p.label} ${p.materialsOriginal.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (filter === "all" ||
          (filter === "pending" && !p.review.confirmed) ||
          (filter === "check" &&
            !p.review.confirmed &&
            p.auto?.level !== "green") ||
          (filter === "confirmed" && p.review.confirmed)),
    ) || [];
  if (!authReady)
    return <div className="loading-page">Conferindo seu acesso…</div>;
  if (cloudMode && !user) return <Login />;
  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          onClick={(e) => e.preventDefault()}
        >
          <span className="brand-mark">
            <Box size={23} />
          </span>
          <span>
            <strong>{appName}</strong>
            <small>Do 3D ao caderno técnico</small>
          </span>
        </a>
        <div className="header-divider" />
        <span className="workspace-name">
          {cloudMode ? "Espaço da equipe" : "Espaço local"}
        </span>
        <div className="spacer" />
        <span className="save-state">
          <span className={saveState === "Não salvo" ? "dot warning" : "dot"} />
          {saveState ||
            (cloudMode ? user?.email : "Arquivos ficam neste navegador")}
        </span>
        <button
          className="button secondary compact"
          onClick={() => setModal("library")}
        >
          <FolderOpen size={16} />
          Projetos
        </button>
        {user && (
          <button
            className="icon-button"
            title="Sair"
            onClick={async () => {
              await queue.current.catch(() => {});
              await signOut(auth);
              location.reload();
            }}
          >
            <LogOut size={18} />
          </button>
        )}
      </header>
      {error && (
        <div className="notice error" role="alert">
          <span>{error}</span>
          <button aria-label="Fechar erro" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button aria-label="Fechar aviso" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      <input
        ref={uploadRef}
        type="file"
        accept=".skp,.glb,.dwg,.dxf,.zip"
        hidden
        aria-label="Arquivo do modelo (SKP, GLB, DWG, DXF ou ZIP)"
        onChange={(e) => {
          const f = e.target.files[0];
          e.target.value = "";
          if (f) openFile(f);
        }}
      />
      <input
        ref={restoreRef}
        type="file"
        accept=".json"
        hidden
        aria-label="Restaurar projeto JSON"
        onChange={async (e) => {
          const f = e.target.files[0];
          e.target.value = "";
          if (!f) return;
          try {
            const restored = JSON.parse(await f.text());
            checkProject(restored);
            if (restored.file.hash !== project.file.hash)
              throw Error(
                "Abra o mesmo GLB usado nesta validação antes de restaurar o projeto.",
              );
            const ids = new Set(restored.parts.flatMap((p) => p.meshIds));
            if (
              ids.size !== analysis.meshMap.size ||
              [...ids].some((id) => !analysis.meshMap.has(id))
            )
              throw Error(
                "Os vínculos da validação não correspondem às malhas deste GLB.",
              );
            edit(restored);
            setAnalysis(partitionScene(scene, restored.sourceUnit));
            setSelected([]);
            setNotice(
              "Validação restaurada. Confira os dados e registre uma nova revisão.",
            );
          } catch (err) {
            setError(err.message);
          }
        }}
      />
      <input
        ref={integrationRef}
        type="file"
        accept=".json"
        hidden
        aria-label="Referência Studio JSON"
        onChange={async (e) => {
          const f = e.target.files[0];
          e.target.value = "";
          if (!f) return;
          try {
            const result = applyStudioSource(
              project,
              JSON.parse(await f.text()),
              analysis.meshMap,
            );
            edit(result.project);
            setNotice(
              `${result.reused} conjuntos associados à validação do Studio.`,
            );
          } catch (err) {
            setError(err.message);
          }
        }}
      />
      <nav className="workflow">
        <div className={`step ${!project ? "active" : "complete"}`}>
          <span>{project ? <CheckCircle2 size={15} /> : 1}</span>Enviar projeto
        </div>
        <ChevronRight size={15} />
        <button
          className={`step ${project && tab === "validate" ? "active" : ""}`}
          disabled={!project}
          onClick={() => setTab("validate")}
        >
          <span>2</span>Validar peças
        </button>
        <ChevronRight size={15} />
        <button
          className={`step ${tab === "drawings" ? "active" : ""}`}
          disabled={!project}
          onClick={() => setTab("drawings")}
        >
          <span>3</span>Caderno técnico
        </button>
        <div className="spacer" />
        {project && (
          <span className="progress-summary">
            <strong>
              {p.confirmed}/{p.total}
            </strong>{" "}
            peças validadas
          </span>
        )}
      </nav>
      {project && (
        <div className="project-strip">
          <input
            aria-label="Nome do projeto"
            value={project.name}
            onChange={(e) => edit({ ...project, name: e.target.value })}
          />
          <span className="file-name">{project.file.name}</span>
          <div className="spacer" />
          <button
            className={`text-button ${tab === "export" ? "active" : ""}`}
            onClick={() => setTab("export")}
          >
            <Box size={15} />
            Exportar 3D
          </button>
          <button
            className={`text-button ${tab === "art" ? "active" : ""}`}
            onClick={() => setTab("art")}
          >
            <Palette size={15} />
            Caderno de arte
          </button>
          <button className="text-button" onClick={() => setModal("project")}>
            Dados do projeto
          </button>
          <button
            className="text-button"
            onClick={() => setModal("integration")}
          >
            <Link2 size={15} />
            Integrações
          </button>
          <button
            className="text-button"
            disabled={Boolean(busy)}
            onClick={() => uploadRef.current.click()}
          >
            <Plus size={15} />
            Novo modelo
          </button>
        </div>
      )}
      <div
        className={
          tab === "drawings" || tab === "export" || tab === "art"
            ? "workspace hidden-workspace"
            : "workspace"
        }
      >
        {project && (
          <aside className="parts-panel">
            <div className="panel-heading">
              <Box size={17} />
              <h2>Peças do modelo</h2>
              <span className="count">{p.total}</span>
            </div>
            <div className="parts-search">
              <Search size={16} />
              <input
                aria-label="Buscar peças"
                placeholder="Buscar peça ou material"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="filters">
              {[
                ["all", "Todas"],
                ["pending", "Pendentes"],
                ["check", "Conferir"],
                ["confirmed", "Validadas"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={filter === id ? "active" : ""}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="parts-list">
              {groupIdentical(visible).map(({ part, ids, quantity }, i) => (
                <button
                  key={part.id}
                  data-part-id={part.id}
                  className={`part-row ${ids.every((id) => selected.includes(id)) ? "selected" : ""}`}
                  onClick={(e) =>
                    selectMany(ids, e.shiftKey || e.ctrlKey || e.metaKey)
                  }
                >
                  <span
                    className={`part-number ${part.review.confirmed ? "confirmed" : ""}`}
                  >
                    {part.review.confirmed ? (
                      <CheckCircle2 size={15} />
                    ) : (
                      String(i + 1).padStart(2, "0")
                    )}
                  </span>
                  {!part.review.confirmed && part.auto && (
                    <i
                      className={`auto-dot ${part.auto.level}`}
                      title={`${Math.round(part.auto.confidence * 100)}% · ${part.auto.reasons[0]}`}
                      aria-label={
                        {
                          green: "Pronta para aceitar",
                          yellow: "Conferir",
                          red: "Decidir",
                        }[part.auto.level]
                      }
                    />
                  )}
                  <span>
                    <strong>
                      {part.label}
                      {quantity > 1 && (
                        <em className="qty" title="Peças iguais">
                          ×{quantity}
                        </em>
                      )}
                    </strong>
                    <small>
                      {KINDS[part.review.kind]} ·{" "}
                      {part.dimensions.map(formatM).join(" × ")} m
                    </small>
                  </span>
                  <ChevronRight size={13} />
                </button>
              ))}
              {!visible.length && (
                <p className="helper no-results">Nenhuma peça neste filtro.</p>
              )}
            </div>
            {greenPending(project) > 0 && (
              <div className="auto-accept">
                <p>
                  <i className="auto-dot green" /> {greenPending(project)}{" "}
                  peça(s) reconhecidas com segurança (memória ou regras).
                </p>
                <button
                  className="button primary full"
                  onClick={() => {
                    const r = acceptGreen(project);
                    if (!r.count) return;
                    commitValidated(r.project, project);
                    setNotice(
                      `${r.count} peça(s) aceitas com as medidas do modelo. Revise as amarelas e vermelhas no filtro Conferir.`,
                    );
                  }}
                >
                  Aceitar {greenPending(project)} sugestões verdes
                </button>
              </div>
            )}
            <div className="parts-footer">
              <div className="progress-track">
                <span style={{ width: `${p.percent}%` }} />
              </div>
              <p>
                {p.pending
                  ? `${p.pending} peças para conferir`
                  : "Todas as peças foram conferidas"}
              </p>
              {model.current && (
                <p className="helper">
                  Aprendizado: {model.current.size} peças validadas
                  {model.current.accuracy != null &&
                    ` · acerto estimado ${Math.round(model.current.accuracy * 100)}%`}
                </p>
              )}
              {(() => {
                const st = autoStats(project);
                return st.rate === null ? null : (
                  <p className="helper">
                    Sugestões aceitas sem mudança: {st.rate}% ({st.accepted} de{" "}
                    {st.accepted + st.edited})
                  </p>
                );
              })()}
            </div>
          </aside>
        )}
        <main
          className={`viewer-shell ${!project ? "landing-viewer" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f && !busy) openFile(f);
          }}
        >
          <Viewer
            {...{ scene, project, selected, view, focusTick, isolate, xray }}
            onSelect={select}
            onReady={ready}
          />
          {!project && !busy && (
            <div className="landing-card">
              <span className="eyebrow">
                Menos interpretação. Mais clareza.
              </span>
              <h1>
                Seu stand,
                <br />
                <em>peça por peça.</em>
              </h1>
              <p>
                Envie o modelo 3D, confira os conjuntos e diga como cada peça
                será construída. A ferramenta organiza as medidas e prepara o
                caderno.
              </p>
              <button
                className="button primary large"
                disabled={!renderer}
                onClick={() => uploadRef.current.click()}
              >
                <Upload size={19} />
                Enviar modelo (.skp, .dwg ou .glb)
              </button>
              <button
                className="text-button demo-button"
                disabled={!renderer}
                onClick={async () => {
                  try {
                    await openFile(await demoFile());
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                Explorar uma demonstração <ChevronRight size={16} />
              </button>
              <small>
                Até {MAX_FILE_MB} MB · SketchUp 2021+, DWG, DXF, ZIP do
                WeTransfer ou GLB 2.0
              </small>
              <a
                className="text-button"
                href={maxExporterUrl}
                download="detalha_exportar.py"
              >
                Usa 3ds Max? Baixe o exportador para o Detalha
              </a>
            </div>
          )}
          {project && (
            <>
              <div className="viewer-toolbar">
                <div className="view-switch">
                  {[
                    ["perspective", "3D"],
                    ["top", "Planta"],
                    ["front", "Frente"],
                    ["side", "Lateral"],
                  ].map(([id, name]) => (
                    <button
                      key={id}
                      className={view === id ? "active" : ""}
                      onClick={() => {
                        setView(id);
                        setFocusTick(0);
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <div className="toolbar-divider" />
                <button
                  className="icon-button"
                  disabled={!selected.length}
                  title="Enquadrar seleção"
                  aria-label="Enquadrar seleção"
                  onClick={() => setFocusTick((t) => t + 1)}
                >
                  <Focus size={17} />
                </button>
                <button
                  className={`icon-button ${isolate ? "active" : ""}`}
                  disabled={!selected.length}
                  title="Isolar seleção"
                  aria-label="Isolar seleção"
                  onClick={() => setIsolate(!isolate)}
                >
                  <Layers size={17} />
                </button>
                <button
                  className={`icon-button ${xray ? "active" : ""}`}
                  title="Transparência"
                  aria-label="Transparência"
                  onClick={() => setXray(!xray)}
                >
                  <Eye size={17} />
                </button>
                <div className="toolbar-divider" />
                <button
                  className="icon-button"
                  disabled={!history.past.length}
                  title="Desfazer"
                  aria-label="Desfazer"
                  onClick={() => travel("undo")}
                >
                  <Undo2 size={16} />
                </button>
                <button
                  className="icon-button"
                  disabled={!history.future.length}
                  title="Refazer"
                  aria-label="Refazer"
                  onClick={() => travel("redo")}
                >
                  <Redo2 size={16} />
                </button>
              </div>
              <div className="viewer-caption">
                <span className="dot" />
                {selected.length
                  ? `${selected.length} peça(s) selecionada(s)`
                  : "Clique em uma peça para conferir"}
                <small>Arraste para girar · Scroll para aproximar</small>
              </div>
              <div className="model-stat">
                {analysis?.meshes} malhas · unidade de origem{" "}
                <strong>{project.sourceUnit}</strong>
                {scene?.userData.dtLightweight && " · Modo leve (sem texturas)"}
              </div>
            </>
          )}
          {busy && (
            <div className="busy-overlay" role="status">
              <LoaderCircle className="spin" size={32} />
              <strong>{busy}</strong>
            </div>
          )}
        </main>
        {project && (
          <Inspector
            parts={selectedParts}
            materials={project.materials}
            onChange={(patch) => edit(updateParts(project, selected, patch))}
            onConfirm={() => {
              try {
                commitValidated(confirmParts(project, selected), project);
                setNotice(
                  "Peças validadas e guardadas na memória. Peças idênticas foram atualizadas.",
                );
              } catch (e) {
                setError(e.message);
              }
            }}
            onMerge={() => {
              try {
                const r = mergeParts(project, selected);
                edit(r.project);
                setSelected([r.part.id]);
              } catch (e) {
                setError(e.message);
              }
            }}
            onSplit={() => {
              try {
                edit(splitPart(project, selected[0], analysis.meshParts));
                setSelected([]);
              } catch (e) {
                setError(e.message);
              }
            }}
          />
        )}
      </div>
      {project && tab === "art" && (
        <ArtBook
          project={project}
          analysis={analysis}
          onBack={() => setTab("validate")}
          onError={setError}
          onNotice={setNotice}
        />
      )}
      {project && tab === "export" && (
        <Export3D
          project={project}
          analysis={analysis}
          scene={scene}
          onBack={() => setTab("validate")}
          onError={setError}
          onNotice={setNotice}
        />
      )}
      {project && tab === "drawings" && (
        <Drawings
          {...{ project, analysis, release }}
          onPublish={publish}
          onBack={() => setTab("validate")}
          onError={setError}
        />
      )}
      {busy && (
        <div className="busy-overlay global-busy" role="status">
          <LoaderCircle className="spin" size={32} />
          <strong>{busy}</strong>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "library"
                ? "Projetos salvos"
                : modal === "project"
                  ? "Dados do projeto"
                  : "Integrações"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              aria-label="Fechar janela"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "library" && (
              <>
                <span className="eyebrow">Seu espaço de trabalho</span>
                <h2>Projetos salvos</h2>
                <p>
                  {cloudMode
                    ? "Arquivos da equipe."
                    : "Estes projetos e seus arquivos de modelo estão neste navegador."}
                </p>
                {library.length ? (
                  library.map((item) => (
                    <button
                      className="library-item"
                      key={item.id}
                      disabled={!renderer || Boolean(busy)}
                      onClick={async () => {
                        try {
                          const saved = await repository.get(item.id);
                          await openFile(
                            saved.file,
                            saved.project,
                            saved.release,
                          );
                        } catch (e) {
                          setError(e.message);
                        }
                      }}
                    >
                      <Box size={20} />
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.confirmedCount ?? progress(item).confirmed}/
                          {item.partCount ?? item.parts.length} peças validadas
                        </small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))
                ) : (
                  <p className="helper">Nenhum projeto salvo ainda.</p>
                )}
                {cloudMode && (
                  <button
                    className="button secondary full"
                    onClick={async () => {
                      try {
                        await cloudRepository.initialize();
                        setNotice("Espaço de trabalho disponível.");
                        setLibrary(await repository.list());
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Preparar espaço da equipe
                  </button>
                )}
              </>
            )}
            {modal === "project" && project && (
              <>
                <span className="eyebrow">Identificação e escala</span>
                <h2>Dados do projeto</h2>
                <label>
                  Cliente / expositor
                  <input
                    value={project.client}
                    onChange={(e) =>
                      edit({ ...project, client: e.target.value })
                    }
                  />
                </label>
                <label>
                  Feira
                  <input
                    value={project.fair}
                    onChange={(e) => edit({ ...project, fair: e.target.value })}
                  />
                </label>
                <label>
                  Unidade usada na exportação do GLB
                  <select
                    value={project.sourceUnit}
                    onChange={(e) => {
                      const unit = e.target.value;
                      const next = partitionScene(scene, unit);
                      edit({
                        ...project,
                        sourceUnit: unit,
                        parts: project.parts.map((p) => {
                          const factor =
                            SCALE[unit] / SCALE[project.sourceUnit];
                          return {
                            ...p,
                            dimensions: p.dimensions.map((n) => n * factor),
                            bounds: {
                              min: p.bounds.min.map((n) => n * factor),
                              max: p.bounds.max.map((n) => n * factor),
                            },
                            frame: p.frame
                              ? {
                                  ...p.frame,
                                  origin: p.frame.origin.map((n) => n * factor),
                                }
                              : undefined,
                            review: {
                              ...p.review,
                              dimensionsConfirmed: false,
                              confirmed: false,
                            },
                          };
                        }),
                      });
                      setAnalysis(next);
                    }}
                  >
                    <option value="m">Metros (m)</option>
                    <option value="cm">Centímetros (cm)</option>
                    <option value="mm">Milímetros (mm)</option>
                  </select>
                </label>
                <p className="helper">
                  O formato glTF usa metros. Altere apenas se a exportação
                  original estiver em outra escala. A alteração exige conferir
                  as medidas novamente.
                </p>
                <div className="modal-actions">
                  <button
                    className="button secondary"
                    onClick={() =>
                      downloadJson(project, `${project.name}-projeto.json`)
                    }
                  >
                    <FileJson size={16} />
                    Exportar validação
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => restoreRef.current.click()}
                  >
                    Restaurar validação
                  </button>
                </div>
                <p className="helper">
                  O JSON preserva os dados. Para restaurar em outro navegador,
                  abra também o mesmo GLB.
                </p>
              </>
            )}
            {modal === "integration" && project && (
              <>
                <span className="eyebrow">Conexões preparadas</span>
                <h2>Studio e produção</h2>
                <p>
                  A ferramenta funciona por conta própria. Os contratos de
                  integração mantêm projeto, revisão e identidade do GLB
                  associados.
                </p>
                <div className="integration-card">
                  <strong>Studio → Detalha</strong>
                  <p>
                    Associe a referência de uma configuração aprovada. As peças
                    compatíveis recuperam os nomes e vínculos já validados.
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => integrationRef.current.click()}
                  >
                    Importar referência do Studio
                  </button>
                  {cloudMode && (
                    <>
                      <label>
                        Identificador da ordem
                        <input
                          value={orderId}
                          onChange={(e) => setOrderId(e.target.value)}
                          placeholder="Ordem aprovada no Studio"
                        />
                      </label>
                      <button
                        className="button secondary"
                        disabled={!orderId}
                        onClick={async () => {
                          try {
                            const source =
                              await cloudRepository.studioSource(orderId);
                            const result = applyStudioSource(
                              project,
                              source,
                              analysis.meshMap,
                            );
                            edit(result.project);
                            setNotice(
                              `${result.reused} conjuntos associados ao Studio.`,
                            );
                          } catch (e) {
                            setError(e.message);
                          }
                        }}
                      >
                        Buscar configuração aprovada
                      </button>
                    </>
                  )}
                </div>
                <div className="integration-card">
                  <strong>Detalha → Produção</strong>
                  <p>
                    Exporte a referência da revisão técnica para o app de
                    produção. O vínculo automático será ativado quando os
                    aplicativos estiverem interligados.
                  </p>
                  <button
                    className="button secondary"
                    disabled={!release || project.status !== "validated"}
                    onClick={() =>
                      downloadJson(
                        productionEnvelope(release),
                        `${project.name}-producao.json`,
                      )
                    }
                  >
                    Exportar referência para produção
                  </button>
                </div>
                {project.integration && (
                  <p className="helper">
                    Ordem: {project.integration.orderId} · revisão de origem:{" "}
                    {project.integration.sourceRevision}
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
