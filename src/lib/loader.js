import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

// Mesmos decodificadores e versão de Three do Studio, com suporte KTX2 detectado no renderer real.
export async function loadModel(file, renderer) {
  const draco = new DRACOLoader().setDecoderPath("/decoders/draco/");
  const ktx = new KTX2Loader()
    .setTranscoderPath("/decoders/basis/")
    .detectSupport(renderer);
  const loader = new GLTFLoader()
    .setDRACOLoader(draco)
    .setKTX2Loader(ktx)
    .setMeshoptDecoder(MeshoptDecoder);
  try {
    const result = await loader.parseAsync(await file.arrayBuffer(), "");
    result.scene.traverse((node) => {
      const index = result.parser.associations.get(node)?.nodes;
      if (index !== undefined)
        node.userData.originalName =
          result.parser.json.nodes[index]?.name || node.name;
    });
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
