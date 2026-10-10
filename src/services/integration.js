import { checkProject, readTechnicalPackage } from "../domain/project.js";

/** Adaptador independente: só associa validações a um arquivo cuja identidade coincide. */
export function applyStudioSource(project, source, meshMap) {
  if (
    source?.contract !== "studio.detailing-source" ||
    source.schemaVersion !== 1
  )
    throw Error("Referência do Studio incompatível.");
  if (source.file?.hash !== project.file.hash)
    throw Error(
      "O vínculo foi preparado para outro GLB. Use o arquivo da mesma revisão do Studio.",
    );
  if (
    !source.orderId ||
    !Number.isSafeInteger(source.revision) ||
    !Array.isArray(source.elements)
  )
    throw Error("Dados do Studio incompletos.");
  const matches = new Map();
  for (const e of source.elements) {
    for (const key of e.pieceKeys || []) {
      if (matches.has(key))
        throw Error("Há vínculos ambíguos no arquivo do Studio.");
      matches.set(key, e);
    }
  }
  let reused = 0;
  const parts = project.parts.map((part) => {
    const elements = part.meshIds.map((id) =>
      matches.get(meshMap.get(id)?.userData.studioKey),
    );
    const unique = new Set(elements.filter(Boolean));
    if (unique.size !== 1 || elements.some((e) => !e)) return part;
    const element = [...unique][0];
    reused++;
    // Classificação de personalização é uma sugestão. A aprovação construtiva continua humana.
    return {
      ...part,
      label: element.name || part.label,
      studioElementId: element.id,
      suggestion: {
        kind: element.kind || part.suggestion.kind,
        reason:
          "Elemento validado no Studio; conferir especificação construtiva.",
      },
    };
  });
  const next = {
    ...project,
    name: source.name || project.name,
    parts,
    integration: {
      provider: "studio",
      orderId: source.orderId,
      proposalId: source.proposalId || null,
      modelId: source.modelId || null,
      sourceRevision: source.revision,
      fileHash: source.file.hash,
    },
  };
  checkProject(next);
  return { project: next, reused };
}

export function productionEnvelope(release) {
  readTechnicalPackage(release);
  return {
    contract: "production.detailing-reference",
    schemaVersion: 1,
    orderId: release.source.integration?.orderId || null,
    sourceRevision: release.source.integration?.sourceRevision || null,
    technicalProjectId: release.projectId,
    technicalRevision: release.revision,
    fileHash: release.source.file.hash,
    scope: release.scope,
    constructionRelease: release.constructionRelease,
  };
}
