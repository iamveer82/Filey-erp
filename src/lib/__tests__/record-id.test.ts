import { describe, expect, it, vi } from "vitest";
import { LOCAL_ID_MIN, nextLocalId } from "../recordId";

describe("offline record IDs", () => {
  it("independent devices sharing a snapshot allocate different safe numeric IDs", () => {
    const snapshot = [{ id: 1 }, { id: 29 }];
    const allocated = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const id = nextLocalId(snapshot);
      expect(Number.isSafeInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(LOCAL_ID_MIN);
      expect(allocated.has(id)).toBe(false);
      allocated.add(id);
    }
    expect(snapshot).toEqual([{ id: 1 }, { id: 29 }]);
  });

  it("fails without writing if the random source repeatedly collides", () => {
    const rng = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint32Array).fill(0);
      return array;
    });
    try { expect(() => nextLocalId([{ id: LOCAL_ID_MIN }])).toThrow(/unique record ID/); }
    finally { rng.mockRestore(); }
  });
});
