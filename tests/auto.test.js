import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { partitionScene } from "../src/lib/model.js";
import { fingerprint, nameKey } from "../src/lib/auto/fingerprint.js";
import { classifyPart, standContext } from "../src/lib/auto/rules.js";
import {
  autoReview,
  acceptGreen,
  autoStats,
  greenPending,
  memoryEntries,
  projectMemory,
} from "../src/lib/auto/index.js";
import {
  checkMemoryEntries,
  mergeMemory,
  confirmParts,
} from "../src/domain/project.js";
import catalog from "../src/data/materials.json" with { type: "json" };

// Cena com caixas (metros): [nome, largura, altura, profundidade, x, y, z, giro em graus]
function scene(items) {
  const root = new THREE.Group();
  for (const [name, w, h, d, x, y, z, rot = 0] of items) {
    const g = new THREE.Group();
    g.name = name;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d).translate(w / 2, h / 2, d / 2),
      new THREE.MeshStandardMaterial({ name: "Padrão" }),
    );
    g.add(m);
    g.position.set(x, y, z);
    g.rotation.y = (rot * Math.PI) / 180;
    root.add(g);
  }
  return partitionScene(root, "m").parts;
}
const STAND = [
  ["Piso", 6, 0.1, 6, 0, 0, 0],
  ["Peça 2", 6, 3, 0.1, 0, 0.1, 0], // parede de fundo
  ["Peça 3", 3, 0.6, 0.018, 1.5, 3, 0.2], // testeira de 18 mm a 3 m
  ["Peça 4", 0.04, 0.04, 2.5, 1, 0.1, 2], // perfil
  ["Peça 5", 0.9, 0.018, 0.35, 2, 1.2, 0.2], // prateleira de 18 mm
  ["Peça 6", 1, 0.5, 0, 3, 1.5, 0.11], // imagem sem espessura
  ["Garrafa esquecida", 0.3, 0.3, 0.3, 60, 0, 60], // longe do stand
];

test("nome automático não identifica; sufixo de cópia é ignorado", () => {
  assert.equal(nameKey("Peça 12"), "");
  assert.equal(nameKey("Agrupar#7"), "");
  assert.equal(nameKey("3DSOLID 92AC"), "");
  assert.equal(nameKey("Balcão Recepção 2"), "balcao recepcao");
  assert.equal(nameKey("BANQUETA (1)"), "banqueta");
});

test("impressão digital: a mesma peça girada e em outro lugar tem as mesmas chaves", () => {
  const [a, b, c] = scene([
    ["Balcão", 1.2, 1, 0.6, 0, 0, 0],
    ["Balcão", 1.2, 1, 0.6, 7, 0, 3, 90],
    ["Balcão", 1.2, 1.05, 0.6, 0, 0, 5],
  ]);
  assert.deepEqual(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint.exact, c.fingerprint.exact);
  assert.ok(a.fingerprint.shape, "nome de verdade gera chave de forma");
  const generic = fingerprint({ dimensions: [1, 1, 1], tris: 12, area: 6, name: "Peça 3" });
  assert.equal(generic.shape, null);
});

test("regras: parede, testeira, piso, perfil, prateleira, imagem e peça esquecida", () => {
  const parts = scene(STAND);
  const ctx = standContext(parts);
  const kind = (label) => classifyPart(parts.find((p) => p.label === label), ctx);
  assert.equal(kind("Piso").kind, "floor");
  assert.equal(kind("Peça 2").kind, "wall");
  const testeira = kind("Peça 3");
  assert.equal(testeira.kind, "fascia");
  assert.equal(testeira.materialId, "custo-499"); // chapa de 18 mm pela espessura
  assert.equal(kind("Peça 4").kind, "metalon");
  const prateleira = kind("Peça 5");
  assert.equal(prateleira.kind, "other");
  assert.equal(prateleira.materialId, "custo-499");
  assert.equal(kind("Peça 6").kind, "finish");
  const longe = kind("Garrafa esquecida");
  assert.equal(longe.kind, "ignore");
  assert.match(longe.reasons[0], /Fora da área do stand/);
});

test("sem memória, as regras pré-preenchem e o semáforo separa o que conferir", () => {
  const parts = autoReview(scene(STAND), new Map(), catalog);
  const piso = parts.find((p) => p.label === "Piso");
  assert.equal(piso.review.kind, "floor"); // pré-preenchido
  assert.equal(piso.review.confirmed, false); // nunca valida sozinho
  assert.equal(parts.find((p) => p.label === "Garrafa esquecida").auto.level, "green");
  const st = autoStats({ parts });
  assert.equal(st.green + st.yellow + st.red, parts.length);
});

test("memória: peça já validada em outro projeto volta verde, com material e revestimento", () => {
  // Projeto anterior: o humano validou o balcão como mobiliário com bagum
  const before = autoReview(scene([["Balcão Recepção", 1.2, 1, 0.6, 0, 0, 0]]), new Map(), catalog);
  before[0].review = {
    ...before[0].review,
    kind: "furniture",
    materialId: "custo-499",
    finishId: "bagum",
    dimensionsConfirmed: true,
    confirmed: true,
  };
  const memory = projectMemory(before);
  // Projeto novo: o mesmo balcão em outro lugar, girado
  const now = autoReview(
    scene([["Balcão Recepção", 1.2, 1, 0.6, 9, 0, 9, 180]]),
    memory,
    catalog,
  );
  assert.equal(now[0].auto.source, "memory");
  assert.equal(now[0].auto.level, "green");
  assert.deepEqual(
    [now[0].review.kind, now[0].review.materialId, now[0].review.finishId],
    ["furniture", "custo-499", "bagum"],
  );
});

test("decisões divergentes para a mesma peça deixam de ser verdes", () => {
  const key = "0123456789abc";
  const a = mergeMemory(null, { key, kind: "wall", materialId: "custo-498", finishId: "", label: "x" });
  const b = mergeMemory(a, { key, kind: "fascia", materialId: "custo-498", finishId: "", label: "x" });
  assert.equal(b.n, 2);
  assert.equal(b.conflict, true);
});

test("validar uma peça propaga para as idênticas, e o lote aceita só as verdes", () => {
  const items = Array.from({ length: 5 }, (_, i) => ["Peça", 0.94, 0.04, 0.04, i, 0.5, 1]);
  let project = {
    materials: catalog,
    parts: autoReview(scene([...STAND, ...items]), new Map(), catalog),
  };
  const perfis = project.parts.filter((p) => Math.abs(p.dimensions[0] - 0.94) < 1e-6);
  assert.equal(perfis.length, 5);
  // O humano valida um perfil como metalon
  const first = perfis[0].id;
  project = {
    ...project,
    parts: project.parts.map((p) =>
      p.id === first
        ? { ...p, review: { ...p.review, kind: "metalon", materialId: "metalon-custom", dimensionsConfirmed: true } }
        : p,
    ),
  };
  project = confirmParts(project, [first]);
  project = { ...project, parts: autoReview(project.parts, projectMemory(project.parts), catalog) };
  const others = project.parts.filter((p) => perfis.some((q) => q.id === p.id) && p.id !== first);
  assert.ok(others.every((p) => p.auto.level === "green" && p.auto.source === "memory"));
  const pending = greenPending(project);
  assert.ok(pending >= 4);
  const { project: done, count } = acceptGreen(project);
  assert.equal(count, pending);
  assert.ok(others.every((p) => done.parts.find((q) => q.id === p.id).review.confirmed));
  // Amarelas e vermelhas continuam para o humano
  assert.ok(done.parts.some((p) => !p.review.confirmed && p.auto.level !== "green"));
  const st = autoStats(done);
  assert.equal(st.rate, 100);
  assert.ok(memoryEntries(done.parts).length >= 5);
});

test("memória só aceita decisões válidas", () => {
  assert.throws(() => checkMemoryEntries([{ key: "x", kind: "wall" }]), /inválida/);
  assert.throws(
    () => checkMemoryEntries([{ key: "0123456789abc", kind: "unclassified" }]),
    /inválida/,
  );
  assert.throws(
    () => checkMemoryEntries([{ key: "0123456789abc", kind: "wall", materialId: "a b" }]),
    /Material inválido/,
  );
  const [ok] = checkMemoryEntries([
    { key: "0123456789abc", kind: "wall", materialId: "custo-498", label: "Parede" },
  ]);
  assert.equal(ok.finishId, "");
});
