const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const { createRequire } = require("node:module");
const adminRequire = createRequire(
  require.resolve("../functions/package.json"),
);
const { initializeApp: initializeAdmin, deleteApp: deleteAdmin } =
  adminRequire("firebase-admin/app");
const { getAuth: adminAuth } = adminRequire("firebase-admin/auth");
const { getFirestore: adminDb } = adminRequire("firebase-admin/firestore");
const { initializeApp, deleteApp } = require("firebase/app");
const {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
} = require("firebase/auth");
const {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} = require("firebase/functions");
const {
  getStorage,
  connectStorageEmulator,
  ref,
  uploadBytesResumable,
} = require("firebase/storage");
const apps = [];
const admin = initializeAdmin({ projectId: "demo-detalhamento" }, "test-admin");
function client(name) {
  const app = initializeApp(
    {
      projectId: "demo-detalhamento",
      apiKey: "demo-key",
      appId: "demo-app",
      storageBucket: "demo-detalhamento.appspot.com",
    },
    name,
  );
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "southamerica-east1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const storage = getStorage(app);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  return { app, auth, functions, storage };
}
after(async () => {
  await Promise.all([...apps.map(deleteApp), deleteAdmin(admin)]);
});
test("Functions: workspace, upload verificado, concorrência, publicação e isolamento", async () => {
  const owner = client("owner");
  const account = await createUserWithEmailAndPassword(
    owner.auth,
    "owner@example.test",
    "Test-only-password-123",
  );
  const workspaceId = `user_${account.user.uid}`;
  const call = async (name, data = {}) =>
    (
      await httpsCallable(owner.functions, name, { timeout: 180000 })({
        workspaceId,
        ...data,
      })
    ).data;
  await assert.rejects(call("dt_initializeWorkspace"), /ativação/);
  await adminAuth(admin).setCustomUserClaims(account.user.uid, {
    detalhamento: true,
  });
  await account.user.getIdToken(true);
  await call("dt_initializeWorkspace");
  // Cabeçalho GLB para verificar transporte, assinatura e identidade; o teste de geometria é separado.
  const bytes = process.env.DT_GLB_UPLOAD_TEST_FILE
    ? await readFile(process.env.DT_GLB_UPLOAD_TEST_FILE)
    : Buffer.alloc(12);
  if (!process.env.DT_GLB_UPLOAD_TEST_FILE) {
    bytes.writeUInt32LE(0x46546c67, 0);
    bytes.writeUInt32LE(2, 4);
    bytes.writeUInt32LE(12, 8);
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  const file = { name: "fixture.glb", bytes: bytes.length, hash },
    projectId = "project_fixture";
  await assert.rejects(
    call("dt_reserveModel", {
      projectId: "too_large",
      file: { ...file, bytes: 200 * 1024 * 1024 + 1 },
    }),
    /200 MB/,
  );
  const reservation = await call("dt_reserveModel", { projectId, file });
  await uploadBytesResumable(ref(owner.storage, reservation.path), bytes, {
    contentType: "model/gltf-binary",
  });
  const project = {
    schemaVersion: 1,
    id: projectId,
    name: "Fixture",
    client: "",
    fair: "",
    sourceUnit: "m",
    file,
    version: 0,
    revision: 0,
    status: "review",
    materials: [],
    parts: [
      {
        id: "part_1",
        label: "Equipamento",
        meshIds: ["0/0"],
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        dimensions: [1, 1, 1],
        materialsOriginal: ["Render"],
        suggestion: { kind: "equipment", reason: "Fixture" },
        review: {
          kind: "equipment",
          materialId: "",
          finishId: "",
          notes: "",
          dimensionsConfirmed: true,
          confirmed: true,
        },
      },
    ],
  };
  const saved = (await call("dt_saveProject", { project, expectedVersion: 0 }))
    .project;
  assert.equal(saved.version, 1);
  // DWG direto: assinatura AC10xx, tipo de conteúdo próprio e mesma verificação de identidade
  const dwgBytes = Buffer.concat([
    Buffer.from("AC1032", "latin1"),
    Buffer.alloc(26),
  ]);
  const dwgFile = {
    name: "fixture.dwg",
    bytes: dwgBytes.length,
    hash: createHash("sha256").update(dwgBytes).digest("hex"),
  };
  const dwgReservation = await call("dt_reserveModel", {
    projectId: "project_dwg",
    file: dwgFile,
  });
  assert.match(dwgReservation.path, /\.dwg$/);
  assert.equal(dwgReservation.contentType, "image/vnd.dwg");
  await uploadBytesResumable(
    ref(owner.storage, dwgReservation.path),
    dwgBytes,
    {
      contentType: dwgReservation.contentType,
    },
  );
  const dwgSaved = (
    await call("dt_saveProject", {
      project: {
        ...project,
        id: "project_dwg",
        name: "Fixture DWG",
        file: dwgFile,
      },
      expectedVersion: 0,
    })
  ).project;
  assert.equal(dwgSaved.version, 1);
  await assert.rejects(
    call("dt_reserveModel", {
      projectId: "project_skp",
      file: { ...dwgFile, name: "fixture.skp" },
    }),
    /não suportado/,
  );
  await assert.rejects(
    call("dt_saveProject", { project, expectedVersion: 0 }),
    /outra tela/,
  );
  const published = await call("dt_publishRevision", {
    projectId,
    expectedVersion: 1,
  });
  assert.equal(published.release.revision, 1);
  assert.equal(published.release.constructionRelease, false);
  const read = await call("dt_getProject", { projectId });
  assert.equal(read.project.status, "validated");
  assert.equal(read.project.version, 2);
  assert.equal(read.release.revision, 1);
  assert.equal(read.release.source.file.hash, hash);
  const outsider = client("outsider");
  await createUserWithEmailAndPassword(
    outsider.auth,
    "outsider@example.test",
    "Test-only-password-123",
  );
  await assert.rejects(
    httpsCallable(
      outsider.functions,
      "dt_getProject",
    )({ workspaceId, projectId }),
    /acesso/,
  );
  await adminDb(admin)
    .doc(`dt_workspaces/${workspaceId}/members/${account.user.uid}`)
    .update({ active: false });
  await assert.rejects(call("dt_initializeWorkspace"), /Solicite acesso/);
  assert.equal(
    (
      await adminDb(admin)
        .doc(`dt_workspaces/${workspaceId}/members/${account.user.uid}`)
        .get()
    ).data().active,
    false,
  );
});
