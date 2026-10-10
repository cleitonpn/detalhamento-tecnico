import test from "node:test";
import assert from "node:assert/strict";
import {
  requireMember,
  modelPath,
  checkVersion,
  assertStudioAdmin,
  assertProvisioned,
} from "../security.js";

test("exige membro ativo e separa consulta de edição", () => {
  assert.throws(() => requireMember(null), /acesso/);
  assert.throws(
    () => requireMember({ active: false, role: "owner" }),
    /acesso/,
  );
  assert.throws(
    () => requireMember({ active: true, role: "unknown" }),
    /acesso/,
  );
  assert.doesNotThrow(() => requireMember({ active: true, role: "viewer" }));
  assert.throws(
    () => requireMember({ active: true, role: "viewer" }, true),
    /acesso/,
  );
  assert.doesNotThrow(() =>
    requireMember({ active: true, role: "editor" }, true),
  );
});
test("somente uma conta provisionada pode criar um espaço independente", () => {
  assert.throws(() => assertProvisioned({}), /ativação/);
  assert.throws(() => assertProvisioned({ detalhamento: false }), /ativação/);
  assert.doesNotThrow(() => assertProvisioned({ detalhamento: true }));
});
test("namespace de arquivo não aceita caminhos arbitrários", () => {
  assert.throws(
    () => modelPath("../studio", "project", "a".repeat(64)),
    /inválido/,
  );
  assert.throws(
    () => modelPath("team", "../project", "a".repeat(64)),
    /inválido/,
  );
  assert.throws(() => modelPath("team", "project", "bad"), /inválida/);
  assert.equal(
    modelPath("team", "project", "a".repeat(64)),
    `dt_workspaces/team/projects/project/models/${"a".repeat(64)}.glb`,
  );
});
test("não sobrescreve outra sessão e não aceita expositor na integração Studio", () => {
  assert.doesNotThrow(() => checkVersion(0, undefined));
  assert.throws(() => checkVersion(1, 2), /outra tela/);
  assert.throws(
    () => assertStudioAdmin({ papel: "expositor", ativo: true }),
    /administrativa/,
  );
  assert.throws(
    () => assertStudioAdmin({ papel: "admin", ativo: false }),
    /administrativa/,
  );
  assert.doesNotThrow(() => assertStudioAdmin({ papel: "admin", ativo: true }));
});
