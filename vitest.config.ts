import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Patrones glob, no rutas literales — "node_modules" a secas solo excluye
    // el de la raíz, no uno anidado (ej. dentro de un worktree bajo .claude/).
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
