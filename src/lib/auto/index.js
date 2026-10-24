// Fase 1 da autonomia: memória (camada 2) + regras (camada 1) + semáforo.
// O sistema pré-preenche tipo, material e revestimento; o humano só confere.
//  🟢 verde: dá para aceitar em lote; 🟡 amarelo: conferir; 🔴 vermelho: decidir.
import { partIssues, mergeMemory } from "../../domain/project.js";

export { mergeMemory };
import { classifyPart, standContext, nameFor, plausible } from "./rules.js";
import { predict, sampleOf } from "./learn.js";
import { nameKey } from "./fingerprint.js";

// A sugestão foi aceita sem mudança?
const sameAsAuto = (p) =>
  !!p.auto &&
  p.review.kind === p.auto.kind &&
  (p.review.materialId || "") === (p.auto.materialId || "") &&
  (p.review.finishId || "") === (p.auto.finishId || "");

export const levelOf = (c) =>
  c >= 0.85 ? "green" : c >= 0.55 ? "yellow" : "red";
export const LEVEL_LABEL = {
  green: "Pronta para aceitar",
  yellow: "Conferir",
  red: "Decidir",
};

/** Todas as chaves de impressão digital das peças (para consultar a memória). */
export function memoryKeys(parts) {
  const keys = new Set();
  for (const p of parts)
    for (const k of Object.values(p.fingerprint || {})) if (k) keys.add(k);
  return [...keys];
}

/**
 * Sugestão automática de cada peça ainda não validada. `memory` é um Map
 * chave → { kind, materialId, finishId, n, conflict } com decisões humanas
 * anteriores; `catalog` são os materiais do projeto.
 */
export function autoReview(
  parts,
  memory = new Map(),
  catalog = [],
  { model = null } = {},
) {
  const ctx = standContext(parts);
  const known = new Set(catalog.map((m) => m.id));
  const valid = (id) => (id && (!known.size || known.has(id)) ? id : "");
  return parts.map((part) => {
    if (part.review?.confirmed) return part;
    const fp = part.fingerprint || {};
    const fromMemory = (key, confidence, reason) => {
      const m = key && memory.get(key);
      if (!m) return null;
      return {
        kind: m.kind,
        materialId: valid(m.materialId),
        finishId: valid(m.finishId),
        // Decisões que já divergiram para a mesma peça valem menos
        confidence: m.conflict ? confidence - 0.25 : confidence,
        source: "memory",
        reasons: [`${reason}${m.n > 1 ? ` (${m.n} vezes)` : ""}.`],
        name: nameKey(m.label) ? m.label : "",
      };
    };
    const rule = { ...classifyPart(part, ctx), source: "rules" };
    let auto =
      fromMemory(fp.exact, 0.96, "Mesma peça já validada em outro projeto") ||
      fromMemory(fp.shape, 0.9, "Mesmo nome e medidas de uma peça já validada");
    if (!auto) {
      const size = fromMemory(
        fp.size,
        0.62,
        "Mesmas medidas de uma peça já validada",
      );
      if (size && size.kind === rule.kind)
        auto = {
          ...rule,
          confidence: Math.max(rule.confidence, 0.88),
          reasons: [...rule.reasons, size.reasons[0]],
        };
      else if (size && rule.confidence < size.confidence) auto = size;
      else auto = rule;
      if (model) auto = withLearning(auto, part, ctx, model, valid);
    }
    // Uma regra forte (logo, arte, mesa, peça fora do stand…) não é atropelada por
    // uma decisão antiga: a peça volta para conferência
    if (
      auto.source !== "rules" &&
      auto.kind !== rule.kind &&
      rule.confidence >= 0.85
    )
      auto = {
        ...auto,
        confidence: Math.min(auto.confidence, 0.7),
        reasons: [
          ...auto.reasons.slice(0, 2),
          `As regras discordam: ${rule.reasons[0]}`,
        ],
      };
    // Sugestão que não combina com as medidas volta para a leitura das regras
    if (!plausible(auto.kind, part) && plausible(rule.kind, part))
      auto = {
        ...rule,
        reasons: [
          ...rule.reasons.slice(0, 2),
          `A ${auto.source === "memory" ? "memória" : "sugestão aprendida"} indicava outro tipo, que não combina com as medidas.`,
        ],
      };
    auto.confidence = Math.max(
      0,
      Math.min(1, Math.round(auto.confidence * 100) / 100),
    );
    if (auto.kind === "unclassified") auto.confidence = 0;
    auto.level = levelOf(auto.confidence);
    // Pré-preenche só o que o humano ainda não mexeu (vazio ou igual à sugestão
    // anterior); vermelho fica para decidir
    const r = part.review;
    const untouched =
      (r.kind === "unclassified" && !r.materialId && !r.finishId) ||
      sameAsAuto(part);
    const review =
      untouched && auto.level !== "red"
        ? {
            ...r,
            kind: auto.kind,
            materialId: auto.materialId || "",
            finishId: auto.finishId || "",
          }
        : r;
    // Nome de trabalho no lugar de "Peça 219": só se o nome ainda é automático
    const autoLabel =
      !nameKey(part.label) ||
      (part.auto?.name && part.label === part.auto.name);
    const label = autoLabel && auto.name ? auto.name : part.label;
    return {
      ...part,
      label,
      auto,
      suggestion: { kind: auto.kind, reason: auto.reasons[0] },
      review,
    };
  });
}

/**
 * Camada 3: combina a sugestão das regras (ou da pista de medidas) com o modelo
 * treinado nas validações do espaço. Concordando, a confiança sobe; discordando,
 * vence o mais confiável e a outra leitura vira um aviso para conferir.
 */
function withLearning(current, part, ctx, model, valid) {
  const pred = predict(model, sampleOf(part, ctx));
  if (!pred) return current;
  // Poucos exemplos ou acerto estimado baixo: o modelo pesa menos
  const trust = Math.min(1, model.size / 150);
  const quality = Math.min(1, (model.accuracy ?? 0.7) + 0.15);
  const p = pred.probability * (0.7 + 0.3 * trust) * quality;
  const near = pred.nearest
    ? `: parecida com "${pred.nearest.label}"${pred.nearest.project ? ` (${pred.nearest.project})` : ""}`
    : "";
  const reason = `Aprendido de ${model.size} peças validadas${near}.`;
  const learnedMaterial = valid(pred.materialId),
    learnedFinish = valid(pred.finishId);
  if (pred.kind === current.kind)
    return {
      ...current,
      // Material e revestimento que a equipe costuma usar nesse tipo de peça
      // A espessura medida no modelo vale mais que o costume aprendido
      materialId: current.materialMeasured
        ? current.materialId
        : learnedMaterial || current.materialId,
      finishId: learnedFinish || current.finishId,
      confidence: Math.min(0.97, 1 - (1 - current.confidence) * (1 - p)),
      source: current.source === "rules" ? "rules+learning" : current.source,
      reasons: [current.reasons[0], reason, ...current.reasons.slice(1)].slice(
        0,
        3,
      ),
    };
  if (p > current.confidence + 0.05)
    return {
      kind: pred.kind,
      materialId: learnedMaterial,
      finishId: learnedFinish,
      confidence: p * 0.95,
      source: "learning",
      reasons: [
        reason,
        current.kind !== "unclassified"
          ? `As regras sugeriam outro tipo (${current.reasons[0]}): confira.`
          : "Nenhuma regra reconheceu a peça; a sugestão vem do aprendizado.",
      ],
      name: nameFor(pred.kind, "", part.dimensions),
    };
  if (p >= 0.5)
    return {
      ...current,
      confidence: current.confidence * 0.85,
      reasons: [
        ...current.reasons.slice(0, 2),
        `O aprendizado sugere outro tipo (${Math.round(p * 100)}%): confira.`,
      ],
    };
  return current;
}

/**
 * Aceita em lote as peças verdes que ainda estão como o sistema sugeriu:
 * confirma as medidas e valida. Devolve o projeto e quantas foram aceitas.
 */
export function acceptGreen(project) {
  let count = 0;
  const parts = project.parts.map((p) => {
    if (p.review.confirmed || p.auto?.level !== "green" || !sameAsAuto(p))
      return p;
    const next = { ...p, review: { ...p.review, dimensionsConfirmed: true } };
    if (partIssues(next).length) return p;
    count++;
    return { ...next, review: { ...next.review, confirmed: true } };
  });
  return { project: { ...project, status: "review", parts }, count };
}

/** Peças verdes que ainda podem ser aceitas em lote. */
export const greenPending = (project) =>
  (project?.parts || []).filter(
    (p) => !p.review.confirmed && p.auto?.level === "green" && sameAsAuto(p),
  ).length;

/**
 * Memória do próprio projeto: decisões já validadas nele. Junta-se à memória do
 * espaço de trabalho para que peças idênticas fiquem verdes assim que uma é validada.
 */
export function projectMemory(parts, base = new Map()) {
  const memory = new Map(base);
  for (const e of memoryEntries(parts))
    memory.set(e.key, mergeMemory(memory.get(e.key), e));
  return memory;
}

/** Recalcula as sugestões do projeto com a memória (do espaço + do próprio projeto). */
export { sampleOf };

export function refreshAuto(
  project,
  memory = new Map(),
  catalog = project.materials,
  options = {},
) {
  return {
    ...project,
    parts: autoReview(
      project.parts,
      projectMemory(project.parts, memory),
      catalog,
      options,
    ),
  };
}

/**
 * Exemplos de treino das peças recém-validadas: um por peça diferente (cópias
 * iguais do mesmo projeto contam uma vez, para não viciar o modelo).
 */
export function trainingSamples(project, parts) {
  const ctx = standContext(project.parts);
  return groupIdentical(parts.filter((p) => p.review?.confirmed)).map((g) =>
    sampleOf(g.part, ctx, project),
  );
}

/** Decisões humanas para gravar na memória (só peças validadas). */
export function memoryEntries(parts) {
  const out = [];
  for (const p of parts) {
    if (!p.review?.confirmed || !p.fingerprint) continue;
    for (const key of Object.values(p.fingerprint))
      if (key)
        out.push({
          key,
          kind: p.review.kind,
          materialId: p.review.materialId || "",
          finishId: p.review.finishId || "",
          label: String(p.label || "").slice(0, 120),
        });
  }
  return out;
}

/**
 * Peças idênticas (mesma impressão digital exata e a mesma decisão) viram um item
 * só, com quantidade: uma linha na lista, uma folha no caderno.
 */
export function groupIdentical(parts) {
  const groups = new Map();
  for (const p of parts) {
    const r = p.review || {};
    const key = p.fingerprint?.exact
      ? `${p.fingerprint.exact}|${r.confirmed ? 1 : 0}|${r.kind}|${r.materialId}|${r.finishId}`
      : p.id;
    if (!groups.has(key)) groups.set(key, { key, part: p, parts: [] });
    groups.get(key).parts.push(p);
  }
  return [...groups.values()].map((g) => ({
    ...g,
    ids: g.parts.map((p) => p.id),
    quantity: g.parts.length,
  }));
}

/** Semáforo e taxa de acerto: quantas sugestões o humano aceitou sem mudar. */
export function autoStats(project) {
  const s = { green: 0, yellow: 0, red: 0, accepted: 0, edited: 0 };
  for (const p of project?.parts || []) {
    if (!p.auto) continue;
    if (p.review.confirmed) {
      if (sameAsAuto(p)) s.accepted++;
      else s.edited++;
    } else s[p.auto.level]++;
  }
  const done = s.accepted + s.edited;
  s.rate = done ? Math.round((s.accepted / done) * 100) : null;
  return s;
}
