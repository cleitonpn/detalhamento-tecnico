// Domínio compartilhado pelo navegador e pelas Functions; sem dependência de Firebase.
export const SCHEMA_VERSION = 1;
export const KINDS = {
  unclassified: "A classificar",
  metalon: "Estrutura de metalon",
  wall: "Parede de madeira",
  fascia: "Testeira",
  finish: "Revestimento",
  furniture: "Mobiliário / balcão",
  floor: "Piso",
  equipment: "TV / equipamento",
  light: "Iluminação",
  other: "Outra peça",
  ignore: "Fora do detalhamento",
};
export const SCALE = { m: 1, cm: 0.01, mm: 0.001 };
export const MAX_FILE_MB = 200;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
export const MAX_PARTS = 5000;
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
  if (!KINDS[r.kind] || r.kind === "unclassified")
    issues.push("Escolha o tipo da peça.");
  if (!cleanText(part.label)) issues.push("Informe o nome da peça.");
  if (r.kind === "ignore") return issues;
  if (
    !part.dimensions?.every((n) => Number.isFinite(n) && n >= 0) ||
    !part.dimensions?.some((n) => n > 0)
  )
    issues.push("Medidas inválidas.");
  if (!r.dimensionsConfirmed)
    issues.push("Confira as medidas e a unidade do modelo.");
  if (MATERIAL_REQUIRED.has(r.kind) && !r.materialId)
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
        ? { ...p, review: { ...p.review, confirmed: true } }
        : p,
    ),
  };
}
export function checkProject(project) {
  if (!project || project.schemaVersion !== SCHEMA_VERSION)
    throw Error("Versão do projeto incompatível.");
  assertId(project.id, "Projeto");
  if (!cleanText(project.name)) throw Error("Informe o nome do projeto.");
  if (!SCALE[project.sourceUnit]) throw Error("Unidade do modelo inválida.");
  if (!/^[a-f0-9]{64}$/.test(project.file?.hash || ""))
    throw Error("Identidade do GLB ausente.");
  if (
    !Number.isSafeInteger(project.file.bytes) ||
    project.file.bytes <= 0 ||
    project.file.bytes > MAX_FILE_BYTES
  )
    throw Error(`GLB acima do limite de ${MAX_FILE_MB} MB ou inválido.`);
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
    if (!KINDS[part.review?.kind]) throw Error("Classificação inválida.");
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
  if (new TextEncoder().encode(JSON.stringify(project)).byteLength > 700000)
    throw Error(
      "O levantamento ficou muito grande. Divida o projeto em arquivos menores.",
    );
  return project;
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
        integration: project.integration || null,
      },
      parts: project.parts,
      materials: project.materials || [],
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
