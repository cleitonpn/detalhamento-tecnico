// Extrai os sólidos ACIS (SAB) de um DWG 2013+ sem depender de bibliotecas externas.
// Implementado a partir da especificação aberta do formato DWG (Open Design Alliance):
// contêiner R2004+ (cabeçalho cifrado, mapa de páginas, seções comprimidas LZ77)
// e a seção de armazenamento de dados "AcDb:AcDsPrototype_1b".

const SAB_SIGNATURE = [
  0x41, 0x43, 0x49, 0x53, 0x20, 0x42, 0x69, 0x6e, 0x61, 0x72, 0x79, 0x46, 0x69,
  0x6c, 0x65,
]; // "ACIS BinaryFile"

/** Versão do DWG ("AC1032" = 2018+). */
export function dwgVersion(bytes) {
  return String.fromCharCode(...bytes.subarray(0, 6));
}

// Cabeçalho do contêiner em 0x80, cifrado com a sequência pseudoaleatória de semente 1
function fileHeader(bytes) {
  const h = new Uint8Array(0x6c);
  let seed = 1;
  for (let i = 0; i < 0x6c; i++) {
    seed = (Math.imul(seed, 0x343fd) + 0x269ec3) >>> 0;
    h[i] = bytes[0x80 + i] ^ ((seed >>> 16) & 0xff);
  }
  const v = new DataView(h.buffer);
  if (String.fromCharCode(...h.subarray(0, 11)) !== "AcFssFcAJMB")
    throw Error("Cabeçalho do contêiner DWG não reconhecido.");
  return {
    pageMapAddr: Number(v.getBigUint64(0x54, true)) + 0x100,
    sectionMapId: v.getUint32(0x5c, true),
  };
}

/** Descompressão LZ77 das seções R2004+. */
export function decompress(src, outSize) {
  const out = new Uint8Array(outSize);
  let s = 0,
    d = 0;
  const rc = () => src[s++];
  const literalLength = () => {
    const b = rc();
    if (b >= 1 && b <= 0x0f) return [b + 3, 0];
    if (b === 0) {
      let total = 0x0f,
        x;
      while ((x = rc()) === 0) total += 0xff;
      return [total + x + 3, 0];
    }
    return [0, b];
  };
  const longOffset = () => {
    let total = 0,
      x = rc();
    if (x === 0) {
      total = 0xff;
      while ((x = rc()) === 0) total += 0xff;
    }
    return total + x;
  };
  const twoByte = () => {
    const a = rc(),
      b = rc();
    return [(a >> 2) | (b << 6), a & 3];
  };
  const literal = (n) => {
    out.set(src.subarray(s, s + n), d);
    s += n;
    d += n;
  };
  const after = (count) => (count ? [count, 0] : literalLength());
  let [lit, opcode] = literalLength();
  literal(lit);
  while (s < src.length && d < outSize) {
    if (opcode === 0) opcode = rc();
    let bytes, offset, count;
    if (opcode >= 0x40) {
      bytes = (opcode >> 4) - 1;
      offset = (rc() << 2) | ((opcode & 0x0c) >> 2);
      count = opcode & 3;
    } else if (opcode >= 0x21 && opcode <= 0x3f) {
      bytes = opcode - 0x1e;
      [offset, count] = twoByte();
    } else if (opcode === 0x20) {
      bytes = longOffset() + 0x21;
      [offset, count] = twoByte();
    } else if (opcode >= 0x12 && opcode <= 0x1f) {
      bytes = (opcode & 0x0f) + 2;
      [offset, count] = twoByte();
      offset += 0x3fff;
    } else if (opcode === 0x10) {
      bytes = longOffset() + 9;
      [offset, count] = twoByte();
      offset += 0x3fff;
    } else if (opcode === 0x11) break;
    else throw Error(`Seção DWG corrompida (código 0x${opcode.toString(16)}).`);
    [lit, opcode] = after(count);
    for (let i = 0; i < bytes; i++, d++) out[d] = out[d - offset - 1];
    literal(Math.min(lit, src.length - s));
  }
  return out.subarray(0, d);
}

function readSection(bytes, namePattern) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fh = fileHeader(bytes);
  const systemPage = (addr) => {
    const dsize = dv.getUint32(addr + 4, true),
      csize = dv.getUint32(addr + 8, true),
      comp = dv.getUint32(addr + 12, true);
    const data = bytes.subarray(addr + 20, addr + 20 + csize);
    return comp === 2 ? decompress(data, dsize) : data;
  };
  // Mapa de páginas: (número, tamanho); números negativos são lacunas
  const pm = systemPage(fh.pageMapAddr);
  const pmv = new DataView(pm.buffer, pm.byteOffset, pm.byteLength);
  const pages = new Map();
  for (let i = 0, addr = 0x100; i + 8 <= pm.length;) {
    const num = pmv.getInt32(i, true),
      size = pmv.getInt32(i + 4, true);
    i += num > 0 ? 8 : 24;
    if (num > 0) pages.set(num, addr);
    addr += size;
  }
  // Mapa de seções: descrições com nome e lista de páginas
  const sm = systemPage(pages.get(fh.sectionMapId));
  const sv = new DataView(sm.buffer, sm.byteOffset, sm.byteLength);
  const count = sv.getInt32(0, true);
  for (let k = 0, p = 20; k < count; k++) {
    const size = Number(sv.getBigUint64(p, true)),
      pageCount = sv.getInt32(p + 8, true),
      maxSize = sv.getInt32(p + 12, true);
    const compressed = sv.getInt32(p + 20, true);
    const name = String.fromCharCode(...sm.subarray(p + 32, p + 96)).replace(
      /\0.*$/,
      "",
    );
    p += 96;
    const list = [];
    for (let j = 0; j < pageCount; j++, p += 16)
      list.push({
        page: sv.getInt32(p, true),
        start: Number(sv.getBigUint64(p + 8, true)),
      });
    if (!namePattern.test(name)) continue;
    const out = new Uint8Array(size + maxSize);
    for (const pg of list) {
      const addr = pages.get(pg.page);
      // Cabeçalho da página de dados: int32 cifrados com 0x4164536b ^ endereço
      const mask = (0x4164536b ^ addr) >>> 0;
      const csize = (dv.getUint32(addr + 8, true) ^ mask) >>> 0;
      const data = bytes.subarray(addr + 32, addr + 32 + csize);
      const plain = compressed === 2 ? decompress(data, maxSize) : data;
      out.set(
        plain.subarray(
          0,
          Math.max(0, Math.min(plain.length, out.length - pg.start)),
        ),
        pg.start,
      );
    }
    return out.subarray(0, size);
  }
  return null;
}

function indexOfSignature(data, from, to) {
  outer: for (let i = from; i <= to - SAB_SIGNATURE.length; i++) {
    for (let k = 0; k < SAB_SIGNATURE.length; k++)
      if (data[i + k] !== SAB_SIGNATURE[k]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Lê a seção AcDs e devolve Map(handle em hexadecimal → bytes SAB).
 * Índice de dados (datidx) → registro em _data_ (tamanho, int64 handle, deslocamento)
 * → bloco "ACIS BinaryFile" precedido do seu tamanho.
 */
export function extractAcisSolids(fileBytes) {
  const bytes =
    fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
  const version = dwgVersion(bytes);
  if (version < "AC1027")
    return { solids: new Map(), version, supported: false };
  const data = readSection(bytes, /AcDsPrototype/);
  if (!data) return { solids: new Map(), version, supported: true };
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.getUint32(0, true) !== 0x6472616a)
    throw Error("Seção de sólidos (AcDs) não reconhecida."); // "jard"
  // Tabela de segmentos: entradas de 12 bytes (int64 deslocamento, int32 tamanho)
  const segIdxOffset = v.getInt32(24, true);
  const segment = (index) =>
    Number(v.getBigInt64(segIdxOffset + 48 + index * 12, true));
  const dataIdx = segment(v.getInt32(40, true));
  const entries = v.getInt32(dataIdx + 48, true);
  const solids = new Map();
  const records = [];
  for (let k = 0; k < entries; k++) {
    const e = dataIdx + 56 + k * 12;
    const seg = v.getInt32(e, true),
      local = v.getInt32(e + 4, true);
    if (!seg) continue;
    const r = segment(seg) + 48 + local;
    if (v.getInt32(r, true) !== 20) continue;
    const handle = v
      .getBigUint64(r + 8, true)
      .toString(16)
      .toUpperCase();
    records.push({ handle, at: segment(seg) + 48 + v.getInt32(r + 16, true) });
  }
  records.sort((a, b) => a.at - b.at);
  records.forEach((rec, i) => {
    const limit = Math.min(records[i + 1]?.at ?? data.length, data.length);
    const at = indexOfSignature(data, rec.at, limit);
    if (at < 4) return;
    const size = v.getInt32(at - 4, true);
    if (size > 0 && at + size <= data.length)
      solids.set(rec.handle, data.subarray(at, at + size));
  });
  return { solids, version, supported: true };
}
