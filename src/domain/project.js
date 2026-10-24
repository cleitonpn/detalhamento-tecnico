export * from "../../functions/domain.js";

export function newProject(file, analysis) {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: file.name.replace(/\.(glb|dwg|dxf|zip|skp)$/i, ""),
    client: "",
    fair: "",
    sourceUnit: "m",
    status: "review",
    revision: 0,
    version: 0,
    file: { name: file.name, bytes: file.size, hash: analysis.hash },
    parts: analysis.parts,
    materials: [],
    integration: null,
  };
}

export function mergeParts(project, ids, label = "Conjunto") {
  const members = project.parts.filter((p) => ids.includes(p.id));
  if (members.length < 2)
    throw Error("Selecione pelo menos duas peças para reunir.");
  const min = [0, 1, 2].map((i) =>
    Math.min(...members.map((p) => p.bounds.min[i])),
  );
  const max = [0, 1, 2].map((i) =>
    Math.max(...members.map((p) => p.bounds.max[i])),
  );
  const part = {
    ...members[0],
    id: crypto.randomUUID(),
    label,
    meshIds: members.flatMap((p) => p.meshIds),
    bounds: { min, max },
    dimensions: max.map((n, i) => n - min[i]),
    frame: {
      origin: min,
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    },
    measurementBasis: "world-assembly",
    suggestion: {
      kind: "unclassified",
      reason: "Conjunto reunido manualmente.",
    },
    review: {
      kind: "unclassified",
      materialId: "",
      finishId: "",
      notes: "",
      dimensionsConfirmed: false,
      confirmed: false,
    },
  };
  return {
    project: {
      ...project,
      status: "review",
      parts: [...project.parts.filter((p) => !ids.includes(p.id)), part],
    },
    part,
  };
}

export function splitPart(project, id, meshParts) {
  const part = project.parts.find((p) => p.id === id);
  if (!part || part.meshIds.length < 2)
    throw Error("Esta peça já corresponde a uma única malha.");
  const pieces = part.meshIds.map((meshId) => {
    const source = meshParts.get(meshId);
    if (!source) throw Error("Geometria da peça não encontrada.");
    return {
      ...source,
      id: crypto.randomUUID(),
      review: { ...source.review, confirmed: false },
    };
  });
  return {
    ...project,
    status: "review",
    parts: project.parts.flatMap((p) => (p.id === id ? pieces : [p])),
  };
}
