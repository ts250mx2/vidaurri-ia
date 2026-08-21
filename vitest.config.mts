import path from "node:path";
import { defineConfig } from "vitest/config";

// Pruebas unitarias de la lógica pura (src/lib/*.test.ts). Las API routes y
// las páginas se prueban contra el servidor en marcha, no aquí.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
