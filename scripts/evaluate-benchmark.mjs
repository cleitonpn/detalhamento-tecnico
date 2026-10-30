import { readFile } from "node:fs/promises";
import { evaluateBenchmark } from "../src/lib/classificationBenchmark.js";
const [projectFile, benchmarkFile] = process.argv.slice(2);
if (!projectFile || !benchmarkFile) throw Error("Uso: node scripts/evaluate-benchmark.mjs projeto.json gabarito.json");
const project = JSON.parse(await readFile(projectFile, "utf8")), benchmark = JSON.parse(await readFile(benchmarkFile, "utf8"));
console.log(JSON.stringify(evaluateBenchmark(project, benchmark), null, 2));
