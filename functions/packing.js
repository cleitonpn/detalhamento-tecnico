import { gzipSync, gunzipSync } from "node:zlib";
import { fromStoredParts } from "./domain.js";

// Um documento do Firestore aceita até 1 MiB: a lista de peças vai compactada
// (o JSON de um levantamento encolhe ~10×); o resumo fica legível para a lista.
export const MAX_PACKED_PARTS = 900 * 1024;

export function packParts(parts) {
  const packed = gzipSync(Buffer.from(JSON.stringify(parts), "utf8"), {
    level: 9,
  });
  if (packed.length > MAX_PACKED_PARTS)
    throw Error(
      "O levantamento ficou grande demais mesmo compactado. Divida o projeto em arquivos menores.",
    );
  return packed;
}

/** Peças de um documento salvo: compactadas (atual) ou em lista (projetos antigos). */
export function unpackParts(data) {
  if (data?.partsGz)
    return JSON.parse(gunzipSync(Buffer.from(data.partsGz)).toString("utf8"));
  return fromStoredParts(data?.parts);
}
