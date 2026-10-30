import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createHash } from "node:crypto";
import { packParts, unpackParts } from "./packing.js";
import { checkConstructionHistory } from "./construction.js";
import {
  assertId,
  checkProject,
  cleanText,
  createRelease,
  checkMemoryKeys,
  checkMemoryEntries,
  mergeMemory,
  checkSamples,
  MAX_SAMPLES_LISTED,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  MODEL_FORMATS,
  MODEL_HEADER_BYTES,
  checkModelHeader,
  modelFormat,
  progress,
} from "./domain.js";
import {
  requireMember,
  modelPath,
  checkVersion,
  assertStudioAdmin,
  assertProvisioned,
} from "./security.js";

initializeApp();
const db = getFirestore(),
  bucket = () => getStorage().bucket();
const studioEnabled = () => process.env.DT_ENABLE_STUDIO_INTEGRATION === "true";
const options = {
  region: "southamerica-east1",
  maxInstances: 10,
  timeoutSeconds: 180,
  memory: "512MiB",
};

function endpoint(handler) {
  return onCall(options, async (req) => {
    if (!req.auth)
      throw new HttpsError("unauthenticated", "Faça login para continuar.");
    try {
      return await handler(req);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError(
        "failed-precondition",
        error.message || "Não foi possível concluir a operação.",
      );
    }
  });
}
function workspace(req) {
  return assertId(req.data?.workspaceId, "Espaço de trabalho");
}
async function authorize(req, write = false) {
  const id = workspace(req);
  const member = (
    await db.doc(`dt_workspaces/${id}/members/${req.auth.uid}`).get()
  ).data();
  try {
    requireMember(member, write);
  } catch (e) {
    throw new HttpsError("permission-denied", e.message);
  }
  return { id, member };
}
async function authorizeTransaction(tx, req, write = false) {
  const id = workspace(req);
  const member = (
    await tx.get(db.doc(`dt_workspaces/${id}/members/${req.auth.uid}`))
  ).data();
  try {
    requireMember(member, write);
  } catch (e) {
    throw new HttpsError("permission-denied", e.message);
  }
}
const projectRef = (workspaceId, id) =>
  db.doc(`dt_workspaces/${workspaceId}/projects/${assertId(id, "Projeto")}`);

export const dt_initializeWorkspace = endpoint(async (req) => {
  const id = workspace(req),
    uid = req.auth.uid;
  // O namespace USET não pode ser apropriado por qualquer conta autenticada.
  if (id === "uset") {
    if (!studioEnabled())
      throw Error(
        "Ative a integração Studio no servidor ou use um espaço independente.",
      );
    assertStudioAdmin((await db.doc(`usuarios/${uid}`).get()).data());
  } else if (id !== `user_${uid}`)
    throw Error("Para uma instalação independente, use seu espaço user_<uid>.");
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`dt_workspaces/${id}`),
      existing = await tx.get(ref);
    const memberRef = ref.collection("members").doc(uid);
    const existingMember = await tx.get(memberRef);
    if (existing.exists) {
      try {
        requireMember(existingMember.data());
      } catch {
        throw new HttpsError(
          "permission-denied",
          "Solicite acesso ao responsável pelo espaço.",
        );
      }
      return;
    }
    if (id !== "uset") assertProvisioned(req.auth.token);
    tx.create(ref, {
      name: id === "uset" ? "Equipe USET" : "Meu espaço",
      owner: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(memberRef, {
      role: "owner",
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { workspaceId: id };
});

export const dt_reserveModel = endpoint(async (req) => {
  const { id } = await authorize(req, true),
    { projectId, file } = req.data;
  const format = modelFormat(file?.name);
  const path = modelPath(id, projectId, file?.hash, format);
  if (
    !Number.isSafeInteger(file?.bytes) ||
    file.bytes <= 0 ||
    file.bytes > MAX_FILE_BYTES
  )
    throw Error(`Envie um modelo de até ${MAX_FILE_MB} MB.`);
  const reservation = db.doc(
    `dt_workspaces/${id}/uploads/${projectId}_${file.hash}.${format}`,
  );
  await reservation.set(
    {
      path,
      projectId,
      hash: file.hash,
      bytes: file.bytes,
      uid: req.auth.uid,
      expiresAtMs: Date.now() + 3600000,
    },
    { merge: true },
  );
  const [exists] = await bucket().file(path).exists();
  return { path, exists, contentType: MODEL_FORMATS[format].contentType };
});

async function verifyModel(workspaceId, project, uid) {
  const format = modelFormat(project.file.name);
  const path = modelPath(workspaceId, project.id, project.file.hash, format);
  const uploadRef = db.doc(
    `dt_workspaces/${workspaceId}/uploads/${project.id}_${project.file.hash}.${format}`,
  );
  const reservation = (await uploadRef.get()).data();
  if (!reservation || reservation.uid !== uid)
    throw Error("Reserve e envie o modelo antes de salvar.");
  if (
    reservation.verified === true &&
    reservation.verifiedBytes === project.file.bytes
  )
    return path;
  if (reservation.expiresAtMs < Date.now())
    throw Error("A reserva do modelo expirou. Envie o arquivo novamente.");
  const file = bucket().file(path),
    [metadata] = await file.getMetadata();
  if (
    Number(metadata.size) !== project.file.bytes ||
    metadata.contentType !== MODEL_FORMATS[format].contentType
  )
    throw Error("O arquivo enviado não corresponde ao projeto.");
  const hash = createHash("sha256");
  let header = Buffer.alloc(0);
  for await (const chunk of file.createReadStream()) {
    hash.update(chunk);
    if (header.length < MODEL_HEADER_BYTES)
      header = Buffer.concat([header, chunk]).subarray(0, MODEL_HEADER_BYTES);
  }
  if (
    !checkModelHeader(format, header, project.file.bytes) ||
    hash.digest("hex") !== project.file.hash
  )
    throw Error(
      `Identidade ou formato do ${MODEL_FORMATS[format].label} inválido.`,
    );
  await uploadRef.update({ verified: true, verifiedBytes: project.file.bytes });
  return path;
}

export const dt_saveProject = endpoint(async (req) => {
  const { id } = await authorize(req, true);
  const input = checkProject(req.data.project);
  const path = await verifyModel(id, input, req.auth.uid);
  let saved;
  await db.runTransaction(async (tx) => {
    await authorizeTransaction(tx, req, true);
    const ref = projectRef(id, input.id),
      snapshot = await tx.get(ref),
      old = snapshot.data();
    checkVersion(req.data.expectedVersion, old?.version);
    checkConstructionHistory(old, input);
    // Referências importadas não concedem acesso ao Studio nem à ordem de produção.
    saved = {
      schemaVersion: 1,
      id: input.id,
      name: cleanText(input.name),
      client: cleanText(input.client),
      fair: cleanText(input.fair),
      sourceUnit: input.sourceUnit,
      ...(input.importDiagnostics ? { importDiagnostics: input.importDiagnostics } : {}),
      parts: input.parts,
      materials: input.materials || [],
      constructionCatalog: input.constructionCatalog || [],
      constructionRecipes: input.constructionRecipes || [],
      file: input.file,
      integration: input.integration || null,
      version: (old?.version || 0) + 1,
      revision: old?.revision || 0,
      status: "review",
      updatedAt: new Date().toISOString(),
      updatedBy: req.auth.uid,
    };
    const summary = progress(saved);
    tx.set(ref, {
      ...saved,
      parts: [],
      partsGz: packParts(saved.parts),
      partCount: summary.total,
      confirmedCount: summary.confirmed,
      modelPath: path,
    });
  });
  return { project: saved };
});

export const dt_getProject = endpoint(async (req) => {
  const { id } = await authorize(req),
    snapshot = await projectRef(id, req.data.projectId).get();
  if (!snapshot.exists)
    throw new HttpsError("not-found", "Projeto não encontrado.");
  const {
    modelPath: path,
    partsGz,
    partCount,
    confirmedCount,
    ...stored
  } = snapshot.data();
  const project = { ...stored, parts: unpackParts({ ...stored, partsGz }) };
  const saved =
    project.status === "validated" && project.revision > 0
      ? (
          await snapshot.ref
            .collection("revisions")
            .doc(String(project.revision))
            .get()
        ).data() || null
      : null;
  const release = saved
    ? (({ partsGz: gz, ...rest }) => ({
        ...rest,
        parts: unpackParts({ ...rest, partsGz: gz }),
      }))(saved)
    : null;
  return { project, path, release };
});
// Memória de decisões do espaço de trabalho: impressão digital da peça -> decisão humana.
// Só membros leem; só quem edita grava (ao validar peças).
export const dt_memoryLookup = endpoint(async (req) => {
  const { id } = await authorize(req);
  const keys = checkMemoryKeys(req.data.keys);
  const col = db.collection(`dt_workspaces/${id}/memory`);
  const memory = {};
  for (let i = 0; i < keys.length; i += 300) {
    const snaps = await db.getAll(
      ...keys.slice(i, i + 300).map((k) => col.doc(k)),
    );
    for (const s of snaps) if (s.exists) memory[s.id] = s.data();
  }
  return { memory };
});
export const dt_memoryRecord = endpoint(async (req) => {
  const { id } = await authorize(req, true);
  const entries = checkMemoryEntries(req.data.entries);
  const col = db.collection(`dt_workspaces/${id}/memory`);
  for (let i = 0; i < entries.length; i += 200) {
    const chunk = entries.slice(i, i + 200);
    await db.runTransaction(async (tx) => {
      const refs = [...new Set(chunk.map((e) => e.key))].map((k) => col.doc(k));
      const snaps = await tx.getAll(...refs);
      const current = new Map(
        snaps.map((s) => [s.id, s.exists ? s.data() : null]),
      );
      for (const e of chunk)
        current.set(e.key, mergeMemory(current.get(e.key), e));
      for (const ref of refs) tx.set(ref, current.get(ref.id));
    });
  }
  return { recorded: entries.length };
});
// Exemplos de treino do aprendizado: peças validadas do espaço de trabalho
export const dt_samplesRecord = endpoint(async (req) => {
  const { id } = await authorize(req, true);
  const samples = checkSamples(req.data.samples);
  const col = db.collection(`dt_workspaces/${id}/samples`);
  const now = new Date().toISOString();
  const batch = db.batch();
  for (const s of samples) batch.set(col.doc(s.key), { ...s, updatedAt: now });
  await batch.commit();
  return { recorded: samples.length };
});
export const dt_samplesList = endpoint(async (req) => {
  const { id } = await authorize(req);
  const list = await db
    .collection(`dt_workspaces/${id}/samples`)
    .orderBy("updatedAt", "desc")
    .limit(MAX_SAMPLES_LISTED)
    .get();
  return { samples: list.docs.map((d) => d.data()) };
});
export const dt_listProjects = endpoint(async (req) => {
  const { id } = await authorize(req);
  const list = await db
    .collection(`dt_workspaces/${id}/projects`)
    .orderBy("updatedAt", "desc")
    .limit(50)
    .get();
  return {
    projects: list.docs.map((doc) => {
      const p = doc.data(),
        summary = p.partsGz
          ? { total: p.partCount || 0, confirmed: p.confirmedCount || 0 }
          : progress(p);
      return {
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        parts: [],
        partCount: summary.total,
        confirmedCount: summary.confirmed,
      };
    }),
  };
});
export const dt_publishRevision = endpoint(async (req) => {
  const { id } = await authorize(req, true);
  let release, version;
  await db.runTransaction(async (tx) => {
    await authorizeTransaction(tx, req, true);
    const ref = projectRef(id, req.data.projectId),
      snapshot = await tx.get(ref);
    if (!snapshot.exists)
      throw new HttpsError("not-found", "Projeto não encontrado.");
    const {
      modelPath: path,
      partsGz,
      partCount,
      confirmedCount,
      ...stored
    } = snapshot.data();
    const project = { ...stored, parts: unpackParts({ ...stored, partsGz }) };
    checkVersion(req.data.expectedVersion, project.version);
    release = createRelease(project, (project.revision || 0) + 1);
    release.artifacts = [
      {
        type: modelFormat(project.file.name),
        path,
        fileHash: project.file.hash,
      },
    ];
    release.validatedBy = req.auth.uid;
    version = project.version + 1;
    tx.create(ref.collection("revisions").doc(String(release.revision)), {
      ...release,
      parts: [],
      partsGz: packParts(release.parts),
    });
    tx.update(ref, {
      status: "validated",
      revision: release.revision,
      version,
      updatedAt: new Date().toISOString(),
    });
  });
  return { release, version };
});

export const dt_getStudioSource = endpoint(async (req) => {
  await authorize(req);
  if (!studioEnabled())
    throw Error(
      "A integração com o Studio ainda não está habilitada neste servidor.",
    );
  assertStudioAdmin((await db.doc(`usuarios/${req.auth.uid}`).get()).data());
  const orderId = assertId(req.data.orderId, "Ordem"),
    order = (await db.doc(`ordensProducao/${orderId}`).get()).data();
  if (
    order?.estado !== "liberada" ||
    !order.propostaId ||
    !order.manifesto ||
    !order.arquivoPersonalizado?.caminho
  )
    throw Error("A ordem não está liberada ou não possui um GLB aprovado.");
  const model = order.modeloId
    ? (await db.doc(`modelos/${assertId(order.modeloId)}`).get()).data()
    : null;
  const file = bucket().file(order.arquivoPersonalizado.caminho),
    [metadata] = await file.getMetadata();
  if (Number(metadata.size) > MAX_FILE_BYTES)
    throw Error("O GLB do Studio excede o limite desta versão.");
  const hash = createHash("sha256");
  for await (const chunk of file.createReadStream()) hash.update(chunk);
  return {
    contract: "studio.detailing-source",
    schemaVersion: 1,
    orderId,
    proposalId: order.propostaId,
    modelId: order.modeloId || null,
    revision: order.revisao || 1,
    name: order.modeloNome || model?.nome || "Projeto Studio",
    file: { hash: hash.digest("hex"), bytes: Number(metadata.size) },
    bindingStatus: "requires-reconciliation",
    elements: (model?.objetos || []).map((o) => ({
      id: o.id,
      name: o.nome,
      pieceKeys: o.pecas || [],
      kind: "unclassified",
    })),
  };
});
