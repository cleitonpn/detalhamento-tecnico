// Dá acesso a um usuário num espaço de trabalho do Detalha (instalação com projeto próprio).
// Roda no GitHub Actions com a conta de serviço; nunca no navegador.
// O usuário precisa existir antes em Authentication → Usuários, no Console do Firebase.
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const { DT_PROJECT: projectId, DT_EMAIL: email, DT_ROLE: role = "owner", DT_WORKSPACE: workspaceId = "uset", DT_ACTIVE: active = "true" } = process.env;
if (!projectId || !email) throw Error("Informe o projeto e o e-mail.");
if (!["owner", "editor", "viewer"].includes(role)) throw Error("Papel inválido: use owner, editor ou viewer.");
if (!/^[A-Za-z0-9_-]{2,64}$/.test(workspaceId)) throw Error("Espaço de trabalho inválido.");

initializeApp({ projectId });
const auth = getAuth(), db = getFirestore();
let user;
try {
  user = await auth.getUserByEmail(email.trim());
} catch {
  throw Error("Usuário não encontrado. Crie-o em Authentication → Usuários no Console do Firebase e rode de novo.");
}
await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), detalhamento: true });
const ref = db.doc(`dt_workspaces/${workspaceId}`);
await db.runTransaction(async (tx) => {
  const ws = await tx.get(ref);
  if (!ws.exists)
    tx.create(ref, { name: workspaceId === "uset" ? "Equipe USET" : workspaceId, owner: user.uid, createdAt: FieldValue.serverTimestamp() });
  tx.set(ref.collection("members").doc(user.uid), { role, active: active === "true", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
});
console.log(`Acesso ${active === "true" ? "liberado" : "suspenso"}: ${role} no espaço ${workspaceId} (uid ${user.uid.slice(0, 6)}…). Peça para a pessoa sair e entrar de novo no Detalha.`);
