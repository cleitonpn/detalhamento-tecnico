let connection;
function database() {
  if (!connection)
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open("detalha-workspace", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("projects", { keyPath: "id" });
        db.createObjectStore("models");
        db.createObjectStore("releases");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        connection = null;
        reject(
          Error("Não foi possível abrir o armazenamento deste navegador."),
        );
      };
    });
  return connection;
}
async function request(store, mode, run) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode),
      action = run(tx.objectStore(store));
    let result;
    action.onsuccess = () => {
      result = action.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () =>
      reject(
        Error(
          "Não foi possível salvar neste navegador. Exporte o projeto para preservar seu trabalho.",
        ),
      );
  });
}
export const localRepository = {
  async list() {
    return (await request("projects", "readonly", (s) => s.getAll())).sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    );
  },
  async save(project, file) {
    const key = project.file.hash;
    if (!(await request("models", "readonly", (s) => s.get(key))))
      await request("models", "readwrite", (s) => s.put(file, key));
    const saved = { ...project, updatedAt: new Date().toISOString() };
    await request("projects", "readwrite", (s) => s.put(saved));
    return saved;
  },
  async get(id) {
    const project = await request("projects", "readonly", (s) => s.get(id));
    if (!project) throw Error("Projeto não encontrado neste navegador.");
    const blob = await request("models", "readonly", (s) =>
      s.get(project.file.hash),
    );
    if (!blob) throw Error("O GLB deste projeto não está disponível.");
    const release =
      project.status === "validated" && project.revision > 0
        ? await request("releases", "readonly", (s) =>
            s.get(`${project.id}:${project.revision}`),
          )
        : null;
    return {
      project,
      release,
      file: new File([blob], project.file.name, { type: "model/gltf-binary" }),
    };
  },
  async publish(project, release) {
    await request("releases", "readwrite", (s) =>
      s.add(release, `${project.id}:${release.revision}`),
    );
    return { revision: release.revision };
  },
};
