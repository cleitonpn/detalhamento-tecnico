import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const isCadFile = (name) => /\.(dwg|dxf|zip)$/i.test(name || "");

export const LIGHTWEIGHT_THRESHOLD_BYTES = 50 * 1024 * 1024;
export const useLightweightMode = (file) =>
  file.size > LIGHTWEIGHT_THRESHOLD_BYTES;

// Mesmos decodificadores e versão de Three do Studio, com suporte KTX2 detectado no renderer real.
export async function loadModel(
  file,
  renderer,
  { buffer, loadTextures = !useLightweightMode(file) } = {},
) {
  if (/\.skp$/i.test(file.name)) {
    // SketchUp 2021+: leitor próprio, sem SketchUp nem conversão
    const { loadSkp } = await import("./skp/index.js");
    try {
      return await loadSkp(buffer ?? (await file.arrayBuffer()));
    } catch (error) {
      throw Error(`Não foi possível ler o modelo do SketchUp. ${error.message}`);
    }
  }
  if (isCadFile(file.name)) {
    // DWG/DXF/ZIP: lido direto, sem conversão para GLB. Carregado sob demanda (wasm de ~9 MB).
    const { loadCad } = await import("./dwg/index.js");
    try {
      return await loadCad(file.name, buffer ?? (await file.arrayBuffer()));
    } catch (error) {
      throw Error(`Não foi possível ler o desenho. ${error.message}`);
    }
  }
  const baseUrl = import.meta.env?.BASE_URL || "/";
  const draco = new DRACOLoader().setDecoderPath(`${baseUrl}decoders/draco/`);
  const ktx = new KTX2Loader()
    .setTranscoderPath(`${baseUrl}decoders/basis/`)
    .detectSupport(renderer);
  const loader = new GLTFLoader()
    .setDRACOLoader(draco)
    .setKTX2Loader(ktx)
    .setMeshoptDecoder(MeshoptDecoder);
  if (!loadTextures) {
    // Impede a decodificação e o envio de imagens à GPU, inclusive nas extensões
    // Basis/WebP/AVIF. Mantém geometria, hierarquia, nomes e cores dos materiais.
    loader.register((parser) => {
      parser.loadTexture = () => Promise.resolve(null);
      parser.loadTextureImage = () => Promise.resolve(null);
      return { name: "DT_geometry_only" };
    });
  }
  try {
    const result = await loader.parseAsync(
      buffer ?? (await file.arrayBuffer()),
      "",
    );
    result.scene.traverse((node) => {
      const index = result.parser.associations.get(node)?.nodes;
      if (index !== undefined)
        node.userData.originalName =
          result.parser.json.nodes[index]?.name || node.name;
    });
    result.scene.userData.dtLightweight = !loadTextures;
    return result.scene;
  } catch (error) {
    throw Error(
      `Não foi possível ler o GLB. ${error.message || "Confira o arquivo e tente novamente."}`,
    );
  } finally {
    draco.dispose();
    ktx.dispose();
  }
}
