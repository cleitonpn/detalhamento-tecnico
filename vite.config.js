import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // O leitor de DWG resolve seu .wasm relativo ao próprio módulo; o pré-empacotamento quebraria esse caminho.
  optimizeDeps: { exclude: ["@mlightcad/libredwg-web"] },
  worker: { format: "es" },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "@react-three/fiber", "@react-three/drei"],
          firebase: [
            "firebase/app",
            "firebase/auth",
            "firebase/firestore",
            "firebase/storage",
            "firebase/functions",
          ],
        },
      },
    },
  },
});
