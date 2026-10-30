export const ZONE_KINDS = {
  obstruction: "Obstrução visual (não recortar)",
  cutout: "Recorte confirmado por você",
  safety: "Área de segurança",
};

// Projetos antigos desenhavam todas as áreas como recorte; mantém a leitura
// anterior, com aviso na interface, até o usuário revisar cada tipo.
export const zoneKind = z => !z.kind ? "cutout" : Object.hasOwn(ZONE_KINDS, z.kind) ? z.kind : "obstruction";
export const zoneStyle = z => {
  const style = ({
  cutout: { title: "RECORTE", color: "#dc2626", fill: "#fde4e4" },
  obstruction: { title: "OBSTRUÇÃO VISUAL", color: "#b45309", fill: "#fff3db", dash: [1.5, 1] },
  safety: { title: "ÁREA DE SEGURANÇA", color: "#2563eb", fill: "#eff6ff", dash: [1.5, 1] },
  }[zoneKind(z)]);
  return z.requiresReview ? { ...style, title: `${style.title} A CONFERIR`,
    color: "#b45309", fill: "#fff3db", dash: [1.5, 1] } : style;
};

const sources = z => z.sourceIds || [String(z.id).startsWith("auto-") ? z.id.slice(5) : z.id];
export function refreshZones(existing, detected) {
  const manual = existing.filter(z => !z.auto);
  const retained = new Set(manual.flatMap(sources));
  return [...detected.filter(z => !sources(z).some(id => retained.has(id))), ...manual];
}
