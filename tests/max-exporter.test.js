import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { partitionScene } from "../src/lib/model.js";

// O exportador do 3ds Max roda em Python; aqui roda com uma cena simulada (sem o Max)
const python = ["python3", "python", "py"].find(
  (cmd) => spawnSync(cmd, ["--version"]).status === 0,
);

test(
  "exportador do 3ds Max: grupo girado e testeira com dois materiais",
  { skip: !python && "sem Python" },
  async () => {
    const out = join(mkdtempSync(join(tmpdir(), "dt-max-")), "cena.glb");
    const run = spawnSync(python, ["extensions/3dsmax/simular_cena.py", out], {
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "2 3"); // 2 peças, 3 objetos (o oculto fica de fora)
    const buf = readFileSync(out);
    const res = await new GLTFLoader().parseAsync(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      "",
    );
    res.scene.traverse((node) => {
      const i = res.parser.associations.get(node)?.nodes;
      if (i !== undefined)
        node.userData.originalName =
          res.parser.json.nodes[i]?.name || node.name;
    });
    const { parts } = partitionScene(res.scene, "m");
    const cm = (p) => p.dimensions.map((v) => Math.round(v * 1000) / 10);
    const balcao = parts.find((p) => p.label === "Balcão recepção");
    const testeira = parts.find((p) => p.label === "Testeira frontal");
    assert.deepEqual(cm(balcao), [200, 100, 60]); // girado 30°: medido nos eixos do grupo
    assert.deepEqual(cm(testeira), [300, 100, 3]);
    assert.ok(Math.abs(testeira.bounds.min[1] - 3.4) < 1e-6);
    assert.deepEqual(testeira.materialsOriginal.sort(), [
      "Adesivo MOOVE",
      "Laca branca",
    ]);
    assert.equal(testeira.suggestion.kind, "fascia");
  },
);
