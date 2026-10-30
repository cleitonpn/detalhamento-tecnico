/** Diagnósticos do arquivo inteiro: não atribuem uma face omitida a uma peça específica. */
export function importDiagnostics(data = {}) {
  const cad = data.dtCad, skp = data.dtSkp;
  const warnings = [];
  if (cad?.unitMismatch) warnings.push({ code: "unit-mismatch",
    message: "A unidade inferida diverge do cabeçalho. Confira uma medida conhecida antes de validar." });
  if (cad?.solidFacesSkipped) warnings.push({ code: "missing-faces",
    message: `${cad.solidFacesSkipped} face(s) de sólidos não foram recuperadas. A geometria pode estar incompleta.` });
  if (cad?.solids3d) warnings.push({ code: "missing-solids",
    message: `${cad.solids3d} sólido(s) não puderam ser lidos.` });
  if (cad?.solidReadFailures) warnings.push({ code: "solid-read-failure",
    message: "O leitor registrou falha ao recuperar sólidos. Compare com o desenho original." });
  if (skp?.failed) warnings.push({ code: "skp-missing-faces",
    message: `${skp.failed} face(s) do SketchUp não puderam ser recuperadas.` });
  return { source: cad ? "cad" : skp ? "skp" : "glb", warnings };
}

export function importNotice(project) {
  const warnings = project.importDiagnostics?.warnings || [];
  if (!warnings.length) return "";
  const unit = warnings.some(w => w.code === "unit-mismatch");
  const geometry = warnings.some(w => w.code !== "unit-mismatch");
  return `ALERTA DO ARQUIVO: ${[unit && "unidade divergente", geometry && "geometria possivelmente incompleta"].filter(Boolean).join("; ")}. Conferir com o original.`;
}
