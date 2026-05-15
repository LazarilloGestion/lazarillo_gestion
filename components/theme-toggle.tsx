"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  if (!mounted) {
    return (
      <button
        disabled
        className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground"
        aria-label="Cargando tema..."
      >
        <div className="w-4 h-4 rounded-full bg-muted-foreground/30 animate-pulse" />
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors"
      aria-label={`Cambiar a tema ${dark ? "claro" : "oscuro"}`}
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
