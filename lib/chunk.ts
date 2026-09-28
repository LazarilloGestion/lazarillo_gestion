export function chunk<T>(items: T[], size: number): T[][] {
  // size <= 0 haría loopear infinito (o retroceder infinito) el for de abajo —
  // fallar explícito en vez de colgar el proceso (CLAUDE.md §2, sin fallos silenciosos).
  if (size <= 0) throw new RangeError("chunk: size debe ser mayor a 0");
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
