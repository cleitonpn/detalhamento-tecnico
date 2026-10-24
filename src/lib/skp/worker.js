import { parseSkp } from "./parse.js";

// Leitura do .skp fora da tela principal: 50 MB de modelo levam alguns segundos.
self.onmessage = ({ data: { buffer } }) => {
  try {
    const model = parseSkp(new Uint8Array(buffer));
    const transfer = [];
    for (const def of [...Object.values(model.definitions), model.model])
      for (const m of def.meshes)
        transfer.push(m.positions.buffer, m.normals.buffer);
    self.postMessage({ ok: true, model }, transfer);
  } catch (error) {
    self.postMessage({ ok: false, error: String(error?.message || error) });
  }
};
