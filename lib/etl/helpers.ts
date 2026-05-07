import * as XLSX from "xlsx";
import type { ETLRow } from "./types";

// ─── Primitivos ───────────────────────────────────────────────────────────────

export function trim(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  return s === "" ? null : s;
}

export function toDecimal(val: unknown): number | null {
  if (val == null || val === "" || val === " ") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

export function toBool(val: unknown): boolean | null {
  if (val == null) return null;
  if (typeof val === "boolean") return val;
  if (val === 1 || val === "1" || val === "true") return true;
  if (val === 0 || val === "0" || val === "false") return false;
  return null;
}

export function excelDateToISO(val: unknown): string | null {
  if (val == null || val === false || val === "") return null;
  if (typeof val === "number") {
    const date = XLSX.SSF.parse_date_code(val);
    return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  return null;
}

// ─── Normalización de texto ───────────────────────────────────────────────────

export function normalizeText(val: unknown): string | null {
  if (val == null) return null;
  let s = String(val);
  s = s.trim();
  s = s.replace(/[\x00-\x1F\x7F]/g, "");
  s = s.replace(/\s+/g, " ");
  s = s.replace(/--+/g, "-");
  s = s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  s = s.trim();
  return s === "" ? null : s;
}

// ─── Normalización de campos estructurados ───────────────────────────────────

export function normalizePhone(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  if (s === "") return null;
  if (/^[\d\s\-()+]+$/.test(s)) return s.replace(/\s+/g, "");
  return s;
}

export function normalizeCuit(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  if (s === "") return null;
  return s.replace(/[-\s]/g, "");
}

// ─── Excel ────────────────────────────────────────────────────────────────────

export function readExcelBuffer(buffer: Buffer): ETLRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  return XLSX.utils.sheet_to_json<ETLRow>(wb.Sheets[wb.SheetNames[0]]);
}

export function getExcelHeaders(buffer: Buffer): string[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const [headerRow] = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  return Array.isArray(headerRow) ? (headerRow as string[]) : [];
}
