import { readFile, writeFile } from "node:fs/promises";

const source = process.argv[2];
if (!source)
  throw Error(
    "Uso: node scripts/import-materials.mjs caminho/data/complete-seed.json",
  );
const assets = JSON.parse(await readFile(source, "utf8"));
const ids = new Set([
  "custo-491",
  "custo-492",
  "custo-493",
  "custo-494",
  "custo-495",
  "custo-496",
  "custo-497",
  "custo-498",
  "custo-499",
  "bagum",
  "bagum-wood",
  "bagum-cement",
  "lycra",
  "floor-carpet",
  "floor-decorflex",
  "floor-mdf-white",
  "floor-mdf-wood",
  "floor-mdf-black",
]);
const materials = assets
  .filter((a) => ids.has(a.id))
  .map((a) => {
    const thickness = a.name.match(/(\d+(?:[.,]\d+)?)\s*mm/i);
    const sheet = a.name.match(/(\d+[.,]\d+)\s*x\s*(\d+[.,]\d+)/i);
    const number = (v) => Number(v.replace(",", "."));
    return {
      id: a.id,
      name: a.name,
      family: /mdf|compensad/i.test(a.name) ? "wood" : "finish",
      unit: a.unit,
      thicknessMm: thickness ? number(thickness[1]) : null,
      sheetM: sheet ? [number(sheet[1]), number(sheet[2])] : null,
      source: {
        repository: "https://github.com/cleitonpn/or-amento-uset",
        assetId: a.id,
        reference: a.source,
      },
      requiresConfirmation: true,
    };
  });
materials.push({
  id: "metalon-custom",
  name: "Metalon — seção a informar",
  family: "metal",
  unit: "m",
  thicknessMm: null,
  sheetM: null,
  source: null,
  requiresConfirmation: true,
});
await writeFile(
  new URL("../src/data/materials.json", import.meta.url),
  JSON.stringify(materials, null, 2) + "\n",
);
console.log(
  `${materials.length} referências técnicas importadas, sem preços ou custos.`,
);
