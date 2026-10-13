import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { partitionScene } from "../src/lib/model.js";
import {
  checkProject,
  confirmParts,
  createRelease,
  newProject,
  progress,
  updateParts,
  MAX_FILE_BYTES,
  materialLabel,
} from "../src/domain/project.js";
import {
  applyStudioSource,
  productionEnvelope,
} from "../src/services/integration.js";
import materials from "../src/data/materials.json" with { type: "json" };

function fixture() {
  const scene = new THREE.Scene();
  scene.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(3, 2.9, 0.1),
      new THREE.MeshStandardMaterial(),
    ),
  );
  const analysis = partitionScene(scene);
  const project = {
    ...newProject(
      { name: "Stand.glb", size: 100 },
      { ...analysis, hash: "a".repeat(64) },
    ),
    materials,
  };
  return { project, analysis };
}
test("sugestão não valida peça; revisão exige material e conferência dimensional", () => {
  let { project } = fixture();
  const ids = project.parts.map((p) => p.id);
  assert.throws(() => createRelease(project, 1), /pendentes/);
  project = updateParts(project, ids, {
    review: { kind: "wall", materialId: "custo-492" },
  });
  assert.throws(() => confirmParts(project, ids), /medidas/);
  project = updateParts(project, ids, {
    review: { dimensionsConfirmed: true },
  });
  project = confirmParts(project, ids);
  checkProject(project);
  assert.equal(progress(project).pending, 0);
  const release = createRelease(project, 1);
  assert.equal(release.constructionRelease, false);
  project = updateParts(project, ids, { review: { notes: "Alteração" } });
  assert.equal(progress(project).pending, 1);
  assert.equal(release.parts[0].review.notes, "");
});
test("metalon é validado com as medidas externas do GLB, sem seção ou espessura manual", () => {
  let { project } = fixture();
  const ids = project.parts.map((p) => p.id);
  const dimensions = structuredClone(project.parts[0].dimensions);
  project = updateParts(project, ids, {
    review: {
      kind: "metalon",
      materialId: "metalon-custom",
    },
  });
  assert.throws(() => confirmParts(project, ids), /medidas/);
  project = updateParts(project, ids, {
    review: { dimensionsConfirmed: true },
  });
  project = confirmParts(project, ids);
  assert.equal(progress(project).pending, 0);
  assert.deepEqual(createRelease(project, 1).parts[0].dimensions, dimensions);
});
test("metalon de um projeto antigo ignora dados de seção manual e mantém suas dimensões", () => {
  let { project } = fixture();
  const dimensions = structuredClone(project.parts[0].dimensions);
  project.materials = project.materials.map((m) =>
    m.id === "metalon-custom"
      ? { ...m, name: "Metalon — seção a informar" }
      : m,
  );
  project.parts[0].review = {
    ...project.parts[0].review,
    kind: "metalon",
    materialId: "metalon-custom",
    dimensionsConfirmed: true,
    profileWidthMm: 20,
    profileHeightMm: 20,
    wallThicknessMm: 15,
  };
  project = confirmParts(project, [project.parts[0].id]);
  checkProject(project);
  const release = createRelease(project, 1);
  assert.deepEqual(release.parts[0].dimensions, dimensions);
  assert.equal(
    materialLabel(release.materials.find((m) => m.id === "metalon-custom")),
    "Metalon",
  );
});
test("recusa materiais desconhecidos, malhas duplicadas e revisão inválida", () => {
  const { project } = fixture();
  assert.throws(
    () =>
      checkProject({
        ...project,
        parts: [...project.parts, { ...project.parts[0], id: "other" }],
      }),
    /malha/,
  );
  project.parts[0].review.materialId = "unknown";
  assert.throws(() => checkProject(project), /catálogo/);
});
test("Studio exige o mesmo GLB e reaproveita nomes sem fingir validação construtiva", () => {
  const { project, analysis } = fixture(),
    part = project.parts[0],
    key = analysis.meshMap.get(part.meshIds[0]).userData.studioKey;
  const source = {
    contract: "studio.detailing-source",
    schemaVersion: 1,
    orderId: "order_1",
    revision: 2,
    file: { hash: project.file.hash },
    elements: [
      { id: "wall_1", name: "Parede C01", pieceKeys: [key], kind: "wall" },
    ],
  };
  assert.throws(
    () =>
      applyStudioSource(
        project,
        { ...source, file: { hash: "b".repeat(64) } },
        analysis.meshMap,
      ),
    /outro GLB/,
  );
  const r = applyStudioSource(project, source, analysis.meshMap);
  assert.equal(r.reused, 1);
  assert.equal(r.project.parts[0].label, "Parede C01");
  assert.equal(r.project.parts[0].review.confirmed, false);
  let validated = updateParts(r.project, [part.id], {
    review: { kind: "ignore" },
  });
  validated = confirmParts(validated, [part.id]);
  const envelope = productionEnvelope(createRelease(validated, 1));
  assert.equal(envelope.orderId, "order_1");
  assert.equal(envelope.sourceRevision, 2);
  assert.equal(envelope.constructionRelease, false);
});
test("catálogo derivado não contém custos nem exige seção manual de metalon", () => {
  assert.ok(materials.every((m) => !("cost" in m) && !("price" in m)));
  assert.equal(materials.find((m) => m.id === "custo-498").thicknessMm, 15);
  assert.deepEqual(
    materials.find((m) => m.id === "custo-498").sheetM,
    [2.75, 1.83],
  );
  assert.equal(
    materials.find((m) => m.id === "metalon-custom").thicknessMm,
    null,
  );
});

test("domínio aceita modelos grandes e mantém o teto do upload", () => {
  const { project } = fixture();
  project.file.bytes = 84_181_968;
  assert.doesNotThrow(() => checkProject(project));
  project.file.bytes = MAX_FILE_BYTES;
  assert.doesNotThrow(() => checkProject(project));
  project.file.bytes++;
  assert.throws(() => checkProject(project), /200 MB/);
});
