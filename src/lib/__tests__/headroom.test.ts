import { beforeEach, describe, expect, it } from "vitest";
import {
  compressForModel,
  headroomRetrieve,
  headroomReset,
  headroomStats,
} from "../headroom";

beforeEach(() => {
  localStorage.clear();
  headroomReset();
});

const bigRows = Array.from({ length: 60 }, (_, i) => ({
  id: i + 1,
  number: `INV-${1000 + i}`,
  customer_name: i % 2 ? "Acme Trading LLC" : "Gulf Paper Co",
  total: 100 + i * 7.5,
  status: i % 3 ? "sent" : "paid",
  notes: "A longer free-text note that repeats on every single row and bloats JSON.",
}));

describe("compressForModel", () => {
  it("leaves small outputs untouched", () => {
    const r = compressForModel("find_customers", '{"ok":true}');
    expect(r.text).toBe('{"ok":true}');
    expect(r.ccrId).toBeUndefined();
  });

  it("crushes an array of objects into a columnar digest and keeps the original retrievable", () => {
    const raw = JSON.stringify(bigRows);
    const r = compressForModel("list_invoices", raw);
    expect(r.ccrId).toBeDefined();
    // Keys written once, values still readable, syntax overhead gone.
    expect(r.text).toContain("[60 rows × 6 cols]");
    expect(r.text).toContain("INV-1050");
    expect(r.text.includes('"number"')).toBe(false);
    // Meaningful shrink even after the wire backstop.
    expect(r.text.length).toBeLessThanOrEqual(6000);
    expect(r.text.length).toBeLessThan(raw.length);
    expect(r.text).toMatch(/\[headroom\] json compressed \d+ → \d+ chars/);

    const back = headroomRetrieve(r.ccrId!) as { content: string };
    expect(JSON.parse(back.content)).toEqual(bigRows);
  });

  it("clips very wide tables to the wire limit while keeping the retrieval pointer", () => {
    const huge = JSON.stringify({
      data: Array.from({ length: 500 }, (_, i) => ({ n: i, blob: "x".repeat(200) })),
    });
    const r = compressForModel("tool", huge);
    expect(r.text.length).toBeLessThanOrEqual(6000);
    expect(r.ccrId).toBeDefined();
  });

  it("never rewrites error payloads", () => {
    const raw = JSON.stringify({
      error: "SQLSTATE 23505: duplicate key value violates unique constraint",
      detail: "Key (code)=(1234) already exists.",
      hint: "Something long enough to pass the compression threshold. ".repeat(30),
    });
    const r = compressForModel("tool", raw);
    expect(r.text).toBe(raw.slice(0, 6000));
    expect(r.ccrId).toBeUndefined();
  });

  it("collapses repeated log lines", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `2026-08-22T10:${String(i % 30).padStart(2, "0")}:00 INFO worker tick ${i < 25 ? "batch A" : "batch B"}`);
    const noisy = [...lines.slice(0, 25), ...Array(40).fill(lines[0]), ...lines.slice(25)].join("\n");
    const r = compressForModel("run_report", noisy);
    expect(r.text).toContain("×40");
    expect(r.ccrId).toBeDefined();
  });

  it("passes prose through rather than mangling it", () => {
    const essay = `The supplier agreement renews quarterly unless cancelled 60 days prior. `.repeat(
      60
    );
    const r = compressForModel("read_web_page", essay);
    expect(r.text.startsWith("The supplier agreement")).toBe(true);
  });

  it("counts savings", () => {
    compressForModel("a", JSON.stringify(bigRows));
    const s = headroomStats();
    expect(s.calls).toBe(1);
    expect(s.compressed).toBe(1);
    expect(s.wireChars).toBeLessThan(s.rawChars);
  });
});
