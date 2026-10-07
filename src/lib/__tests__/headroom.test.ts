import { beforeEach, describe, expect, it } from "vitest";
import { prepareCreditRequest } from "../../../supabase/functions/_shared/ai-credits";
import {
  compressForModel,
  headroomRetrieve,
  headroomReset,
  headroomStats,
  retainToolOutput,
} from "../headroom";

beforeEach(() => {
  localStorage.clear();
  headroomReset();
});

it("retrieves the exact earlier observation after shortening it", () => {
  const original = JSON.stringify({ rows: "x".repeat(900), invoice_id: "important-tail-id" });
  const archived = retainToolOutput(original);
  expect(archived.text.length).toBeLessThan(400);
  expect(archived.text).not.toContain("important-tail-id");
  expect(headroomRetrieve(archived.ccrId!)).toMatchObject({ content: original });
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

    let offset: number | null = 0, restored = "";
    while (offset !== null) {
      const page = headroomRetrieve(r.ccrId!, offset) as { content: string; next_offset: number | null };
      expect(page.content.length).toBeLessThanOrEqual(6000);
      restored += page.content;
      offset = page.next_offset;
    }
    expect(JSON.parse(restored)).toEqual(bigRows);
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

it("bounds a large catalogue retrieval and keeps every character reachable", () => {
  const original = 'Catalogue row: "quoted" \n 中文 😀 '.repeat(2500);
  const stored = retainToolOutput(original);
  let offset: number | null = 0, restored = "";
  while (offset !== null) {
    const page = headroomRetrieve(stored.ccrId!, offset) as { content: string; next_offset: number | null };
    expect(page.content.length).toBeLessThanOrEqual(6000);
    expect(JSON.stringify(page).length).toBeLessThan(15000);
    restored += page.content;
    offset = page.next_offset;
  }
  expect(restored).toBe(original);
  // The failed production request restored a 70 KB catalogue after its image
  // was removed. Exercise the same server-side size guard, not a guessed limit.
  const model = { id: "filey-ai", name: "Filey AI", input: 0.0000005, output: 0.000002,
    context: 131072, maxOutput: 8192, vision: true };
  const request = (content: string) => ({ max_tokens: 2048, messages: [
    { role: "user", content: "Read the relevant catalogue entry." },
    { role: "tool", tool_call_id: "catalogue", content },
  ] });
  expect(() => prepareCreditRequest(request(original), model)).toThrow("conversation is too large");
  expect(() => prepareCreditRequest(request(JSON.stringify(headroomRetrieve(stored.ccrId!))), model)).not.toThrow();
  expect(headroomRetrieve(stored.ccrId!, 0, 200000)).toHaveProperty("error");
  expect(headroomRetrieve(stored.ccrId!, -1)).toHaveProperty("error");
  expect(headroomRetrieve(stored.ccrId!, original.length + 1)).toHaveProperty("error");
});
