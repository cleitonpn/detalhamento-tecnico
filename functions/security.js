import { assertId, MODEL_FORMATS } from "./domain.js";

export const EDIT_ROLES = new Set(["owner", "editor"]);
export function assertProvisioned(token) {
  if (token?.detalhamento !== true)
    throw Error("Solicite a ativação da sua conta de detalhamento.");
}
export function requireMember(member, write = false) {
  if (
    !member ||
    member.active !== true ||
    !["owner", "editor", "viewer"].includes(member.role) ||
    (write && !EDIT_ROLES.has(member.role))
  )
    throw Error("Você não tem acesso a este espaço de trabalho.");
  return member;
}
export function modelPath(workspaceId, projectId, hash, format = "glb") {
  assertId(workspaceId, "Espaço de trabalho");
  assertId(projectId, "Projeto");
  if (!/^[a-f0-9]{64}$/.test(hash))
    throw Error("Identidade do arquivo inválida.");
  if (!MODEL_FORMATS[format]) throw Error("Formato de modelo inválido.");
  return `dt_workspaces/${workspaceId}/projects/${projectId}/models/${hash}.${format}`;
}
export function checkVersion(expected, current) {
  if (!Number.isSafeInteger(expected) || expected !== (current || 0))
    throw Error(
      "Este projeto mudou em outra tela. Reabra a versão salva antes de continuar.",
    );
}
export function assertStudioAdmin(profile) {
  if (profile?.papel !== "admin" || profile.ativo === false)
    throw Error(
      "A integração requer uma conta administrativa ativa do Studio.",
    );
}
