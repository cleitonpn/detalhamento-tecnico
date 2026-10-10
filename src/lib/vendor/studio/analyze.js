import * as THREE from "three";
import { sugerirPapel } from "./roles.js";

// ============================================================================
//  Analisador de projeto .glb
//
//  Validado contra os dois arquivos reais da Eletrolar (20m² e 45m²):
//    · nomes de nós são inúteis ("Geom3D", "Componente#51", sem nome)
//    · materiais são semânticos e poucos  → 18-21 por arquivo
//    · o 45m² traz o estande espelhado; o 20m² traz caixa de céu + pranchas 2D
//    · há geometria exatamente sobreposta (z-fighting) nos dois
// ============================================================================

const v = new THREE.Vector3();

/**
 * Identificador estável de uma peça, para guardar no banco.
 *
 * O uuid do three é gerado a cada carregamento — salvar uuid não sobrevive a um
 * reload. Já material + posição do centro no mundo é uma propriedade do arquivo:
 * vale entre sessões, entre navegadores e independe da ordem de travessia.
 *
 * Peças exatamente coincidentes colidem de propósito: são as duplicatas que o
 * analisador detecta, e para efeito de personalização elas são intercambiáveis.
 */
export function chaveDaPeca(materialNome, centro) {
  const p = centro.map((n) => (Math.round(n * 100) / 100).toFixed(2)).join(",");
  return `${materialNome}@${p}`;
}

/** Percorre a cena e coleta uma "peça" por primitiva de malha, com bbox em mundo. */
export function coletarPecas(root) {
  const pecas = [];
  root.updateWorldMatrix(true, true);

  // Mede a hierarquia antes de o viewer reorganizar as malhas para movimento.
  const caixas = new Map(),
    caminhos = new Map();
  function medirNo(o, caminho) {
    caminhos.set(o, caminho);
    const b = new THREE.Box3();
    if (o.isMesh && o.geometry) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    }
    o.children.forEach((filho, i) =>
      b.union(medirNo(filho, `${caminho}/${i}`)),
    );
    caixas.set(o, b);
    return b;
  }
  medirNo(root, "glb");

  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const geo = o.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();

    const bb = new THREE.Box3()
      .copy(geo.boundingBox)
      .applyMatrix4(o.matrixWorld);
    const size = bb.getSize(new THREE.Vector3());
    const centro = bb.getCenter(new THREE.Vector3());

    const idx = geo.index;
    const pos = geo.attributes.position;
    const tris = idx ? idx.count / 3 : pos ? pos.count / 3 : 0;

    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const mat = mats[0];

    const materialNome = mat?.name || "(sem material)";
    const local = geo.boundingBox.getSize(new THREE.Vector3()).toArray();
    const eixos = [0, 1, 2].map((i) =>
      new THREE.Vector3().setFromMatrixColumn(o.matrixWorld, i),
    );
    const dimensoesLocais = local.map((n, i) => n * eixos[i].length());
    const menor = dimensoesLocais.indexOf(Math.min(...dimensoesLocais));
    const normalPlano = new THREE.Vector3(
      menor === 0 ? 1 : 0,
      menor === 1 ? 1 : 0,
      menor === 2 ? 1 : 0,
    )
      .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(o.matrixWorld))
      .toArray();
    let componenteOrigem = null,
      nomeComponente = "";
    for (let pai = o.parent; pai && pai !== root; pai = pai.parent) {
      const b = caixas.get(pai),
        d = b.getSize(new THREE.Vector3());
      // Aparadores suspensos também têm um componente físico completo:
      // tampo e suportes podem estar acima do chão. O limite de porte evita
      // reconhecer a parede/estrutura inteira como componente de mobiliário.
      if (
        (b.min.y < 0.35 || b.max.y <= 2.2) &&
        d.y > 0.2 &&
        d.y <= 2.2 &&
        d.x <= 3.2 &&
        d.z <= 3.2
      )
        componenteOrigem = caminhos.get(pai);
      if (
        /balc[ãa]o|banqueta|cadeira|eames|tiffany|mesa|table|logo|logotipo|televis|samsung|monitor|smart.*tv/i.test(
          pai.name,
        )
      )
        nomeComponente = pai.name;
    }
    pecas.push({
      componenteOrigem,
      nomeComponente,
      uuid: o.uuid,
      chave: chaveDaPeca(materialNome, centro.toArray()),
      nome: o.name || "",
      materialNome,
      materialCor: mat?.color ? `#${mat.color.getHexString()}` : "",
      materialUuid: mat?.uuid || "none",
      tris,
      dimensoesLocais,
      normalPlano,
      bbox: {
        min: bb.min.toArray(),
        max: bb.max.toArray(),
        largura: size.x,
        altura: size.y,
        profundidade: size.z,
        centro: centro.toArray(),
      },
      // assinatura para detectar cópias exatamente sobrepostas
      assinatura: `${mat?.uuid || "x"}|${geo.uuid}|${bb.min
        .toArray()
        .map((n) => n.toFixed(3))
        .join(",")}|${bb.max
        .toArray()
        .map((n) => n.toFixed(3))
        .join(",")}`,
    });
  });

  return pecas;
}

/** Agrupa peças por material e resume — é isso que o admin vê para atribuir papéis. */
export function agruparPorMaterial(pecas) {
  const mapa = new Map();

  for (const p of pecas) {
    let g = mapa.get(p.materialNome);
    if (!g) {
      g = {
        nome: p.materialNome,
        pecas: 0,
        tris: 0,
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
        // maior peça INDIVIDUAL do material — não confundir com a extensão do
        // conjunto. Sete painéis de 5 m espalhados pelo arquivo somam 42 m de
        // extensão sem que nenhum deles seja grande.
        maiorPeca: 0,
        dims: [],
        uuids: [],
      };
      mapa.set(p.materialNome, g);
    }
    g.pecas++;
    g.tris += p.tris;
    g.uuids.push(p.uuid);
    g.maiorPeca = Math.max(
      g.maiorPeca,
      p.bbox.largura,
      p.bbox.altura,
      p.bbox.profundidade,
    );
    g.dims.push([p.bbox.largura, p.bbox.altura, p.bbox.profundidade]);
    for (let k = 0; k < 3; k++) {
      g.min[k] = Math.min(g.min[k], p.bbox.min[k]);
      g.max[k] = Math.max(g.max[k], p.bbox.max[k]);
    }
  }

  return [...mapa.values()]
    .map((g) => {
      const bbox = {
        min: g.min,
        max: g.max,
        largura: g.max[0] - g.min[0],
        altura: g.max[1] - g.min[1],
        profundidade: g.max[2] - g.min[2],
      };
      // A peça TÍPICA (mediana) é o que representa o material — a caixa do
      // conjunto não representa nada. Os 28 painéis A08_Garnet_Shadow medem
      // 2,90 × 2,90 × 0,10 cada, mas espalhados formam um conjunto de
      // 10 × 3,9 × 8: pela caixa do conjunto a "espessura" vira 8 m e a regra
      // de painel vertical nunca dispara, jogando parede em mobiliário.
      const mediana = (i) => {
        const v = g.dims.map((d) => d[i]).sort((a, b) => a - b);
        return v.length ? v[Math.floor(v.length / 2)] : 0;
      };
      const tipica = {
        largura: mediana(0),
        altura: mediana(1),
        profundidade: mediana(2),
      };

      const mat = { nome: g.nome, bbox, maiorPeca: g.maiorPeca, tipica };
      const { papel, motivo } = sugerirPapel(mat);
      return { ...g, bbox, tipica, papelSugerido: papel, motivo };
    })
    .sort((a, b) => b.tris - a.tris);
}

/** Cópias exatamente sobrepostas — causam z-fighting. Reportadas para o admin decidir. */
export function acharDuplicatas(pecas) {
  const vistos = new Map();
  const dups = [];
  for (const p of pecas) {
    const n = (vistos.get(p.assinatura) || 0) + 1;
    vistos.set(p.assinatura, n);
    if (n > 1) dups.push(p);
  }
  return {
    total: dups.length,
    tris: dups.reduce((s, p) => s + p.tris, 0),
    pecas: dups,
  };
}

/**
 * Regiões ocupadas no plano do chão (X/Z), por componentes conexos numa grade.
 *
 * Serve para achar conteúdo que está LONGE do estande — as pranchas 2D e a
 * caixa de céu do arquivo de 20m², que ficam a dezenas de metros de distância.
 *
 * O que ele NÃO faz, e não tem como fazer: separar um estande espelhado.
 * As duas metades se encostam, então formam um componente só. Para esse caso
 * o admin usa os divisores manuais (metade esquerda/direita) na tela de recorte.
 */
export function acharAglomerados(pecas, celula = 0.75) {
  const uteis = pecas.filter((p) => p.tris > 0 && isFinite(p.bbox.centro[0]));
  if (!uteis.length) return [];

  // rasteriza os centros das peças numa grade
  const ocup = new Map();
  const chave = (i, k) => `${i},${k}`;
  for (const p of uteis) {
    const i = Math.floor(p.bbox.centro[0] / celula);
    const k = Math.floor(p.bbox.centro[2] / celula);
    let c = ocup.get(chave(i, k));
    if (!c) {
      c = { i, k, pecas: [], tris: 0 };
      ocup.set(chave(i, k), c);
    }
    c.pecas.push(p);
    c.tris += p.tris;
  }

  // componentes conexos (8-vizinhos, para não quebrar em diagonais)
  const visto = new Set();
  const grupos = [];
  for (const [ch, cel] of ocup) {
    if (visto.has(ch)) continue;
    const fila = [cel];
    visto.add(ch);
    const membros = [];
    while (fila.length) {
      const c = fila.pop();
      membros.push(c);
      for (let di = -1; di <= 1; di++) {
        for (let dk = -1; dk <= 1; dk++) {
          if (!di && !dk) continue;
          const vk = chave(c.i + di, c.k + dk);
          if (ocup.has(vk) && !visto.has(vk)) {
            visto.add(vk);
            fila.push(ocup.get(vk));
          }
        }
      }
    }
    grupos.push(membros);
  }

  return grupos
    .map((membros) => {
      const min = [Infinity, Infinity],
        max = [-Infinity, -Infinity];
      let tris = 0,
        nPecas = 0,
        alturaMax = -Infinity;
      for (const cel of membros) {
        for (const p of cel.pecas) {
          min[0] = Math.min(min[0], p.bbox.min[0]);
          max[0] = Math.max(max[0], p.bbox.max[0]);
          min[1] = Math.min(min[1], p.bbox.min[2]);
          max[1] = Math.max(max[1], p.bbox.max[2]);
          alturaMax = Math.max(alturaMax, p.bbox.max[1]);
          tris += p.tris;
          nPecas++;
        }
      }
      const largura = max[0] - min[0],
        profundidade = max[1] - min[1];
      return {
        min,
        max,
        largura,
        profundidade,
        area: largura * profundidade,
        tris,
        pecas: nPecas,
        alturaMax,
      };
    })
    .sort((a, b) => b.tris - a.tris);
}

/** Análise completa de um GLB já carregado. */
export function analisar(root) {
  const pecas = coletarPecas(root);
  const materiais = agruparPorMaterial(pecas);
  const duplicatas = acharDuplicatas(pecas);
  const aglomerados = acharAglomerados(pecas);

  const caixa = new THREE.Box3().setFromObject(root);
  const tam = caixa.getSize(v.clone());

  return {
    pecas,
    materiais,
    duplicatas,
    aglomerados,
    resumo: {
      pecasTotal: pecas.length,
      trisTotal: pecas.reduce((s, p) => s + p.tris, 0),
      materiaisTotal: materiais.length,
      cena: {
        min: caixa.min.toArray(),
        max: caixa.max.toArray(),
        largura: tam.x,
        altura: tam.y,
        profundidade: tam.z,
      },
    },
  };
}

/** Aplica o recorte: o que fica fora da área do estande é marcado para descarte. */
export function dentroDoRecorte(peca, recorte) {
  if (!recorte) return true;
  const [cx, , cz] = peca.bbox.centro;
  return (
    cx >= recorte.x0 && cx <= recorte.x1 && cz >= recorte.z0 && cz <= recorte.z1
  );
}
