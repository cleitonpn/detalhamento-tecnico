import { destinationOf, semanticRoleOf } from "../domain/project.js";
import { evidenceName } from "./auto/fingerprint.js";

/** Pré-seleção semântica. A geometria da face ainda precisa ser verificada. */
export function artEligibility(part) {
  const role = semanticRoleOf(part);
  const name = [evidenceName(part), part.hints?.definition, part.hints?.tag].filter(Boolean).join(" ");
  if (role === "render" || /enscape|v-?ray|pointlight|point light|ies light|omni light/i.test(name))
    return { candidate: false, blocked: true, reason: "Luz virtual ou auxiliar de renderização não é suporte de arte." };
  if (["furniture", "vegetation", "logo", "equipment", "light", "floor"].includes(role))
    return { candidate: false, blocked: false, reason: "Objeto fora da seleção automática de suportes. Confirme uma exceção se houver face adequada." };
  if (["excluded", "furniture", "electrical", "pending"].includes(destinationOf(part)))
    return { candidate: false, blocked: false, reason: "O destino atual não identifica uma superfície receptora de arte." };
  return {
    candidate: ["wall", "fascia", "counter", "finish", "shelf"].includes(role) || destinationOf(part) === "art",
    blocked: false,
    reason: "Escolha uma face plana e confira a orientação e a dimensão útil.",
  };
}
