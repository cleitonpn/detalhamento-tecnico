import { httpsCallable } from "firebase/functions";
import { getBlob, ref, uploadBytesResumable } from "firebase/storage";
import { functions, storage, workspaceId } from "./firebase.js";
import { MODEL_FORMATS, modelFormat } from "../domain/project.js";

const typeOf = (name) => MODEL_FORMATS[modelFormat(name)].contentType;

const call = async (name, data = {}) =>
  (
    await httpsCallable(functions, name, { timeout: 180000 })({
      workspaceId,
      ...data,
    })
  ).data;
export const cloudRepository = {
  async memoryLookup(keys) {
    const found = {};
    // Lotes para não estourar o tamanho da chamada
    for (let i = 0; i < keys.length; i += 4000)
      Object.assign(
        found,
        (await call("dt_memoryLookup", { keys: keys.slice(i, i + 4000) }))
          .memory,
      );
    return found;
  },
  async memoryRecord(entries) {
    let recorded = 0;
    for (let i = 0; i < entries.length; i += 2000)
      recorded += (
        await call("dt_memoryRecord", { entries: entries.slice(i, i + 2000) })
      ).recorded;
    return { recorded };
  },
  async list() {
    return (await call("dt_listProjects")).projects;
  },
  async save(project, file) {
    const upload = await call("dt_reserveModel", {
      projectId: project.id,
      file: project.file,
    });
    if (!upload.exists)
      await uploadBytesResumable(ref(storage, upload.path), file, {
        contentType: upload.contentType || typeOf(project.file.name),
      });
    return (
      await call("dt_saveProject", {
        project,
        expectedVersion: project.version || 0,
      })
    ).project;
  },
  async get(id) {
    const { project, path, release } = await call("dt_getProject", {
      projectId: id,
    });
    const blob = await getBlob(ref(storage, path));
    return {
      project,
      release,
      file: new File([blob], project.file.name, {
        type: typeOf(project.file.name),
      }),
    };
  },
  async publish(project) {
    return call("dt_publishRevision", {
      projectId: project.id,
      expectedVersion: project.version,
    });
  },
  async initialize() {
    return call("dt_initializeWorkspace");
  },
  async studioSource(orderId) {
    return call("dt_getStudioSource", { orderId });
  },
};
