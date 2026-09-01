import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Worktrees viven dentro del árbol (.claude/worktrees/<rama>/) y traen su
    // propio checkout + .next generado — el ".next/**" de arriba es relativo a
    // la raíz y no los alcanza, así que ensucian el lint con cientos de
    // "errores" de código no versionado. Nada en .claude/ es fuente de la app.
    "**/.claude/**",
  ]),
]);

export default eslintConfig;
