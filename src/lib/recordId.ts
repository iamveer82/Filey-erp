// Keep existing bigint foreign keys and JS number callers. Cloud sequences use
// the lower half of the safe-integer range; offline inserts use random upper IDs.
// A database uniqueness constraint + insert-only sync rejects a rare collision.
export const LOCAL_ID_MIN = 2 ** 52;
export function nextLocalId(rows: ReadonlyArray<{ id?: unknown }>): number {
  const used = new Set(rows.map(row => row.id));
  for (let attempt = 0; attempt < 16; attempt++) {
    const words = crypto.getRandomValues(new Uint32Array(2));
    const id = LOCAL_ID_MIN + (words[0] & 0xfffff) * 2 ** 32 + words[1];
    if (!used.has(id)) return id;
  }
  throw new Error("Could not allocate a unique record ID. Retry saving.");
}
