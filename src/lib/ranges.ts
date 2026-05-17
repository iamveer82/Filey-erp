/** Parse "1-3,5,8-" (1-based) into a sorted unique 0-based index list. */
export function parseRanges(input: string, pageCount: number): number[] {
  const out = new Set<number>();
  for (const part of input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const m = part.match(/^(\d+)?\s*-\s*(\d+)?$/);
    if (m) {
      const a = m[1] ? parseInt(m[1], 10) : 1;
      const b = m[2] ? parseInt(m[2], 10) : pageCount;
      for (let i = a; i <= b; i++)
        if (i >= 1 && i <= pageCount) out.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const i = parseInt(part, 10);
      if (i >= 1 && i <= pageCount) out.add(i - 1);
    }
  }
  return [...out].sort((x, y) => x - y);
}
