import { readFile, writeFile } from "node:fs/promises";
const firestore = await readFile(
  new URL("../firebase/firestore.fragment", import.meta.url),
  "utf8",
);
const storage = await readFile(
  new URL("../firebase/storage.fragment", import.meta.url),
  "utf8",
);
await writeFile(
  new URL("../firebase/firestore.rules", import.meta.url),
  `// Somente para uma instalação independente ou emuladores.\nrules_version = '2';\nservice cloud.firestore { match /databases/{database}/documents {\n${firestore}\n} }\n`,
);
await writeFile(
  new URL("../firebase/storage.rules", import.meta.url),
  `// Somente para uma instalação independente ou emuladores.\nrules_version = '2';\nservice firebase.storage { match /b/{bucket}/o {\n${storage}\n} }\n`,
);
