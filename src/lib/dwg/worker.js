import { LibreDwg } from "@mlightcad/libredwg-web";
import { parseDwg } from "./parse.js";

let libPromise = null;

self.onmessage = async ({ data: { buffer, isDxf } }) => {
  try {
    libPromise ??= LibreDwg.create();
    const lib = await libPromise;
    const input = isDxf ? new TextDecoder().decode(buffer) : buffer;
    const { model, transfer } = parseDwg(lib, input, isDxf);
    self.postMessage({ ok: true, model }, transfer);
  } catch (error) {
    // Um erro grave pode deixar o heap do wasm inconsistente: recria na próxima leitura.
    libPromise = null;
    self.postMessage({ ok: false, error: String(error?.message || error) });
  }
};
