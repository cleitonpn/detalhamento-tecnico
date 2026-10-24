import {
  checkMemoryEntries,
  checkSamples,
  mergeMemory,
  MAX_SAMPLES_LISTED,
} from "../domain/project.js";

let connection;
function database() {
  if (!connection)
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open("detalha-workspace", 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        const store = (name, options) => {
          if (!db.objectStoreNames.contains(name))
            db.createObjectStore(name, options);
        };
        store("projects", { keyPath: "id" });
        store("models");
        store("releases");
        // Memória de decisões: impressão digital da peça -> decisão humana
        store("memory");
        // Exemplos de treino do aprendizado (peças validadas)
        store("samples");
      };
      request.onsuccess = () => {
        const db = request.result;
        // Outra aba (ou versão nova do Detalha) precisa atualizar o banco: libera
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        resolve(db);
      };
      request.onblocked = () => {
        connection = null;
        reject(
          Error(
            "Feche as outras abas do Detalha para atualizar o armazenamento deste navegador.",
          ),
        );
      };
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
// Várias leituras ou gravações numa transação só (milhares de chaves por projeto)
async function many(mode, run, name = "memory") {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const result = run(tx.objectStore(name));
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () =>
      reject(Error("Não foi possível usar a memória deste navegador."));
  });
}
export const localRepository = {
  /** Exemplos de treino do espaço (os mais recentes primeiro). */
  async samplesList() {
    let list = [];
    await many(
      "readonly",
      (store) => {
        const r = store.getAll();
        r.onsuccess = () => {
          list = r.result || [];
        };
      },
      "samples",
    );
    return list
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .slice(0, MAX_SAMPLES_LISTED);
  },
  async samplesRecord(samples) {
    const valid = checkSamples(samples);
    const now = new Date().toISOString();
    await many(
      "readwrite",
      (store) =>
        valid.forEach((s) => store.put({ ...s, updatedAt: now }, s.key)),
      "samples",
    );
    return { recorded: valid.length };
  },
  /** Decisões já tomadas para estas impressões digitais: { chave: decisão }. */
  async memoryLookup(keys) {
    const found = {};
    await many("readonly", (store) =>
      keys.forEach((key) => {
        const r = store.get(key);
        r.onsuccess = () => {
          if (r.result) found[key] = r.result;
        };
      }),
    );
    return found;
  },
  /** Grava decisões humanas (já conferidas pelo domínio). */
  async memoryRecord(entries) {
    const valid = checkMemoryEntries(entries);
    await many("readwrite", (store) => {
      const pending = new Map();
      for (const e of valid) {
        const r = store.get(e.key);
        r.onsuccess = () => {
          const merged = mergeMemory(pending.get(e.key) ?? r.result, e);
          pending.set(e.key, merged);
          store.put(merged, e.key);
        };
      }
    });
    return { recorded: valid.length };
  },
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
    if (!blob)
      throw Error("O arquivo do modelo deste projeto não está disponível.");
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
