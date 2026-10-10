import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, connectStorageEmulator } from "firebase/storage";

const env = import.meta.env;
export const cloudMode = env.VITE_STORAGE_MODE === "firebase";
export const workspaceId = env.VITE_WORKSPACE_ID || "uset";
export const firebaseConfigured = Boolean(
  env.VITE_FIREBASE_API_KEY &&
  env.VITE_FIREBASE_PROJECT_ID &&
  env.VITE_FIREBASE_APP_ID,
);
const app =
  cloudMode && firebaseConfigured
    ? initializeApp({
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
        appId: env.VITE_FIREBASE_APP_ID,
      })
    : null;
export const auth = app ? getAuth(app) : null;
export const functions = app
  ? getFunctions(
      app,
      env.VITE_FIREBASE_FUNCTIONS_REGION || "southamerica-east1",
    )
  : null;
export const storage = app ? getStorage(app) : null;
if (app && env.DEV && env.VITE_USE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}
