"use client";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder = "Buscar...", className }: SearchInputProps) {
  return (
    <div className={cn("relative flex items-center", className)}>
      <div className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-all w-full focus-within:border-zinc-300 dark:focus-within:border-zinc-600 focus-within:text-zinc-700 dark:focus-within:text-zinc-200">
        <Search className="w-3.5 h-3.5 shrink-0" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm font-normal outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 min-w-0"
        />
        {value && (
          <button
            onClick={() => onChange("")}
            aria-label="Limpiar búsqueda"
            className="shrink-0 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
