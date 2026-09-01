import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Patrones glob, no rutas literales — "node_modules" a secas solo excluye
    // el de la raíz, no uno anidado (ej. dentro de un worktree bajo .claude/).
    // `**/.claude/**`: los worktrees viven en .claude/worktrees/<rama>/ y traen
    // sus propios *.test.ts, que el `include` matchea y duplican la corrida.
    exclude: ["**/node_modules/**", "**/.next/**", "**/.claude/**"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
