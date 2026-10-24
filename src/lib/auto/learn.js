// Camada 3 — aprendizado com as correções (a "IA proprietária" do Detalha).
// Aprendizado de máquina clássico, sem serviço externo: uma floresta de árvores de
// decisão treinada no navegador com as peças que a equipe validou. Cada exemplo
// guarda as características da peça e a decisão humana; correções (quando o humano
// mudou a sugestão) pesam mais, porque mostram onde as regras erram.

const deaccent = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const WORD_BUCKETS = 24;
// Palavras que não ajudam a reconhecer a peça
const STOP = new Set([
  "peca",
  "malha",
  "agrupar",
  "grupo",
  "group",
  "componente",
  "component",
  "solid",
  "polyface",
  "mesh",
  "cor",
  "color",
  "sem",
  "nome",
  "padrao",
  "default",
  "layer",
  "tag",
  "etiquetas",
  "material",
  "the",
  "com",
  "para",
  "dos",
  "das",
]);
const words = (text) =>
  deaccent(text)
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
// Palavra -> posição fixa (hash), para o nome e o material entrarem no modelo
function bucket(word) {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++)
    h = Math.imul(h ^ word.charCodeAt(i), 16777619);
  return (h >>> 0) % WORD_BUCKETS;
}

/**
 * Exemplo de treino a partir de uma peça validada, com o contexto do stand (piso,
 * centro). Guarda só o necessário para recalcular as características.
 */
export function sampleOf(part, ctx, project = {}) {
  const [w, h, d] = part.dimensions;
  const r = part.review;
  return {
    key: `${project.id || "p"}|${part.fingerprint?.exact || part.id}`.slice(
      0,
      200,
    ),
    project: String(project.name || "").slice(0, 80),
    label: String(part.label || "").slice(0, 80),
    w,
    h,
    d,
    y0: part.bounds.min[1] - ctx.floorY,
    y1: part.bounds.max[1] - ctx.floorY,
    dist: ctx.distance.get(part.id) || 0,
    standSize: ctx.size || 10,
    tris: part.surface?.tris || 0,
    area: part.surface?.area || 0,
    text: [
      part.label,
      part.hints?.definition,
      part.hints?.tag,
      ...(part.materialsOriginal || []),
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 240),
    small: part.hints?.smallItems ? 1 : 0,
    parts: part.shape?.parts || 1,
    main: part.shape?.main ?? 1,
    front: part.shape?.front ?? 1,
    top: part.shape?.top ?? 1,
    tpp: part.shape?.trisPerPart || 12,
    kind: r.kind,
    materialId: r.materialId || "",
    finishId: r.finishId || "",
    // O humano mudou a sugestão automática? (exemplo mais valioso)
    edited: part.auto
      ? r.kind !== part.auto.kind ||
        (r.materialId || "") !== (part.auto.materialId || "") ||
        (r.finishId || "") !== (part.auto.finishId || "")
      : false,
  };
}

const log = (v) => Math.log10(Math.max(v, 1e-4));
/** Vetor numérico de características (independe de posição e rotação da peça). */
export function featuresOf(s) {
  const dims = [s.w, s.h, s.d];
  const [t, m, L] = [...dims].sort((a, b) => a - b);
  const bbox = 2 * (s.w * s.h + s.w * s.d + s.h * s.d) || 1e-6;
  const f = [
    log(s.w),
    log(s.h),
    log(s.d),
    log(t),
    log(m),
    log(L),
    s.y0,
    s.y1,
    Math.min(s.dist / (s.standSize || 10), 5),
    log(s.w * s.d), // área em planta
    log(Math.max(s.w, s.d) * s.h), // área de frente
    log(L / Math.max(t, 1e-3)), // esbeltez
    s.h / Math.max(s.w, s.d, 1e-3), // alto x largo
    t <= 0.003 ? 1 : 0, // superfície sem espessura
    s.y0 <= 0.15 ? 1 : 0, // nasce no chão
    s.y0 >= 2 ? 1 : 0, // no alto
    log(s.tris + 1),
    Math.min(s.area / bbox, 10), // complexidade da forma
    s.small,
    log(s.parts ?? 1), // partes soltas (letras, ícones, ripas)
    s.main ?? 1, // face principal preenchida
    s.front ?? 1, // frente fechada (balcão) ou aberta (mesa)
    s.top ?? 1,
    log(s.tpp ?? 12), // faces por parte (contorno curvo)
  ];
  const bag = new Array(WORD_BUCKETS).fill(0);
  for (const w of words(s.text)) bag[bucket(w)] = 1;
  return f.concat(bag);
}

// ---------- floresta de árvores de decisão (CART, índice de Gini) ----------

function gini(counts, total) {
  let s = 1;
  for (const c of counts) s -= (c / total) ** 2;
  return s;
}

function buildTree(X, y, wts, idx, nClasses, rand, opts, depth = 0) {
  const counts = new Array(nClasses).fill(0);
  let total = 0;
  for (const i of idx) {
    counts[y[i]] += wts[i];
    total += wts[i];
  }
  const leaf = () => ({ dist: counts.map((c) => c / (total || 1)) });
  if (
    depth >= opts.maxDepth ||
    idx.length <= opts.minLeaf * 2 ||
    counts.filter((c) => c > 0).length < 2
  )
    return leaf();
  const nF = X[0].length;
  const tryF = Math.max(1, Math.round(Math.sqrt(nF)));
  const features = [];
  while (features.length < tryF) {
    const f = Math.floor(rand() * nF);
    if (!features.includes(f)) features.push(f);
  }
  const base = gini(counts, total);
  let best = null;
  for (const f of features) {
    const values = idx.map((i) => X[i][f]).sort((a, b) => a - b);
    // Limiares candidatos: quantis (rápido mesmo com milhares de exemplos)
    const cuts = new Set();
    for (let q = 1; q < 16; q++) {
      const a = values[Math.floor((q / 16) * (values.length - 1))],
        b =
          values[
            Math.min(
              values.length - 1,
              Math.floor((q / 16) * (values.length - 1)) + 1,
            )
          ];
      if (a !== b) cuts.add((a + b) / 2);
    }
    for (const cut of cuts) {
      const left = new Array(nClasses).fill(0),
        right = new Array(nClasses).fill(0);
      let lt = 0,
        rt = 0;
      for (const i of idx) {
        if (X[i][f] <= cut) {
          left[y[i]] += wts[i];
          lt += wts[i];
        } else {
          right[y[i]] += wts[i];
          rt += wts[i];
        }
      }
      if (!lt || !rt) continue;
      const gain =
        base - (lt / total) * gini(left, lt) - (rt / total) * gini(right, rt);
      if (!best || gain > best.gain) best = { f, cut, gain };
    }
  }
  if (!best || best.gain <= 1e-9) return leaf();
  const L = [],
    R = [];
  for (const i of idx) (X[i][best.f] <= best.cut ? L : R).push(i);
  if (L.length < opts.minLeaf || R.length < opts.minLeaf) return leaf();
  return {
    f: best.f,
    cut: best.cut,
    left: buildTree(X, y, wts, L, nClasses, rand, opts, depth + 1),
    right: buildTree(X, y, wts, R, nClasses, rand, opts, depth + 1),
  };
}

const descend = (node, x) => {
  while (!node.dist) node = x[node.f] <= node.cut ? node.left : node.right;
  return node.dist;
};

// Gerador pseudoaleatório com semente (o mesmo treino dá o mesmo modelo)
function seeded(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Treina o modelo do espaço de trabalho. Devolve null se ainda há poucos exemplos.
 * O acerto estimado vem dos exemplos que cada árvore não viu (out-of-bag).
 */
export function trainModel(
  samples,
  { trees = 31, maxDepth = 12, minLeaf = 1, minSamples = 20 } = {},
) {
  const usable = samples.filter((s) => s.kind && s.kind !== "unclassified");
  const classes = [...new Set(usable.map((s) => s.kind))];
  if (usable.length < minSamples || classes.length < 2) return null;
  const X = usable.map(featuresOf);
  const y = usable.map((s) => classes.indexOf(s.kind));
  // Correções valem o dobro; peças repetidas contam uma vez por projeto
  const wts = usable.map((s) => (s.edited ? 2 : 1));
  const rand = seeded(usable.length);
  const forest = [];
  const oobVotes = usable.map(() => new Array(classes.length).fill(0));
  for (let k = 0; k < trees; k++) {
    const inBag = new Array(usable.length).fill(false);
    const idx = [];
    for (let i = 0; i < usable.length; i++) {
      const j = Math.floor(rand() * usable.length);
      idx.push(j);
      inBag[j] = true;
    }
    const tree = buildTree(X, y, wts, idx, classes.length, rand, {
      maxDepth,
      minLeaf,
    });
    forest.push(tree);
    for (let i = 0; i < usable.length; i++)
      if (!inBag[i])
        descend(tree, X[i]).forEach((p, c) => (oobVotes[i][c] += p));
  }
  let hit = 0,
    seen = 0;
  oobVotes.forEach((v, i) => {
    if (!v.some((p) => p > 0)) return;
    seen++;
    if (v.indexOf(Math.max(...v)) === y[i]) hit++;
  });
  // Escala das características para a busca de vizinhos (explicação e material)
  const nF = X[0].length;
  const mean = new Array(nF).fill(0),
    sd = new Array(nF).fill(0);
  for (const x of X) x.forEach((v, j) => (mean[j] += v / X.length));
  for (const x of X)
    x.forEach((v, j) => (sd[j] += (v - mean[j]) ** 2 / X.length));
  return {
    classes,
    forest,
    samples: usable,
    X,
    scale: { mean, sd: sd.map((v) => Math.sqrt(v) || 1) },
    size: usable.length,
    corrections: usable.filter((s) => s.edited).length,
    accuracy: seen ? hit / seen : null,
  };
}

/**
 * Previsão para uma peça: tipo com probabilidade, material e revestimento mais comuns
 * entre as peças validadas parecidas, e a mais parecida (para explicar).
 */
export function predict(model, sample) {
  if (!model) return null;
  const x = featuresOf(sample);
  const votes = new Array(model.classes.length).fill(0);
  for (const tree of model.forest)
    descend(tree, x).forEach((p, c) => (votes[c] += p / model.forest.length));
  const c = votes.indexOf(Math.max(...votes));
  const kind = model.classes[c];
  // Vizinhos de mesmo tipo (características normalizadas)
  const { mean, sd } = model.scale;
  const z = (v, j) => (v - mean[j]) / sd[j];
  const near = [];
  model.X.forEach((xi, i) => {
    if (model.samples[i].kind !== kind) return;
    let d2 = 0;
    for (let j = 0; j < x.length; j++) d2 += (z(x[j], j) - z(xi[j], j)) ** 2;
    near.push([d2, i]);
  });
  near.sort((a, b) => a[0] - b[0]);
  const top = near.slice(0, 5);
  const vote = (field) => {
    const tally = new Map();
    let total = 0;
    for (const [d2, i] of top) {
      const v = model.samples[i][field];
      const wv = 1 / (1 + d2);
      tally.set(v, (tally.get(v) || 0) + wv);
      total += wv;
    }
    let best = "",
      bw = 0;
    for (const [v, wv] of tally) if (wv > bw) [best, bw] = [v, wv];
    return { value: best, share: total ? bw / total : 0 };
  };
  const material = vote("materialId"),
    finish = vote("finishId");
  const nearest = top[0] ? model.samples[top[0][1]] : null;
  return {
    kind,
    probability: votes[c],
    materialId: material.share >= 0.6 ? material.value : "",
    finishId: finish.share >= 0.6 ? finish.value : "",
    materialShare: material.share,
    nearest: nearest
      ? { label: nearest.label, project: nearest.project }
      : null,
  };
}
