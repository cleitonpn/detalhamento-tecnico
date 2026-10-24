import { SkpSceneBuilder } from "./scene.js";

export const isSkpFile = (name) => /\.skp$/i.test(name || "");

function parseInWorker(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      data.ok ? resolve(data.model) : reject(Error(data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(Error(event.message || "Falha no leitor do SketchUp."));
    };
    worker.postMessage({ buffer }, [buffer]);
  });
}

/** Lê o .skp direto (sem SketchUp nem conversão) e devolve a cena com as peças marcadas. */
export async function loadSkp(sourceBuffer) {
  const model = await parseInWorker(sourceBuffer.slice(0));
  const scene = new SkpSceneBuilder(model).build();
  let meshes = 0;
  scene.traverse((o) => {
    if (o.isMesh) meshes++;
  });
  if (!meshes) throw Error("O modelo do SketchUp não tem faces para detalhar.");
  // O leitor já entrega metros (o SketchUp mede em polegadas por dentro)
  scene.userData.dtSourceUnit = "m";
  scene.userData.dtSkp = { version: model.version, ...model.stats };
  return scene;
}
