import { KINDS } from "../../domain/project.js";
import { isLibraryCode } from "./fingerprint.js";

// Camada 1 — regras geométricas ("o olho do marceneiro").
// Lê medidas, espessura, altura em relação ao piso, posição no stand, nomes e
// materiais visuais e sugere o tipo da peça, o material de construção e o
// revestimento, com uma nota de confiança (0 a 1) e os motivos.

const deaccent = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const cm = (m) =>
  (Math.round(m * 1000) / 10).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  });

const NAME = {
  ignore:
    /\b(steve|sree|pessoa|person|people|human|figura|boneco|planta|vaso|plant|arvore|folhagem|essie|produto|garrafa|frasco|bottle|perfume|esmalte|livro|book|copo|xicara|notebook|laptop|celular)\b/,
  equipment:
    /\b(tv|televis|monitor|samsung|telao|screen|videowall|video wall|totem digital|computador|impressora)\b/,
  light:
    /\b(spot|spots|lumin|led|trilho|refletor|lamp|light|pendente|arandela|plafon)\b/,
  floor: /\b(piso|floor|tablado|palco|carpete|forracao|deck)\b/,
  fascia: /\b(testeira|fascia|faixa superior|bandeira)\b/,
  wall: /\b(parede|wall|painel|divisoria|fechamento|backdrop|biombo)\b/,
  metalon:
    /\b(metalon|perfil|tubo|estrutura metalica|treli|box truss|aco carbono|cantoneira)\b/,
  // Balcão é construído pelo stand: tem detalhamento
  counter: /\b(balcao|balcoes|bancada|counter|recepcao|caixa de atendimento)\b/,
  // Marcenaria sob medida comum em stand: detalhar, a conferir
  joinery: /\b(vitrine|expositor|gondola|nicho|display|totem)\b/,
  // Móveis locados ou comprados (e decoração): sem detalhamento
  movable:
    /\b(mesa|cadeira|banqueta|puff|pufe|poltrona|sofa|estante|armario|banco|rack|aparador|bistro|table|chair|stool|cabinet|ottoman|lounge|namoradeira|chaise)\b/,
  finish:
    /\b(adesivo|lona|plotagem|vinil|impressao|envelopamento|lycra|tecido)\b/,
};

// Espessuras de chapa do catálogo (mm) -> material de construção
const SHEETS = [
  [4, "custo-495"],
  [6, "custo-496"],
  [9, "custo-497"],
  [10, "custo-493"],
  [15, "custo-498"],
  [18, "custo-499"],
];

/** Revestimento sugerido pelos nomes dos materiais visuais. */
export function finishFromVisual(names) {
  const v = deaccent(names.join(" "));
  if (/bagum/.test(v)) {
    if (/madeir|wood|amadeir|carvalho|nogueira/.test(v)) return "bagum-wood";
    if (/ciment|concret|cinza/.test(v)) return "bagum-cement";
    return "bagum";
  }
  if (/carpete|carpet|forra/.test(v)) return "floor-carpet";
  if (/decorflex/.test(v)) return "floor-decorflex";
  if (/lycra/.test(v)) return "lycra";
  return "";
}

/** Contexto do stand: piso, área principal e peças fora dela (objetos esquecidos longe). */
export function standContext(parts) {
  const centers = parts.map((p) => [
    (p.bounds.min[0] + p.bounds.max[0]) / 2,
    (p.bounds.min[2] + p.bounds.max[2]) / 2,
  ]);
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };
  const mx = median(centers.map((c) => c[0])),
    mz = median(centers.map((c) => c[1]));
  const dist = centers.map((c) => Math.hypot(c[0] - mx, c[1] - mz));
  const outliers = new Set();
  parts.forEach((p, i) => {
    if (dist[i] > 20) outliers.add(p.id);
  });
  const inside = parts.filter((p) => !outliers.has(p.id));
  const ys = inside.map((p) => p.bounds.min[1]).sort((a, b) => a - b);
  // Piso: o nível mais baixo, ignorando 2% de pontos soltos abaixo dele
  const floorY = ys.length ? ys[Math.floor(ys.length * 0.02)] : 0;
  const spread = inside
    .map((p) => dist[parts.indexOf(p)])
    .sort((a, b) => a - b);
  return {
    center: [mx, mz],
    outliers,
    distance: new Map(parts.map((p, i) => [p.id, dist[i]])),
    floorY,
    // Raio que contém 90% das peças do stand
    size: Math.max(
      3,
      spread.length ? spread[Math.floor(spread.length * 0.9)] : 3,
    ),
  };
}

/**
 * Sugestão de uma peça. Devolve { kind, materialId, finishId, confidence, reasons }.
 * A confiança cai quando duas leituras empatam ou quando o material é só um palpite.
 */
export function classifyPart(part, context) {
  const [w, h, d] = part.dimensions; // largura, altura (vertical), profundidade
  const [t, , L] = [...part.dimensions].sort((a, b) => a - b);
  const y0 = part.bounds.min[1] - context.floorY,
    y1 = part.bounds.max[1] - context.floorY;
  const name = deaccent(
    [part.label, part.hints?.definition, part.hints?.tag]
      .filter(Boolean)
      .join(" "),
  );
  const visual = deaccent(part.materialsOriginal.join(" "));
  const text = `${name} ${visual}`;
  const out = [];
  const add = (kind, score, reason) => out.push({ kind, score, reason });

  // Fora do detalhamento: objeto esquecido longe do stand decide sozinho
  if (context.outliers.has(part.id))
    return {
      kind: "ignore",
      materialId: "",
      finishId: "",
      confidence: 0.92,
      reasons: [
        `Fora da área do stand (a ${Math.round(context.distance.get(part.id))} m).`,
      ],
      name: "",
    };
  if (part.hints?.smallItems)
    return {
      kind: "ignore",
      materialId: "",
      finishId: "",
      confidence: 0.9,
      reasons: [
        `Conjunto de ${part.hints.smallItems} itens pequenos repetidos: produtos expostos, não marcenaria.`,
      ],
      name: "Produtos expostos",
    };
  // Leitura da forma: partes soltas, preenchimento das faces, densidade da malha
  const sh = part.shape;
  const ignore = (confidence, reason, name) => ({
    kind: "ignore",
    materialId: "",
    finishId: "",
    confidence,
    reasons: [reason],
    name,
  });
  if (sh && L >= 0.2) {
    const pct = (v) => `${Math.round(v * 100)}%`;
    // Letras ou logo em 3D: várias partes soltas, face pouco preenchida, contornos curvos
    const mid = [...part.dimensions].sort((p, q) => p - q)[1];
    // Suporte de produtos: peça longa e estreita com muitos encaixes repetidos
    if (t <= 0.08 && mid < 0.1 && sh.parts >= 10)
      return ignore(
        0.8,
        `Suporte ou trilho de produtos (${sh.parts} encaixes em ${cm(L)} cm): expositor do cliente, sem detalhamento.`,
        "Suporte de produtos",
      );
    if (
      t <= 0.08 &&
      mid >= 0.1 &&
      sh.parts >= 3 &&
      sh.main <= 0.55 &&
      sh.trisPerPart >= 150
    )
      return ignore(
        0.9,
        `Letras ou logo em 3D (${sh.parts} partes soltas, ${pct(sh.main)} da face preenchida): comunicação visual, sem detalhamento de marcenaria.`,
        "Logo / letreiro",
      );
    // Arte, ícones ou desenho: muitas partes pequenas espalhadas
    if (sh.parts >= 5 && sh.main <= 0.2)
      return ignore(
        0.88,
        `Arte ou ícones soltos (${sh.parts} partes ocupando ${pct(sh.main)} da área): vai para o caderno de arte.`,
        "Arte / ícones",
      );
    // Mesa: tampo sobre pés, frente aberta, na altura de mesa
    if (
      y0 <= 0.2 &&
      h >= 0.6 &&
      h <= 0.85 &&
      Math.min(w, d) >= 0.4 &&
      sh.front <= 0.4
    )
      return ignore(
        0.88,
        `Mesa (tampo sobre pés, frente ${pct(sh.front)} fechada): móvel, sem detalhamento.`,
        "Mesa",
      );
    // Estofado ou móvel de biblioteca: malha muito densa no chão
    const density = part.surface?.area
      ? part.surface.tris / part.surface.area
      : 0;
    if (y0 <= 0.2 && h <= 1.1 && part.surface?.tris >= 5000 && density >= 3000)
      return ignore(
        0.86,
        `Estofado ou móvel de biblioteca (malha muito densa: ${Math.round(density)} faces/m²): sem detalhamento.`,
        "Estofado",
      );
  }
  // Item de biblioteca (código de catálogo no nome): móvel, decoração ou acessório pronto
  const code = [part.label, part.hints?.definition].find((n) =>
    isLibraryCode(n),
  );
  if (code)
    add(
      "ignore",
      y0 <= 0.2 && h <= 1.3 ? 0.84 : 0.72,
      `Item de biblioteca (${code}): móvel, decoração ou acessório pronto, sem detalhamento.`,
    );
  // Acessório pequeno (suporte, ponteira, luminária de mesa): não é peça do stand
  if (L < 0.2 && !NAME.light.test(text) && !NAME.counter?.test?.(name))
    add(
      "ignore",
      0.8,
      `Acessório de ${cm(L)} cm: pequeno demais para o detalhamento.`,
    );
  if (/^itens pequenos$/i.test(part.label))
    add("ignore", 0.9, "Conjunto de itens pequenos (produtos expostos).");
  if (NAME.ignore.test(name))
    add("ignore", 0.88, "Nome indica pessoa, planta ou produto.");
  if (L < 0.05)
    add("ignore", 0.8, `Item de ${cm(L)} cm: pequeno demais para detalhar.`);

  // Equipamento e iluminação
  if (NAME.equipment.test(text))
    add("equipment", 0.9, "Nome indica TV ou equipamento.");
  else if (
    t <= 0.12 &&
    h > 0.25 &&
    w / h >= 1.5 &&
    w / h <= 1.95 &&
    w >= 0.5 &&
    w <= 2.6 &&
    y0 >= 0.5
  )
    add(
      "equipment",
      0.6,
      "Chapa fina na proporção 16:9, fora do chão: parece TV.",
    );
  if (NAME.light.test(text)) add("light", 0.9, "Nome indica iluminação.");
  else if (L <= 0.4 && y0 >= 2.4)
    add("light", 0.55, "Peça pequena no alto: parece luminária.");

  // Piso
  if (h <= 0.25 && w * d >= 2 && y0 <= 0.15)
    add(
      "floor",
      NAME.floor.test(text) ? 0.95 : 0.86,
      `Plano horizontal de ${cm(w)} × ${cm(d)} cm junto ao chão.`,
    );
  else if (NAME.floor.test(name) && h <= 0.4)
    add("floor", 0.75, "Nome indica piso.");

  // Superfície sem espessura (logo, imagem, adesivo, lona): não é peça de marcenaria
  const surface = t < 0.003;
  if (surface && !(h <= 0.25 && w * d >= 2))
    add(
      "ignore",
      0.84,
      `Superfície sem espessura de ${cm(w)} × ${cm(Math.max(h, d))} cm: arte, imagem ou adesivo (caderno de arte).`,
    );

  // Testeira: painel no alto do stand
  if (!surface && y0 >= 2.0 && h >= 0.15 && h <= 1.6 && w >= 0.6 && t <= 0.35)
    add(
      "fascia",
      NAME.fascia.test(name) ? 0.95 : w / h >= 1.5 ? 0.88 : 0.8,
      `Painel de ${cm(w)} × ${cm(h)} cm a ${cm(y0)} cm do chão.`,
    );
  else if (NAME.fascia.test(name)) add("fascia", 0.8, "Nome indica testeira.");

  // Parede: painel vertical alto que nasce no chão
  if (
    !surface &&
    y0 <= 0.3 &&
    t <= 0.35 &&
    Math.max(w, d) >= 0.3 &&
    (h >= 1.5 || (h >= 1.0 && Math.max(w, d) / t >= 4))
  )
    add(
      "wall",
      Math.min(
        0.97,
        (h >= 2 ? 0.88 : t <= 0.06 && h >= 1.8 ? 0.84 : 0.76) +
          (NAME.wall.test(name) ? 0.08 : 0),
      ),
      `Painel vertical de ${cm(h)} cm de altura e ${cm(t)} cm de espessura.`,
    );
  else if (NAME.wall.test(name) && h >= 0.6)
    add("wall", 0.7, "Nome indica parede ou painel.");

  // Metalon: perfil longo de seção pequena
  const profile = [...part.dimensions].sort((a, b) => a - b);
  if (NAME.metalon.test(text))
    add("metalon", 0.9, "Nome indica estrutura metálica.");
  else if (
    profile[0] <= 0.1 &&
    profile[1] <= 0.1 &&
    L >= 0.3 &&
    L / profile[1] >= 6
  )
    add(
      "metalon",
      /aco|metal|inox|ferro|alumin|steel|cromo/.test(visual) ? 0.85 : 0.7,
      `Perfil de ${cm(profile[0])} × ${cm(profile[1])} cm com ${cm(L)} cm de comprimento.`,
    );

  // Mobiliário: só o balcão (e marcenaria sob medida) tem detalhamento; móveis
  // locados ou comprados e decoração do cliente ficam fora
  if (NAME.counter.test(name))
    add("furniture", 0.92, "Nome indica balcão: construído pelo stand.");
  else if (NAME.movable.test(name))
    add(
      "ignore",
      0.9,
      "Móvel locado ou comprado (banqueta, mesa, estante…): sem detalhamento.",
    );
  else if (NAME.joinery.test(name))
    add(
      "furniture",
      0.72,
      "Nome indica marcenaria sob medida (expositor, nicho): confira.",
    );
  else if (
    t >= 0.25 &&
    y0 <= 0.2 &&
    h >= 0.6 &&
    h <= 1.3 &&
    Math.max(w, d) >= 0.6 &&
    (!sh || sh.front >= 0.55)
  )
    add(
      "furniture",
      0.66,
      `Volume de ${cm(w)} × ${cm(h)} × ${cm(d)} cm no chão, na altura de balcão: confira.`,
    );

  // Conjunto de paredes (L, U) modelado como um grupo só
  if (h >= 1.5 && y0 <= 0.3 && t > 0.35 && L >= 1.5)
    add(
      "wall",
      0.56,
      "Conjunto alto e largo: parece um grupo de paredes (L ou U). Confira ou separe.",
    );
  // Peça horizontal no alto: forro, pergolado, base de testeira
  if (y0 >= 2.2 && h <= 0.3 && w * d >= 1)
    add(
      "other",
      0.6,
      `Peça horizontal de ${cm(w)} × ${cm(d)} cm no alto (forro ou pergolado).`,
    );
  // Chapa horizontal acima do chão: prateleira, tampo, base de nicho
  if (h <= 0.06 && w >= 0.2 && d >= 0.2 && y0 > 0.15)
    add(
      "other",
      NAME.movable.test(name) ? 0.6 : 0.74,
      `Chapa horizontal de ${cm(w)} × ${cm(d)} cm (prateleira ou tampo).`,
    );
  // Chapa vertical baixa: lateral, frente ou fechamento de móvel
  if (t <= 0.06 && h >= 0.3 && h < 1.5 && Math.max(w, d) >= 0.2 && y0 <= 0.3)
    add(
      "other",
      0.66,
      `Chapa vertical de ${cm(h)} cm (lateral ou fechamento).`,
    );

  // Revestimento: chapa muito fina (adesivo, lona, impressão)
  if (NAME.finish.test(text) && t <= 0.02)
    add("finish", 0.85, "Nome indica revestimento aplicado.");
  else if (t <= 0.006 && profile[1] >= 0.3)
    add("finish", 0.6, `Chapa de ${cm(t)} cm: parece adesivo ou revestimento.`);

  if (!out.length)
    return {
      kind: "unclassified",
      materialId: "",
      finishId: "",
      confidence: 0,
      reasons: ["Nenhuma regra reconheceu a peça."],
    };
  // Melhor leitura; empate próximo derruba a confiança
  out.sort((a, b) => b.score - a.score);
  const best = out[0],
    rival = out.find((o) => o.kind !== best.kind);
  let confidence = best.score;
  const reasons = [best.reason];
  if (rival && best.score - rival.score < 0.1) {
    confidence *= 0.85;
    reasons.push(
      `Também pode ser ${KINDS[rival.kind].toLowerCase()}: confira.`,
    );
  }
  const { materialId, finishId, materialConfidence, note, measured } =
    materials(best.kind, t, h, part, visual);
  if (note) reasons.push(note);
  confidence = Math.min(confidence, materialConfidence);
  return {
    kind: best.kind,
    materialId,
    finishId,
    confidence: Math.round(confidence * 100) / 100,
    reasons: reasons.slice(0, 3),
    // Material lido da espessura do modelo (não é palpite)
    materialMeasured: Boolean(measured),
    name: nameFor(best.kind, best.reason, part.dimensions),
  };
}

const round = (m) => Math.round(m * 100);
/**
 * A sugestão combina com as medidas? Evita absurdos vindos da memória (só medidas)
 * ou do aprendizado, como "TV" de 14 cm ou "testeira" no chão.
 */
export function plausible(kind, part) {
  const [w, h, d] = part.dimensions;
  const [t, , L] = [...part.dimensions].sort((a, b) => a - b);
  switch (kind) {
    case "equipment":
      return L >= 0.35;
    case "fascia":
      return Math.max(w, d) >= 0.4 && t <= 0.4;
    case "wall":
      return h >= 0.8 && Math.max(w, d) >= 0.3;
    case "floor":
      return w * d >= 0.5 && h <= 0.4;
    case "furniture":
      return L >= 0.3;
    case "metalon":
      return L >= 0.15;
    default:
      return true;
  }
}

/** Nome de trabalho pela leitura: "Testeira 300 × 100", "Prateleira 97 × 27". */
export function nameFor(kind, reason, [w, h, d]) {
  const sorted = [w, h, d].sort((a, b) => b - a);
  const two = (a, b) => `${round(a)} × ${round(b)}`;
  if (kind === "floor") return `Piso ${two(w, d)}`;
  if (kind === "fascia") return `Testeira ${two(w, h)}`;
  if (kind === "wall")
    return /grupo de paredes/.test(reason)
      ? `Conjunto de paredes ${two(w, h)}`
      : `Parede ${two(Math.max(w, d), h)}`;
  if (kind === "metalon") return `Metalon ${round(sorted[0])}`;
  if (kind === "finish") return `Revestimento ${two(sorted[0], sorted[1])}`;
  if (kind === "equipment") return `TV ${two(w, h)}`;
  if (kind === "light") return "Iluminação";
  if (kind === "furniture")
    return /expositor|nicho/.test(reason)
      ? `Expositor ${round(w)} × ${round(h)} × ${round(d)}`
      : `Balcão ${round(w)} × ${round(h)} × ${round(d)}`;
  if (kind === "other") {
    if (/^Chapa horizontal/.test(reason)) return `Prateleira ${two(w, d)}`;
    if (/^Chapa vertical/.test(reason))
      return `Lateral ${two(Math.max(w, d), h)}`;
    if (/no alto/.test(reason)) return `Forro ${two(w, d)}`;
    return `Peça ${two(sorted[0], sorted[1])}`;
  }
  return "";
}

// Material de construção e revestimento para o tipo escolhido
function materials(kind, t, h, part, visual) {
  const finishId = finishFromVisual(part.materialsOriginal);
  if (kind === "metalon")
    return {
      materialId: "metalon-custom",
      finishId: "",
      materialConfidence: 1,
    };
  if (kind === "floor") {
    const materialId = /preto|black/.test(visual)
      ? "floor-mdf-black"
      : /branco|white/.test(visual)
        ? "floor-mdf-white"
        : "floor-mdf-wood";
    return {
      materialId,
      finishId,
      materialConfidence: finishId ? 0.86 : 0.75,
      note: finishId ? "" : "Material do piso estimado: confira.",
    };
  }
  if (kind === "finish")
    return {
      materialId: finishId,
      finishId: "",
      materialConfidence: finishId ? 0.85 : 0.6,
      note: finishId ? "" : "Revestimento sem material identificado.",
    };
  if (kind === "wall" || kind === "fascia" || kind === "other") {
    // Chapa simples: a espessura do modelo diz a chapa do catálogo
    const mm = t * 1000;
    // Mais próxima do catálogo; até 1,2 mm é a própria chapa, até 2,5 mm o arredondamento do modelo
    const [sheet] = [...SHEETS].sort(
      (p, q) => Math.abs(mm - p[0]) - Math.abs(mm - q[0]),
    );
    const gap = Math.abs(mm - sheet[0]);
    if (gap <= 2.5)
      return {
        materialId: sheet[1],
        finishId,
        materialConfidence: gap <= 1.2 ? 0.9 : 0.8,
        measured: true,
        note: `Chapa de ${sheet[0]} mm pela espessura do modelo (${cm(t)} cm).`,
      };
    // Parede/testeira em caixa (estrutura + fechamento): MDF 15 mm é o padrão do stand;
    // o caderno mostra o material para a conferência final
    return {
      materialId: "custo-498",
      finishId,
      materialConfidence: kind === "other" ? 0.7 : 0.85,
      note: `Espessura de ${cm(t)} cm (em caixa): material padrão MDF 15 mm, confira no caderno.`,
    };
  }
  return { materialId: "", finishId, materialConfidence: 1 };
}
