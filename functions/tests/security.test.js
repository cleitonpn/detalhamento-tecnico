import test from "node:test";
import assert from "node:assert/strict";
import {
  requireMember,
  modelPath,
  checkVersion,
  assertStudioAdmin,
  assertProvisioned,
} from "../security.js";

test("exige membro ativo e separa consulta de edição", () => {
  assert.throws(() => requireMember(null), /acesso/);
  assert.throws(
    () => requireMember({ active: false, role: "owner" }),
    /acesso/,
  );
  assert.throws(
    () => requireMember({ active: true, role: "unknown" }),
    /acesso/,
  );
  assert.doesNotThrow(() => requireMember({ active: true, role: "viewer" }));
  assert.throws(
    () => requireMember({ active: true, role: "viewer" }, true),
    /acesso/,
  );
  assert.doesNotThrow(() =>
    requireMember({ active: true, role: "editor" }, true),
  );
});
test("somente uma conta provisionada pode criar um espaço independente", () => {
  assert.throws(() => assertProvisioned({}), /ativação/);
  assert.throws(() => assertProvisioned({ detalhamento: false }), /ativação/);
  assert.doesNotThrow(() => assertProvisioned({ detalhamento: true }));
});
test("namespace de arquivo não aceita caminhos arbitrários", () => {
  assert.throws(
    () => modelPath("../studio", "project", "a".repeat(64)),
    /inválido/,
  );
  assert.throws(
    () => modelPath("team", "../project", "a".repeat(64)),
    /inválido/,
  );
  assert.throws(() => modelPath("team", "project", "bad"), /inválida/);
  assert.equal(
    modelPath("team", "project", "a".repeat(64)),
    `dt_workspaces/team/projects/project/models/${"a".repeat(64)}.glb`,
  );
});
test("não sobrescreve outra sessão e não aceita expositor na integração Studio", () => {
  assert.doesNotThrow(() => checkVersion(0, undefined));
  assert.throws(() => checkVersion(1, 2), /outra tela/);
  assert.throws(
    () => assertStudioAdmin({ papel: "expositor", ativo: true }),
    /administrativa/,
  );
  assert.throws(
    () => assertStudioAdmin({ papel: "admin", ativo: false }),
    /administrativa/,
  );
  assert.doesNotThrow(() => assertStudioAdmin({ papel: "admin", ativo: true }));
});

test("modelos DWG, DXF e ZIP: caminho com extensão e assinatura conferida", async () => {
  const { modelFormat, checkModelHeader } = await import("../domain.js");
  const h = "a".repeat(64);
  assert.equal(
    modelPath("team", "project", h, "dwg"),
    `dt_workspaces/team/projects/project/models/${h}.dwg`,
  );
  assert.throws(() => modelPath("team", "project", h, "exe"), /Formato/);
  assert.equal(modelFormat("Stand Eden.DWG"), "dwg");
  assert.equal(modelFormat("wetransfer.zip"), "zip");
  assert.throws(() => modelFormat("modelo.3ds"), /não suportado/);
  // SketchUp: FF FE FF 0E e "SketchUp Model" em UTF-16
  assert.equal(modelFormat("Stand.SKP"), "skp");
  const skp = Buffer.concat([
    Buffer.from([0xff, 0xfe, 0xff, 0x0e]),
    Buffer.from("SketchUp Model", "utf16le"),
  ]);
  assert.ok(checkModelHeader("skp", skp, 1000));
  assert.ok(!checkModelHeader("skp", Buffer.alloc(32), 1000));
  const bytes = (s) => Buffer.from(s, "latin1");
  assert.ok(checkModelHeader("dwg", bytes("AC1032\0\0\0\0\0\0"), 12));
  assert.ok(!checkModelHeader("dwg", bytes("PK\x03\x04garbage"), 12));
  assert.ok(
    checkModelHeader("dxf", bytes("  0\r\nSECTION\r\n  2\r\nHEADER"), 30),
  );
  assert.ok(checkModelHeader("dxf", bytes("AutoCAD Binary DXF\r\n\x1a\0"), 30));
  assert.ok(checkModelHeader("zip", bytes("PK\x03\x04\x14\0"), 6));
  assert.ok(!checkModelHeader("zip", bytes("AC1032"), 6));
  const glb = Buffer.alloc(12);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(12, 8);
  assert.ok(checkModelHeader("glb", glb, 12));
  assert.ok(!checkModelHeader("glb", glb, 13));
});

test("orientação da peça vai plana para o Firestore e volta em três eixos", async () => {
  const { toStoredParts, fromStoredParts } = await import("../domain.js");
  const part = {
    id: "p1",
    frame: {
      origin: [1, 2, 3],
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, -1],
      ],
    },
  };
  const [stored] = toStoredParts([part, { id: "p2" }]);
  // Nenhuma lista dentro de lista (o Firestore recusa)
  assert.ok(stored.frame.axes.every((v) => typeof v === "number"));
  assert.equal(stored.frame.axes.length, 9);
  assert.deepEqual(fromStoredParts([stored])[0], part);
  // Projetos antigos (sem frame) e já convertidos passam intactos
  assert.deepEqual(fromStoredParts([{ id: "p2" }]), [{ id: "p2" }]);
  assert.deepEqual(fromStoredParts([part])[0], part);
});

test("peças vão compactadas para o Firestore: levantamento grande cabe no documento", async () => {
  const { packParts, unpackParts, MAX_PACKED_PARTS } = await import(
    "../packing.js"
  );
  // 3000 peças com 30 malhas cada: ~3 MB de JSON, bem acima de 1 MiB
  const parts = Array.from({ length: 3000 }, (_, i) => ({
    id: `part-0-1-${i}`,
    label: `Peça ${i}`,
    meshIds: Array.from({ length: 30 }, (_, k) => `0/0/3/${i}/${k}/1`),
    bounds: { min: [i * 0.01, 0, 0], max: [i * 0.01 + 1.2, 0.75, 0.6] },
    dimensions: [1.2, 0.75, 0.6],
    frame: {
      origin: [i * 0.01, 0, 0],
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    },
    materialsOriginal: ["MDF Branco", "Adesivo"],
    review: { kind: "unclassified", notes: "" },
  }));
  const raw = Buffer.byteLength(JSON.stringify(parts));
  const packed = packParts(parts);
  assert.ok(raw > 2 * 1024 * 1024, `JSON ${raw}`);
  assert.ok(packed.length < MAX_PACKED_PARTS, `compactado ${packed.length}`);
  assert.deepEqual(unpackParts({ partsGz: packed }), parts);
  // Projetos salvos antes da compactação (orientação em nove números) continuam abrindo
  const legacy = [{ id: "p", frame: { origin: [0, 0, 0], axes: [1, 0, 0, 0, 1, 0, 0, 0, 1] } }];
  assert.deepEqual(unpackParts({ parts: legacy })[0].frame.axes, [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]);
});
