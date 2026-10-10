import { httpsCallable } from "firebase/functions";
import { getBlob, ref, uploadBytes } from "firebase/storage";
import { functions, storage, workspaceId } from "./firebase.js";

const call = async (name, data = {}) =>
  (await httpsCallable(functions, name)({ workspaceId, ...data })).data;
export const cloudRepository = {
  async list() {
    return (await call("dt_listProjects")).projects;
  },
  async save(project, file) {
    const upload = await call("dt_reserveModel", {
      projectId: project.id,
      file: project.file,
    });
    if (!upload.exists)
      await uploadBytes(ref(storage, upload.path), file, {
        contentType: "model/gltf-binary",
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
      file: new File([blob], project.file.name, { type: "model/gltf-binary" }),
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
