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
test("propostas e versões são validadas no contrato e copiadas para revisão dimensional independente", () => {
  let { project } = fixture();
  project.constructionCatalog = [{ id: "material-draft", version: 1, name: "Ficha pendente", family: "rigid-sheet", parameters: {}, approved: false }];
  project.constructionRecipes = [];
  const construction = { schemaVersion: 1, recipeId: "wall-straight", recipeVersion: 1,
    layers: { substrate: { id: "material-draft", version: 1 } }, parameters: {}, referenceArc: null, notes: "Proposta incompleta" };
  project = updateParts(project, project.parts.map(p => p.id), { review: {
    kind: "wall", materialId: "custo-492", dimensionsConfirmed: true, construction,
  } });
  checkProject(project);
  project = confirmParts(project, project.parts.map(p => p.id));
  const release = createRelease(project, 1);
  assert.equal(release.constructionRelease, false);
  assert.equal(release.constructionCatalog[0].name, "Ficha pendente");
  assert.equal(release.parts[0].review.construction.notes, "Proposta incompleta");
  project.constructionCatalog[0].name = "Alteração";
  assert.equal(release.constructionCatalog[0].name, "Ficha pendente");
  project.parts[0].review.construction.recipeVersion = 99;
  assert.throws(() => checkProject(project), /não cadastrada/);
});
test("evidência contextual validada é preservada, exige reconferência e não aceita papel divergente", () => {
  let { project } = fixture();
  const ids = project.parts.map(p => p.id);
  project = updateParts(project, ids, { review: { kind: "wall", semanticRole: "wall", materialId: "custo-492", dimensionsConfirmed: true,
    identityEvidence: { source: "context-3", role: "wall", reason: "Painel em contato com piso identificado", fileHash: project.file.hash,
      sourceUnit: "m", relatedPartIds: ["source-floor"], truncated: false }, identityNeedsReview: true } });
  checkProject(project);
  assert.throws(() => confirmParts(project, ids), /identidade contextual/);
  project = updateParts(project, ids, { review: { identityNeedsReview: false } });
  project = confirmParts(project, ids);
  assert.equal(createRelease(project, 1).parts[0].review.identityEvidence.source, "context-3");
  project.parts[0].review.identityEvidence.role = "fascia";
  assert.throws(() => checkProject(project), /Evidência contextual/);
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
  assert.throws(() => checkProject({ ...project, sourceUnit: "__proto__" }), /Unidade/);
  assert.throws(() => checkProject({ ...project, parts: project.parts.map(p => ({ ...p, review: { ...p.review, kind: "constructor" } })) }), /Classificação/);
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

test("contrato compartilhado preserva identidade/destino e valida metadados novos", () => {
  const { project } = fixture();
  project.parts[0].review.semanticRole = "vegetation";
  project.parts[0].review.destination = "excluded";
  project.importDiagnostics = { source: "cad", warnings: [{ code: "missing-faces", message: "2 faces omitidas" }] };
  assert.doesNotThrow(() => checkProject(project));
  assert.equal(project.parts[0].review.semanticRole, "vegetation");
  project.parts[0].review.kind = "ignore";
  project.parts[0].review.confirmed = true;
  const release = createRelease(project, 1);
  assert.equal(release.parts[0].review.semanticRole, "vegetation");
  assert.equal(release.parts[0].review.destination, "excluded");
  assert.equal(release.source.importDiagnostics.warnings[0].code, "missing-faces");
  project.parts[0].review.destination = "invalid";
  assert.throws(() => checkProject(project), /Destino inválido/);
  project.parts[0].review.destination = "excluded";
  project.importDiagnostics.warnings = [{ code: "bad", message: "x" }];
  assert.throws(() => checkProject(project), /Alertas/);
  assert.equal(release.source.importDiagnostics.warnings[0].code, "missing-faces", "revisão é independente de edições posteriores");
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
