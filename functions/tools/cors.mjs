// Libera a leitura dos modelos no Storage a partir dos domínios do site do Detalha.
// Necessário para o navegador baixar o DWG/GLB salvo (getBlob). Só leitura (GET).
import { initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

const { DT_PROJECT: projectId, DT_SITE: site, DT_BUCKET: bucketName } = process.env;
if (!projectId || !site || !bucketName) throw Error("Informe projeto, site e bucket.");
initializeApp({ projectId, storageBucket: bucketName });
const bucket = getStorage().bucket();
const origins = [`https://${site}.web.app`, `https://${site}.firebaseapp.com`];
const [meta] = await bucket.getMetadata();
const rules = (meta.cors || []).filter((r) => !(r.origin || []).some((o) => origins.includes(o)));
rules.push({ origin: origins, method: ["GET", "HEAD"], responseHeader: ["Content-Type", "Content-Length"], maxAgeSeconds: 3600 });
await bucket.setCorsConfiguration(rules);
console.log(`CORS do bucket liberado para ${origins.join(" e ")}.`);
