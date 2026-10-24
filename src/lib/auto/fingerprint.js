// Impressão digital de uma peça: reconhece o mesmo objeto em outro projeto, em
// qualquer posição ou rotação. Duas chaves:
//  - exata: medidas (2 mm), número de triângulos e área da superfície (1%);
//    é a mesma peça de biblioteca (banqueta, spot, balcão padrão);
//  - forma: medidas (1 cm) e o nome, quando o projetista deu um nome de verdade;
//  - medida: só as medidas (1 cm), pista fraca.

// Hash curto e estável (cyrb53), em 13 caracteres hexadecimais
export function shortHash(text) {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0))
    .toString(16)
    .padStart(13, "0");
}

// Nomes automáticos (do SketchUp, do DWG ou do Detalha) não identificam a peça
const GENERIC =
  /^(?:(?:peca|malha|itens pequenos|conjunto|geometria solta|agrupar|grupo|group|componente|component|mesh|node|scene|geom3d|line|object|objeto|box|caixa|retangulo|rectangle|cylinder|circle|text)\b[\s#\d_.-]*|(?:3dsolid|solid|polyface|body|region|insert|3dface|mesh)\s*[0-9a-f]*)$/i;

/** Nome normalizado (sem acentos, minúsculo); vazio se for nome automático. */
export function nameKey(name) {
  const n = String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Também "Shape Bender Component#1", "Grupo207": nome automático no fim
  if (
    !n ||
    GENERIC.test(n) ||
    /(?:^|\s)(?:componente|component|agrupar|grupo|group)\s*\d*$/.test(n)
  )
    return "";
  // Sufixos de cópia ("balcão 2", "testeira#3", "banqueta (1)") não mudam o objeto
  return n.replace(/(?:\s*\(\d+\)|\s+\d+)$/, "").trim();
}

/**
 * Medidas da geometria de uma peça (no mundo, metros): triângulos e área.
 * `meshes` são malhas three.js já com matrixWorld atualizada; `scale` converte a
 * unidade do modelo para metros.
 */
export function surfaceStats(meshes, scale = 1) {
  let tris = 0,
    area = 0;
  const a = [0, 0, 0],
    b = [0, 0, 0],
    c = [0, 0, 0];
  for (const mesh of meshes) {
    const pos = mesh.geometry?.attributes?.position;
    if (!pos) continue;
    const index = mesh.geometry.index;
    const count = index ? index.count : pos.count;
    const e = mesh.matrixWorld.elements;
    const world = (i, out) => {
      const k = index ? index.getX(i) : i;
      const x = pos.getX(k),
        y = pos.getY(k),
        z = pos.getZ(k);
      out[0] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * scale;
      out[1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * scale;
      out[2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * scale;
    };
    for (let i = 0; i + 2 < count; i += 3) {
      world(i, a);
      world(i + 1, b);
      world(i + 2, c);
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        uz = b[2] - a[2];
      const vx = c[0] - a[0],
        vy = c[1] - a[1],
        vz = c[2] - a[2];
      area +=
        Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      tris++;
    }
  }
  return { tris, area };
}

/** Chaves da impressão digital a partir das medidas, da superfície e do nome. */
export function fingerprint({ dimensions, tris, area, name }) {
  const sorted = [...dimensions].sort((p, q) => p - q);
  const mm2 = sorted.map((v) => Math.round(v * 500)).join("x"); // passos de 2 mm
  const cm = sorted.map((v) => Math.round(v * 100)).join("x");
  // Área em passos de ~1% (escala logarítmica): a mesma peça exportada de novo bate
  const areaBucket = area > 0 ? Math.round(Math.log(area) * 100) : 0;
  const key = nameKey(name);
  return {
    exact: tris ? shortHash(`e|${mm2}|${tris}|${areaBucket}`) : null,
    shape: key ? shortHash(`s|${cm}|${key}`) : null,
    // Só as medidas: pista fraca (painéis do mesmo tamanho), vira sugestão a conferir
    size: shortHash(`d|${cm}`),
  };
}
