export const MONTHS = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
] as const;

export const MONTH_IDXS = Array.from({ length: 12 }, (_, i) => i + 1);
