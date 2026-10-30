import { useEffect, useState } from "react";
import { prepareRelationsPayload } from "./payload.js";

export function useRelations(project, analysis, geometryKey) {
  const [state, setState] = useState({ graph: null, busy: false, error: "", percent: 0 }), [generation, setGeneration] = useState(0), [cancel, setCancel] = useState(null);
  useEffect(() => {
    if (!project || !analysis) { setState({ graph: null, busy: false, error: "", percent: 0 }); return; }
    const controller = new AbortController(); let worker = null;
    const stop = () => { controller.abort(); worker?.terminate(); };
    setCancel(() => () => { stop(); setState({ graph: null, busy: false, error: "Contexto cancelado; nenhuma hipótese foi aplicada.", percent: 0 }); });
    setState({ graph: null, busy: true, error: "", percent: 0 });
    prepareRelationsPayload(project.parts, analysis.meshMap, project.sourceUnit, { signal: controller.signal,
      onProgress: percent => { if (!controller.signal.aborted) setState(s => ({ ...s, percent })); } })
      .then(({ data, transfer }) => {
        if (controller.signal.aborted) return;
        data.parts = project.parts.map(p => ({ id: p.id, meshIds: p.meshIds, bounds: p.bounds }));
        worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
        const finish = (error, result) => {
          worker.terminate(); if (controller.signal.aborted) return;
          if (error) { setState({ graph: null, busy: false, error, percent: 0 }); return; }
          const neighbors = new Map(project.parts.map(p => [p.id, []]));
          result.edges.forEach(e => { neighbors.get(e.a)?.push(e); neighbors.get(e.b)?.push(e); });
          setState({ graph: { ...result, neighbors }, busy: false, error: "", percent: 100 });
        };
        worker.onmessage = ({ data }) => {
          if (data.progress) { if (!controller.signal.aborted) setState(s => ({ ...s, testedPairs: data.progress.testedPairs })); return; }
          finish(data.error, data.result);
        };
        worker.onerror = e => finish(e.message || "Falha no Worker de contexto.");
        worker.postMessage(data, transfer); setState(s => ({ ...s, percent: 40 }));
      }).catch(e => { worker?.terminate(); if (!controller.signal.aborted) setState({ graph: null, busy: false, error: e.message, percent: 0 }); });
    return stop;
  }, [geometryKey, analysis, project?.sourceUnit, generation]);
  return { ...state, cancel, restart: () => setGeneration(n => n + 1) };
}
