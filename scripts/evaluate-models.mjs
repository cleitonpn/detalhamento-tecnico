// Arquivos de clientes são entradas locais; nunca copie os modelos para o Git.
// Execute um arquivo por processo para liberar a memória entre modelos grandes.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseSkp } from "../src/lib/skp/parse.js";
import { SkpSceneBuilder } from "../src/lib/skp/scene.js";
import { parseDwg } from "../src/lib/dwg/parse.js";
import { DwgSceneBuilder, guessUnit } from "../src/lib/dwg/scene.js";
import { partitionScene } from "../src/lib/model.js";
import { autoReview, autoStats, groupIdentical } from "../src/lib/auto/index.js";
import catalog from "../src/data/materials.json" with { type: "json" };
import { artEligibility } from "../src/lib/artEligibility.js";
import { partFaces, worldTriangles } from "../src/lib/artbook.js";
import { buildRelations, inferSurfaceRole } from "../src/lib/context/relations.js";
import { importDiagnostics } from "../src/lib/importDiagnostics.js";
import { analyzeSurfaceSections } from "../src/lib/construction/sections.js";
import { partTriangles } from "../src/lib/techdraw.js";
import { buildHierarchy } from "../src/lib/context/hierarchy.js";

const file = process.argv[2];
if (!file || !/\.(skp|dwg|dxf)$/i.test(file))
  throw Error("Uso: node scripts/evaluate-models.mjs /caminho/modelo.skp|dwg|dxf");
const started = performance.now();
const bytes = await readFile(file);
let scene, stats, unit = "m", unitMismatch = false, diagnostics;
if (/\.skp$/i.test(file)) {
  const model = parseSkp(new Uint8Array(bytes));
  scene = new SkpSceneBuilder(model).build();
  stats = model.stats;
  diagnostics = importDiagnostics({ dtSkp: stats });
} else {
  const { LibreDwg } = await import("@mlightcad/libredwg-web");
  const lib = await LibreDwg.create();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const isDxf = /\.dxf$/i.test(file);
  const { model } = parseDwg(lib, isDxf ? new TextDecoder().decode(buffer) : buffer, isDxf);
  scene = new DwgSceneBuilder(model).build();
  ({ unit, mismatch: unitMismatch } = guessUnit(model.units, scene));
  stats = model.stats;
  diagnostics = importDiagnostics({ dtCad: {
    unitMismatch, solidFacesSkipped: stats.solidFacesSkipped,
    solids3d: stats.solids3d, solidReadFailures: stats.skipped?.["leitura dos sólidos"],
  } });
}
const analysis = partitionScene(scene, unit);
if (!analysis.parts.length) throw Error("Nenhuma peça importada.");
if (analysis.parts.some(p => p.dimensions.some(n => !Number.isFinite(n) || n < 0)))
  throw Error("Importação produziu medidas inválidas.");
const parts = autoReview(analysis.parts, new Map(), catalog, { projectName: basename(file) });
const classes = {};
for (const p of parts) classes[p.auto.kind] = (classes[p.auto.kind] || 0) + 1;
const supports = parts.filter(p => artEligibility(p).candidate);
const withFaces = supports.filter(p => partFaces(p, analysis.meshMap, unit, parts).length > 0);
const graph = buildRelations(parts, { trianglesOf: p => worldTriangles(p, analysis.meshMap, unit) });
const hierarchy = buildHierarchy(parts);
const sectionResults = process.argv.includes("--sections") ? parts.filter(p => ["wall", "fascia", "furniture"].includes(p.review.kind)).map(p => {
  const result = analyzeSurfaceSections(partTriangles(p, analysis.meshMap, unit), p.dimensions);
  return { id: p.id, label: p.label, kind: result.kind, circles: result.arcs.length, truncated: result.truncated };
}) : null;
console.log(JSON.stringify({ file: basename(file), bytes: bytes.length, unit, unitMismatch,
  hierarchy: { nodes: hierarchy.nodes.size, edges: hierarchy.edges.length, repeatedGroups: hierarchy.repeatedParts.length, truncated: hierarchy.truncated },
  ...(sectionResults ? { surfaceSections: sectionResults } : {}),
  relations: { testedPairs: graph.testedPairs, allPairs: parts.length * (parts.length - 1) / 2,
    verifiedHorizontalContacts: graph.edges.filter(e => e.verified && e.orientation === "horizontal").length,
    verifiedLateralContacts: graph.edges.filter(e => e.verified && e.orientation === "lateral").length,
    verifiedInclinedContacts: graph.edges.filter(e => e.verified && e.orientation === "inclined").length,
    partialSurfacePairs: graph.edges.filter(e => e.geometryTruncated).length,
    contextualSuggestions: parts.filter(p => inferSurfaceRole(p, graph, parts)).length,
    truncated: graph.truncated },
  importDiagnostics: diagnostics,
  art: { candidates: supports.length, supportsWithFaces: withFaces.length,
    blockedVirtualObjects: parts.filter(p => artEligibility(p).blocked).length },
  importStats: stats, parts: parts.length, listItems: groupIdentical(parts).length,
  suggestions: autoStats({ parts }), classes,
  unknownMaterials: parts.filter(p => ["wall", "fascia", "other"].includes(p.auto.kind) && !p.auto.materialId).length,
  elapsedSeconds: Math.round((performance.now() - started) / 100) / 10,
}, null, 2));
