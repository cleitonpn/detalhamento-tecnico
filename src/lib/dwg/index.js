import { unzip } from "fflate";
import { DwgSceneBuilder, guessUnit } from "./scene.js";

export const CAD_PATTERN = /\.(dwg|dxf)$/i;
export const isCadFile = (name) =>
  CAD_PATTERN.test(name) || /\.zip$/i.test(name);

// Projetos chegam zipados (WeTransfer): usa o maior DWG/DXF de dentro.
async function extract(name, buffer) {
  if (!/\.zip$/i.test(name)) return { name, buffer };
  const files = await new Promise((resolve, reject) =>
    unzip(
      new Uint8Array(buffer),
      {
        filter: (f) =>
          CAD_PATTERN.test(f.name) && !/(^|\/)__MACOSX\//.test(f.name),
      },
      (err, out) => (err ? reject(err) : resolve(out)),
    ),
  );
  const [entry] = Object.entries(files).sort(
    (a, b) => b[1].length - a[1].length,
  );
  if (!entry) throw Error("O ZIP não contém um arquivo .dwg ou .dxf.");
  const [inner, data] = entry;
  return {
    name: inner,
    buffer: data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ),
  };
}

function parseInWorker(buffer, isDxf) {
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
      reject(Error(event.message || "Falha no leitor de DWG."));
    };
    worker.postMessage({ buffer, isDxf }, [buffer]);
  });
}

/** Lê DWG/DXF/ZIP e devolve uma cena com os blocos como peças, sem passar por GLB. */
export async function loadCad(fileName, sourceBuffer) {
  const { name, buffer } = await extract(fileName, sourceBuffer.slice(0));
  const model = await parseInWorker(buffer, /\.dxf$/i.test(name));
  const scene = new DwgSceneBuilder(model).build();
  let meshes = 0;
  scene.traverse((o) => {
    if (o.isMesh) meshes++;
  });
  if (!meshes) {
    const solids = model.stats.solids3d;
    throw Error(
      solids
        ? `O desenho só tem ${solids} sólido(s) ACIS (3DSOLID), que não podem ser lidos. No AutoCAD, converta-os com MESHSMOOTH e salve de novo.`
        : "O desenho não contém peças 3D (malhas ou faces).",
    );
  }
  const { unit, mismatch } = guessUnit(model.units, scene);
  scene.userData.dtSourceUnit = unit;
  scene.userData.dtCad = {
    innerName: name,
    declaredUnits: model.units,
    unitMismatch: mismatch,
    solids3d: model.stats.solids3d,
    solidsConverted: model.stats.solidsConverted || 0,
    solidFacesSkipped: model.stats.solidFacesSkipped || 0,
    solidReadFailures: model.stats.skipped?.["leitura dos sólidos"] || 0,
    faces: model.stats.faces,
  };
  return scene;
}
