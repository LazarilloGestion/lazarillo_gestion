"use client";

import { Moon, Sun } from "lucide-react";

// El ícono correcto se elige por CSS según la clase `dark` que el script
// pre-paint de app/layout.tsx aplica antes de pintar → sin flash ni placeholder.
export function ThemeToggle() {
  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <button
      onClick={toggle}
      className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors"
      aria-label="Cambiar tema"
    >
      <Moon className="w-4 h-4 dark:hidden" />
      <Sun className="hidden w-4 h-4 dark:block" />
    </button>
  );
}
