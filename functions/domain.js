import { checkConstructionCatalog, constructionRecipes, checkConstructionProposal } from "./construction.js";
// Domínio compartilhado pelo navegador e pelas Functions; sem dependência de Firebase.
export const SCHEMA_VERSION = 1;
export const KINDS = {
  unclassified: "A classificar",
  metalon: "Estrutura de metalon",
  wall: "Parede de madeira",
  fascia: "Testeira",
  finish: "Revestimento",
  furniture: "Balcão / marcenaria",
  floor: "Piso",
  equipment: "TV / equipamento",
  light: "Iluminação",
  other: "Outra peça",
  ignore: "Fora do detalhamento",
};
export const SCALE = { m: 1, cm: 0.01, mm: 0.001 };
export const SEMANTIC_ROLES = {
  wall: "Parede / painel", fascia: "Testeira", floor: "Piso",
  counter: "Balcão", shelf: "Prateleira / tampo", furniture: "Mobiliário",
  countertop: "Tampo de balcão", tabletop: "Tampo de mesa",
  vegetation: "Vegetação / jardim vertical", logo: "Logo / comunicação visual",
  equipment: "Equipamento", light: "Luminária", render: "Auxiliar de renderização",
  metalon: "Perfil / estrutura", finish: "Revestimento", other: "Outro objeto",
};
export const DESTINATIONS = {
  technical: "Caderno técnico", art: "Comunicação visual", furniture: "Mobiliário",
  electrical: "Elétrica / equipamentos", excluded: "Fora da entrega", pending: "A decidir",
};
export function destinationOf(part) {
  const r = part.review || {};
  return r.destination || ({ ignore: "excluded", equipment: "electrical", light: "electrical",
    unclassified: "pending" }[r.kind] || "technical");
}
export function semanticRoleOf(part) {
  if (part.review?.semanticRole) return part.review.semanticRole;
  // Na primeira versão, "furniture" designava marcenaria no tipo e mobiliário
  // comprado no papel semântico. Preserva a leitura de balcões já salvos.
  if (part.review?.kind === "furniture" && part.auto?.semanticRole === "furniture")
    return "counter";
  if (SEMANTIC_ROLES[part.auto?.semanticRole]) return part.auto.semanticRole;
  return ({ furniture: "counter", ignore: "other", unclassified: "other" }[part.review?.kind]
    || part.review?.kind || "other");
}

const IMPORT_WARNING_CODES = new Set(["unit-mismatch", "missing-faces", "missing-solids", "solid-read-failure", "skp-missing-faces"]);
export function checkImportWarnings(warnings) {
  if (!Array.isArray(warnings) || warnings.length > 5 || warnings.some(w =>
    !w || !IMPORT_WARNING_CODES.has(w.code) || typeof w.message !== "string" || w.message.length > 600))
    throw Error("Alertas de importação inválidos.");
}
export const MAX_FILE_MB = 200;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
export const MAX_PARTS = 5000;
// Levantamento (JSON das peças) aceito; na nuvem ele é gravado compactado
export const MAX_PROJECT_BYTES = 8 * 1024 * 1024;
export const MATERIAL_REQUIRED = new Set([
  "metalon",
  "wall",
  "fascia",
  "finish",
  "floor",
  "other",
]);
export const cleanText = (value, max = 180) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
// Projetos antigos podem manter o rótulo do catálogo que pedia uma seção manual.
export function materialLabel(material) {
  return material?.id === "metalon-custom" &&
    material.name === "Metalon — seção a informar"
    ? "Metalon"
    : material?.name || "";
}
export function assertId(value, label = "Identificador") {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))
    throw Error(`${label} inválido.`);
  return value;
}
export function partIssues(part) {
  const r = part.review || {},
    issues = [];
  if (!Object.hasOwn(KINDS, r.kind) || r.kind === "unclassified")
    issues.push("Escolha o tipo da peça.");
  if (!cleanText(part.label)) issues.push("Informe o nome da peça.");
  if (r.destination && !Object.hasOwn(DESTINATIONS, r.destination))
    issues.push("Destino inválido.");
  if (r.semanticRole && !Object.hasOwn(SEMANTIC_ROLES, r.semanticRole))
    issues.push("Identidade inválida.");
  if (r.destination === "pending") issues.push("Decida o destino da peça.");
  if (r.identityEvidence && r.identityNeedsReview) issues.push("Confira novamente a identidade contextual após a mudança de escala.");
  if (destinationOf(part) === "technical" && r.kind === "ignore")
    issues.push("Escolha um tipo técnico para incluir esta peça no caderno.");
  if (part.importWarnings?.length && destinationOf(part) === "technical" && !r.importReviewed)
    issues.push("Confira os alertas de unidade/geometria do arquivo.");
  if (r.kind === "ignore") return issues;
  if (
    !part.dimensions?.every((n) => Number.isFinite(n) && n >= 0) ||
    !part.dimensions?.some((n) => n > 0)
  )
    issues.push("Medidas inválidas.");
  if (!r.dimensionsConfirmed)
    issues.push("Confira as medidas e a unidade do modelo.");
  if (destinationOf(part) === "technical" && MATERIAL_REQUIRED.has(r.kind) && !r.materialId)
    issues.push("Selecione o material de construção.");
  return issues;
}
export function progress(project) {
  const parts = project?.parts || [];
  const confirmed = parts.filter(
    (p) => p.review?.confirmed && !partIssues(p).length,
  ).length;
  return {
    total: parts.length,
    confirmed,
    pending: parts.length - confirmed,
    percent: parts.length ? Math.round((confirmed / parts.length) * 100) : 0,
  };
}
export function updateParts(project, ids, patch) {
  const selected = new Set(ids);
  return {
    ...project,
    status: "review",
    parts: project.parts.map((p) =>
      selected.has(p.id)
        ? {
            ...p,
            ...(patch.label !== undefined
              ? { label: cleanText(patch.label) }
              : {}),
            review: { ...p.review, ...patch.review, confirmed: false },
          }
        : p,
    ),
  };
}
export function confirmParts(project, ids) {
  const selected = new Set(ids);
  for (const part of project.parts.filter((p) => selected.has(p.id))) {
    const issues = partIssues(part);
    if (issues.length) throw Error(`${part.label}: ${issues.join(" ")}`);
  }
  return {
    ...project,
    status: "review",
    parts: project.parts.map((p) =>
      selected.has(p.id)
        ? { ...p, review: { ...p.review, confirmed: true, confirmationMethod: "individual" } }
        : p,
    ),
  };
}
// Formatos de modelo aceitos. DWG/DXF/ZIP são lidos direto pelo Detalha, sem conversão para GLB.
export const MODEL_FORMATS = {
  glb: { contentType: "model/gltf-binary", label: "GLB" },
  dwg: { contentType: "image/vnd.dwg", label: "DWG" },
  dxf: { contentType: "image/vnd.dxf", label: "DXF" },
  zip: { contentType: "application/zip", label: "ZIP" },
  skp: { contentType: "application/vnd.sketchup.skp", label: "SketchUp" },
};
export const MODEL_HEADER_BYTES = 32;
export function modelFormat(name) {
  const ext = /\.([a-z0-9]+)$/i.exec(String(name || ""))?.[1]?.toLowerCase();
  if (!ext || !MODEL_FORMATS[ext])
    throw Error("Formato de modelo não suportado. Use GLB, DWG, DXF ou ZIP.");
  return ext;
}
/** Confere a assinatura do arquivo pelos primeiros bytes (Buffer ou Uint8Array). */
export function checkModelHeader(format, header, bytes) {
  const ascii = (a, b) => String.fromCharCode(...header.subarray(a, b));
  const u32 = (i) =>
    (header[i] |
      (header[i + 1] << 8) |
      (header[i + 2] << 16) |
      (header[i + 3] << 24)) >>>
    0;
  if (format === "glb")
    return (
      header.length >= 12 &&
      u32(0) === 0x46546c67 &&
      u32(4) === 2 &&
      u32(8) === bytes
    );
  if (format === "dwg")
    return header.length >= 6 && /^AC10\d\d$/.test(ascii(0, 6));
  if (format === "dxf") {
    // DXF texto começa com "0 / SECTION" (ou comentário 999); DXF binário tem assinatura própria
    const start = ascii(0, Math.min(header.length, MODEL_HEADER_BYTES)).replace(
      /^\uFEFF/,
      "",
    );
    return (
      start.startsWith("AutoCAD Binary DXF") ||
      /^\s*0\s*\r?\n\s*SECTION/.test(start) ||
      /^\s*999\s*\r?\n/.test(start)
    );
  }
  if (format === "zip") return header.length >= 4 && u32(0) === 0x04034b50;
  // SketchUp: FF FE FF 0E seguido de "SketchUp Model" em UTF-16
  if (format === "skp")
    return (
      header.length >= 32 &&
      u32(0) === 0x0efffeff &&
      new TextDecoder("utf-16le").decode(header.subarray(4, 32)) ===
        "SketchUp Model"
    );
  return false;
}

export function checkProject(project) {
  if (!project || project.schemaVersion !== SCHEMA_VERSION)
    throw Error("Versão do projeto incompatível.");
  if (project.importDiagnostics) {
    if (!["cad", "skp", "glb"].includes(project.importDiagnostics.source))
      throw Error("Origem de importação inválida.");
    checkImportWarnings(project.importDiagnostics.warnings);
  }
  assertId(project.id, "Projeto");
  if (!cleanText(project.name)) throw Error("Informe o nome do projeto.");
  if (!Object.hasOwn(SCALE, project.sourceUnit)) throw Error("Unidade do modelo inválida.");
  checkConstructionCatalog(project.constructionCatalog);
  constructionRecipes(project.constructionRecipes);
  if (!/^[a-f0-9]{64}$/.test(project.file?.hash || ""))
    throw Error("Identidade do modelo ausente.");
  modelFormat(project.file.name);
  if (
    !Number.isSafeInteger(project.file.bytes) ||
    project.file.bytes <= 0 ||
    project.file.bytes > MAX_FILE_BYTES
  )
    throw Error(`Modelo acima do limite de ${MAX_FILE_MB} MB ou inválido.`);
  if (
    !Array.isArray(project.parts) ||
    !project.parts.length ||
    project.parts.length > MAX_PARTS
  )
    throw Error("Confira a quantidade de peças do projeto.");
  if (!Array.isArray(project.materials) || project.materials.length > 500)
    throw Error("Catálogo de materiais inválido.");
  const materials = new Map();
  for (const material of project.materials) {
    assertId(material.id, "Material");
    if (
      materials.has(material.id) ||
      !cleanText(material.name) ||
      material.name.length > 180 ||
      !["wood", "metal", "finish"].includes(material.family)
    )
      throw Error("Referência de material inválida.");
    if (
      material.thicknessMm != null &&
      (!Number.isFinite(material.thicknessMm) || material.thicknessMm <= 0)
    )
      throw Error("Espessura de material inválida.");
    materials.set(material.id, material);
  }
  const ids = new Set(),
    meshes = new Set();
  for (const part of project.parts) {
    assertId(part.id, "Peça");
    if (ids.has(part.id))
      throw Error("Há peças com identificadores duplicados.");
    ids.add(part.id);
    if (
      !Array.isArray(part.meshIds) ||
      !part.meshIds.length ||
      part.meshIds.some((id) => typeof id !== "string" || id.length > 200)
    )
      throw Error("Vínculo de geometria inválido.");
    for (const id of part.meshIds) {
      if (meshes.has(id))
        throw Error("Uma malha está vinculada a mais de uma peça.");
      meshes.add(id);
    }
    if (
      !part.bounds?.min?.every(Number.isFinite) ||
      !part.bounds?.max?.every(Number.isFinite) ||
      part.bounds.min.length !== 3 ||
      part.bounds.max.length !== 3 ||
      part.bounds.min.some((n, i) => n > part.bounds.max[i])
    )
      throw Error("Limites geométricos inválidos.");
    if (
      !Array.isArray(part.dimensions) ||
      part.dimensions.length !== 3 ||
      !part.dimensions.every((n) => Number.isFinite(n) && n >= 0)
    )
      throw Error("Dimensões inválidas.");
    if (!Object.hasOwn(KINDS, part.review?.kind)) throw Error("Classificação inválida.");
    const evidence = part.review.identityEvidence;
    if (evidence != null && (!evidence || Array.isArray(evidence) || typeof evidence !== "object" ||
      Object.keys(evidence).some(k => !["source", "role", "reason", "fileHash", "sourceUnit", "relatedPartIds", "truncated"].includes(k)) ||
      evidence.source !== "context-3" || evidence.role !== part.review.semanticRole || !Object.hasOwn(SEMANTIC_ROLES, evidence.role) ||
      typeof evidence.reason !== "string" || evidence.reason.length > 1200 || !/^[a-f0-9]{64}$/.test(evidence.fileHash) || evidence.fileHash !== project.file.hash ||
      !Object.hasOwn(SCALE, evidence.sourceUnit) || !Array.isArray(evidence.relatedPartIds) || evidence.relatedPartIds.length > 20 ||
      evidence.relatedPartIds.some(id => typeof id !== "string" || !id.length || id.length > 200) || typeof evidence.truncated !== "boolean"))
      throw Error("Evidência contextual inválida ou incompatível com a peça/arquivo.");
    if (part.review.identityNeedsReview != null && typeof part.review.identityNeedsReview !== "boolean") throw Error("Conferência da identidade inválida.");
    if (part.review.construction != null) checkConstructionProposal(part.review.construction, {
      catalog: project.constructionCatalog, recipes: project.constructionRecipes,
    });
    if (part.review.constructionNeedsReview != null && typeof part.review.constructionNeedsReview !== "boolean")
      throw Error("Conferência construtiva inválida.");
    if (part.importWarnings) checkImportWarnings(part.importWarnings);
    if (part.review.destination && !Object.hasOwn(DESTINATIONS, part.review.destination))
      throw Error("Destino inválido.");
    if (part.review.semanticRole && !Object.hasOwn(SEMANTIC_ROLES, part.review.semanticRole))
      throw Error("Identidade inválida.");
    if (
      !Array.isArray(part.materialsOriginal) ||
      part.materialsOriginal.some(
        (n) => typeof n !== "string" || n.length > 300,
      )
    )
      throw Error("Materiais visuais inválidos.");
    if (
      typeof part.label !== "string" ||
      part.label.length > 180 ||
      typeof part.review.notes !== "string" ||
      part.review.notes.length > 1200
    )
      throw Error("Nome ou observações da peça inválidos.");
    for (const key of ["materialId", "finishId"]) {
      if (part.review[key] && !materials.has(part.review[key]))
        throw Error("Material selecionado não existe no catálogo do projeto.");
    }
    if (
      part.review.kind === "metalon" &&
      part.review.materialId &&
      materials.get(part.review.materialId).family !== "metal"
    )
      throw Error("Selecione um material metálico para o metalon.");
    if (
      part.frame &&
      (!Array.isArray(part.frame.origin) ||
        part.frame.origin.length !== 3 ||
        !part.frame.origin.every(Number.isFinite) ||
        !Array.isArray(part.frame.axes) ||
        part.frame.axes.length !== 3 ||
        !part.frame.axes.every(
          (a) =>
            Array.isArray(a) &&
            a.length === 3 &&
            a.every(Number.isFinite) &&
            Math.abs(Math.hypot(...a) - 1) < 1e-6,
        ))
    )
      throw Error("Orientação da peça inválida.");
    if (part.review.confirmed && partIssues(part).length)
      throw Error("Peça confirmada com informações pendentes.");
  }
  if (
    new TextEncoder().encode(JSON.stringify(project)).byteLength >
    MAX_PROJECT_BYTES
  )
    throw Error(
      "O levantamento ficou muito grande. Divida o projeto em arquivos menores.",
    );
  return project;
}
// O Firestore não aceita lista dentro de lista: a orientação da peça (três eixos)
// é gravada como nove números e volta a ser três eixos na leitura.
export function toStoredParts(parts) {
  return (parts || []).map((p) =>
    Array.isArray(p.frame?.axes?.[0])
      ? { ...p, frame: { ...p.frame, axes: p.frame.axes.flat() } }
      : p,
  );
}
export function fromStoredParts(parts) {
  return (parts || []).map((p) =>
    Array.isArray(p.frame?.axes) &&
    p.frame.axes.length === 9 &&
    !Array.isArray(p.frame.axes[0])
      ? {
          ...p,
          frame: {
            ...p.frame,
            axes: [0, 3, 6].map((i) => p.frame.axes.slice(i, i + 3)),
          },
        }
      : p,
  );
}

export function createRelease(
  project,
  revision,
  now = new Date().toISOString(),
) {
  checkProject(project);
  const p = progress(project);
  if (p.pending)
    throw Error(
      `Valide as ${p.pending} peças pendentes antes de gerar a revisão.`,
    );
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw Error("Revisão inválida.");
  return JSON.parse(
    JSON.stringify({
      contract: "detalhamento.technical-package",
      schemaVersion: SCHEMA_VERSION,
      projectId: project.id,
      name: project.name,
      client: project.client || "",
      fair: project.fair || "",
      revision,
      createdAt: now,
      status: "dimensionally_validated",
      scope: "dimensional-survey",
      constructionRelease: false,
      source: {
        file: project.file,
        sourceUnit: project.sourceUnit,
        ...(project.importDiagnostics ? { importDiagnostics: project.importDiagnostics } : {}),
        integration: project.integration || null,
      },
      parts: project.parts,
      materials: project.materials || [],
      constructionCatalog: project.constructionCatalog || [],
      constructionRecipes: project.constructionRecipes || [],
      artifacts: [],
    }),
  );
}
export function readTechnicalPackage(value) {
  if (
    value?.contract !== "detalhamento.technical-package" ||
    value.schemaVersion !== SCHEMA_VERSION ||
    value.status !== "dimensionally_validated" ||
    value.constructionRelease !== false ||
    value.scope !== "dimensional-survey"
  )
    throw Error("Pacote técnico incompatível.");
  checkProject({
    ...value,
    id: value.projectId,
    file: value.source?.file,
    sourceUnit: value.source?.sourceUnit,
  });
  if (
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    progress(value).pending
  )
    throw Error("Pacote técnico sem revisão validada.");
  return value;
}

// ---------- memória de decisões (impressão digital das peças) ----------

export const MEMORY_KEY = /^[0-9a-f]{13}$/;
export const MAX_MEMORY_KEYS = 8000;
export const MAX_MEMORY_ENTRIES = 4000;

/** Chaves de consulta válidas e sem repetição. */
export function checkMemoryKeys(keys) {
  if (!Array.isArray(keys) || keys.length > MAX_MEMORY_KEYS)
    throw Error("Consulta à memória inválida.");
  return [
    ...new Set(keys.filter((k) => typeof k === "string" && MEMORY_KEY.test(k))),
  ];
}

/** Decisões humanas a gravar: tipo conhecido, materiais com identificador simples. */
export function checkMemoryEntries(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_MEMORY_ENTRIES)
    throw Error("Decisões inválidas para a memória.");
  const id = (v) =>
    typeof v === "string" && /^[a-zA-Z0-9_-]{0,100}$/.test(v) ? v : null;
  return entries.map((e) => {
    if (
      !MEMORY_KEY.test(e?.key || "") ||
      !KINDS[e.kind] ||
      e.kind === "unclassified"
    )
      throw Error("Decisão inválida para a memória.");
    const materialId = id(e.materialId ?? ""),
      finishId = id(e.finishId ?? "");
    if (materialId === null || finishId === null)
      throw Error("Material inválido na memória.");
    return {
      key: e.key,
      kind: e.kind,
      materialId,
      finishId,
      label: cleanText(e.label, 120),
    };
  });
}

/** Junta uma decisão nova a uma entrada da memória (conta e marca divergência). */
export function mergeMemory(old, entry, now = new Date().toISOString()) {
  const differs =
    !!old &&
    (old.kind !== entry.kind ||
      (old.materialId || "") !== entry.materialId ||
      (old.finishId || "") !== entry.finishId);
  return {
    kind: entry.kind,
    materialId: entry.materialId,
    finishId: entry.finishId,
    label: entry.label,
    n: (old?.n || 0) + 1,
    conflict: Boolean(old?.conflict || differs),
    updatedAt: now,
  };
}

// ---------- exemplos de treino do aprendizado (camada 3) ----------

export const MAX_SAMPLES_PER_CALL = 500;
export const MAX_SAMPLES_LISTED = 6000;

/** Exemplos de peças validadas: números finitos, textos curtos, tipo conhecido. */
export function checkSamples(samples) {
  if (!Array.isArray(samples) || samples.length > MAX_SAMPLES_PER_CALL)
    throw Error("Exemplos de treino inválidos.");
  const num = (v) => {
    if (!Number.isFinite(v))
      throw Error("Exemplo de treino com medida inválida.");
    return Math.round(v * 1e5) / 1e5;
  };
  const id = (v) =>
    typeof v === "string" && /^[a-zA-Z0-9_-]{0,100}$/.test(v) ? v : "";
  return samples.map((s) => {
    if (!KINDS[s?.kind] || s.kind === "unclassified")
      throw Error("Exemplo de treino sem tipo válido.");
    const key = cleanText(s.key, 200).replace(/\//g, "_");
    if (!key) throw Error("Exemplo de treino sem chave.");
    return {
      key,
      project: cleanText(s.project, 80),
      label: cleanText(s.label, 80),
      w: num(s.w),
      h: num(s.h),
      d: num(s.d),
      y0: num(s.y0),
      y1: num(s.y1),
      dist: num(s.dist),
      standSize: num(s.standSize),
      tris: Math.max(0, Math.round(num(s.tris))),
      area: num(s.area),
      text: cleanText(s.text, 240),
      small: s.small ? 1 : 0,
      parts: Math.max(1, Math.round(Number.isFinite(s.parts) ? s.parts : 1)),
      main: Number.isFinite(s.main) ? Math.min(1, Math.max(0, s.main)) : 1,
      front: Number.isFinite(s.front) ? Math.min(1, Math.max(0, s.front)) : 1,
      top: Number.isFinite(s.top) ? Math.min(1, Math.max(0, s.top)) : 1,
      tpp: Math.max(1, Math.round(Number.isFinite(s.tpp) ? s.tpp : 12)),
      kind: s.kind,
      materialId: id(s.materialId),
      finishId: id(s.finishId),
      edited: Boolean(s.edited),
    };
  });
}
