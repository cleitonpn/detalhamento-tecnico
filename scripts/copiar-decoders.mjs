// Copia os decodificadores do three (Draco / KTX2-Basis) para public/decoders.
//
// Projetos .glb de fornecedores costumam vir com malha comprimida em Draco ou
// texturas em KTX2. Sem o decodificador registrado, o GLTFLoader recusa um
// arquivo que é perfeitamente válido — e o erro não diz que o problema é esse.
//
// Rodamos isso no prebuild em vez de versionar ~2 MB de binário: assim os
// decodificadores acompanham a versão do three instalada.
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const libs = resolve(raiz, "node_modules/three/examples/jsm/libs");
const destino = resolve(raiz, "public/decoders");

if (!existsSync(libs)) {
  console.error(
    "[decoders] three não encontrado em node_modules — rode npm install antes.",
  );
  process.exit(1);
}

await rm(destino, { recursive: true, force: true });
await mkdir(destino, { recursive: true });

// Draco: só o lado de decodificação (o encoder tem ~1 MB e não usamos).
await mkdir(resolve(destino, "draco"), { recursive: true });
for (const f of [
  "draco_decoder.js",
  "draco_decoder.wasm",
  "draco_wasm_wrapper.js",
]) {
  await cp(resolve(libs, "draco/gltf", f), resolve(destino, "draco", f));
}

// KTX2 / Basis transcoder.
await cp(resolve(libs, "basis"), resolve(destino, "basis"), {
  recursive: true,
});

console.log("[decoders] Draco e KTX2 copiados para public/decoders");
