import { describe, expect, it } from "vitest";
import {
  A4, anchorBox, coversPage, fitSize, isPageShaped, mapMarkedRect, placementBox, placeOfficeImages, readOfficeLayout, wordPageSetup,
  type ImagePlacement, type OfficeLayout, type PageGeometry,
} from "../officePlacement";

const page: PageGeometry = {
  width: 595,
  height: 842,
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
};
const text = { x: 72, y: 72, width: 451, height: 698 };

describe("office placement geometry", () => {
  it("puts a signature at the bottom-right and a letterhead across the text block", () => {
    expect(anchorBox(text, { width: 120, height: 40 }, "signature")).toEqual({ x: 403, y: 730, width: 120, height: 40 });
    expect(anchorBox(text, { width: 451, height: 60 }, "letterhead")).toEqual({ x: 72, y: 72, width: 451, height: 60 });
    // A stamp sits over the signature, not at the page edge.
    expect(anchorBox(text, { width: 110, height: 110 }, "stamp").y).toBeLessThan(730);
  });

  it("keeps an image's aspect ratio unless stretch is explicit", () => {
    expect(fitSize({ width: 400, height: 200 }, { width: 200, fit: "contain" })).toEqual({ width: 200, height: 100 });
    expect(fitSize({ width: 400, height: 200 }, { width: 200, height: 200, fit: "cover" })).toEqual({ width: 400, height: 200 });
    expect(fitSize({ width: 400, height: 200 }, { width: 200, height: 200, fit: "stretch" })).toEqual({ width: 200, height: 200 });
  });

  it("maps a circled page-image rectangle back to page points", () => {
    expect(mapMarkedRect({ x: 100, y: 200, width: 300, height: 100 }, { width: 1190, height: 1684 }, page))
      .toEqual({ x: 50, y: 100, width: 150, height: 50 });
  });

  it("honours a marked target over an anchor", () => {
    const marked = { x: 300, y: 500, width: 120, height: 40 };
    const placement: ImagePlacement = { anchor: "signature" };
    expect(placementBox(placement, { width: 400, height: 200 }, page, marked)).toEqual(marked);
  });
});

describe("office placement commands", () => {
  const fake = () => {
    const calls: { method: string; command?: string; params?: Record<string, unknown> }[] = [];
    const control = async (method: string, params?: unknown) => {
      calls.push({ method, command: (params as { command?: string } | undefined)?.command, params: (params as { params?: Record<string, unknown> } | undefined)?.params });
      return { ok: true, result: { id: "img-1" } };
    };
    return { calls, control };
  };
  const layout: OfficeLayout = { app: "word", page, text, objects: [], suggested: {} };
  const images = [
    { name: "signature.png", data: "c2ln", width: 400, height: 200 },
    { name: "stamp.png", data: "c3RhbXA=", width: 300, height: 300 },
  ];

  it("inserts more than one Word image and applies its own wrap and box", async () => {
    const { calls, control } = fake();
    const result = await placeOfficeImages("word", control, images, { anchor: "signature", width: 120, wrap: "inFrontOfText" }, layout);
    expect(result.ok).toBe(true);
    expect(result.placed.map(p => p.name)).toEqual(["signature.png", "stamp.png"]);
    expect(calls.filter(c => c.command === "insert.picture")).toHaveLength(2);
    expect(calls.filter(c => c.command === "arrange.bounds")).toHaveLength(2);
    expect(calls.filter(c => c.command === "arrange.wrap")).toHaveLength(2);
  });

  it("anchors each Sheets image to its cell", async () => {
    const { calls, control } = fake();
    const result = await placeOfficeImages("sheet", control, [images[0]], { cell: "H1", placement: "overCells", mode: "absolute" }, { app: "sheet", objects: [], suggested: {} });
    expect(result.ok).toBe(true);
    const insert = calls.find(c => c.command === "insert.picture");
    expect(insert?.params).toMatchObject({ at: "H1", placement: "overCells", mode: "absolute" });
  });

  it("moves an existing Slides picture instead of inserting another", async () => {
    const { calls, control } = fake();
    const result = await placeOfficeImages("slides", control, [images[0]], { object: "shape-7", x: 100, y: 120, width: 120 }, { app: "slides", page, objects: [], suggested: {} });
    expect(result.ok).toBe(true);
    const move = calls.find(c => c.command === "shape.setBounds");
    expect(move?.params).toMatchObject({ id: "shape-7", x: 100, y: 120 });
    expect(calls.some(c => c.command === "insert.picture")).toBe(false);
  });

  it("moves an existing Word picture without inserting a new one", async () => {
    const { calls, control } = fake();
    const result = await placeOfficeImages("word", control, [], { object: 3, x: 120, y: 200, width: 100 }, {
      app: "word", page, objects: [{ id: 3, name: "stamp.png", box: { x: 400, y: 700, width: 90, height: 90 } }], suggested: {},
    });
    expect(result.ok).toBe(true);
    expect(calls.find(c => c.command === "select.objects")?.params).toMatchObject({ index: 3 });
    expect(calls.find(c => c.command === "arrange.bounds")?.params).toMatchObject({ x: 120, y: 200, width: 100 });
    expect(calls.some(c => c.command === "insert.picture")).toBe(false);
  });

  // The owner asked for the letterhead "A4 and behind the text": the agent got a 451 pt
  // inline picture inside the margins, then set the page to 11906 × 16838 (twips as points).
  const letterPage: PageGeometry = { width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 } };
  const a4Letterhead = { name: "letterhead.jpg", data: "bGg=", width: 1240, height: 1754 };

  it("covers the page with a full-page letterhead, behind the text, fixed on the page", async () => {
    const { calls, control } = fake();
    const result = await placeOfficeImages("word", control, [a4Letterhead], { anchor: "letterhead", width: 451, wrap: "inline" }, { app: "word", page: letterPage, objects: [], suggested: {} });
    expect(result.ok).toBe(true);
    expect(calls.map(c => c.command)).toEqual([
      "layout.pageSetup", "select.all", "select.collapse", "insert.picture",
      "arrange.bounds", "arrange.wrap", "arrange.sendBackward", "arrange.moveWithText", "select.collapse",
    ]);
    expect(calls[0].params).toEqual({ section: { pageW: 595.28, pageH: 841.89, marginTop: 112.5, marginBottom: 105 } });
    expect(calls.find(c => c.command === "arrange.bounds")?.params).toEqual({ x: 0, y: 0, width: 595.28, height: 841.89 });
    expect(calls.find(c => c.command === "arrange.wrap")?.params).toEqual({ wrap: "behindText" });
    expect(calls.find(c => c.command === "arrange.moveWithText")?.params).toEqual({ value: false });
  });

  it("fixes a letterhead already in the document onto the whole page", async () => {
    const { calls, control } = fake();
    const result = await placeOfficeImages("word", control, [], { object: 0, anchor: "page" }, {
      app: "word", page, objects: [{ id: 0, name: "letterhead", box: { x: 72, y: 72, width: 451, height: 631.4 } }], suggested: {},
    });
    expect(result.ok).toBe(true);
    expect(calls.find(c => c.command === "arrange.bounds")?.params).toEqual({ x: 0, y: 0, width: 595.28, height: 841.89 });
    expect(calls.find(c => c.command === "arrange.wrap")?.params).toEqual({ wrap: "behindText" });
    expect(calls.some(c => c.command === "insert.picture")).toBe(false);
  });

  it("puts the letterhead in the page header for every page, replacing a page-1 copy", async () => {
    const { calls, control } = fake();
    const result = await placeOfficeImages("word", control, [a4Letterhead], { anchor: "letterhead", allPages: true }, {
      app: "word", page, suggested: {},
      objects: [{ id: 0, name: "stamp" }, { id: 1, name: "Letterhead", box: { x: 0, y: 0, width: 595, height: 842 } }],
    });
    expect(result.ok).toBe(true);
    expect(calls.map(c => c.command)).toEqual([
      "layout.pageSetup", "select.objects", "text.delete", "insert.createHeader", "insert.picture",
      "arrange.bounds", "arrange.wrap", "arrange.sendBackward", "arrange.moveWithText", "insert.closeHeader", "select.collapse",
    ]);
    // Only the old letterhead goes, never the stamp.
    expect(calls.find(c => c.command === "select.objects")?.params).toEqual({ index: 1 });
    expect(calls.find(c => c.command === "insert.createHeader")?.params).toEqual({ page: 0 });
  });

  it("reads Word pictures, which report w/h and a float offset, into the layout", async () => {
    const inspect = { blocks: [{ type: "paragraph", text: "", objects: [{ alt: "Letterhead", type: "image", w: 451, h: 631.4, float: { x: 0, y: 0, wrap: "inline" } }] }] };
    const control = async (_method: string, params?: unknown) =>
      ({ ok: true, result: (params as { command?: string }).command === "document.inspect" ? inspect : { pages: [] } });
    const layout = await readOfficeLayout("word", control);
    expect(layout.objects.map(o => [o.name, o.box?.width])).toEqual([["Letterhead", 451]]);
  });

  it("keeps a banner letterhead across the top of the text block", () => {
    expect(placementBox({ anchor: "letterhead" }, { width: 2000, height: 300 }, page)).toEqual({ x: 72, y: 72, width: 451, height: 67.65 });
    expect(coversPage({ anchor: "letterhead" }, { width: 2000, height: 300 }, page)).toBe(false);
    expect(isPageShaped({ width: 451, height: 631.4 }, A4)).toBe(true);
  });
});

describe("Word page setup", () => {
  it("reads twips and Word's own names as points", () => {
    expect(wordPageSetup({ pageW: 11906, pageH: 16838, marginTop: 1440 })).toEqual({ pageW: 595.3, pageH: 841.9, marginTop: 72 });
    expect(wordPageSetup({ pageSize: "A4", pageWidth: 595.28, pageHeight: 841.89 })).toEqual({ pageW: 595.28, pageH: 841.89 });
    expect(wordPageSetup({ pageSize: "a4" })).toEqual({ pageW: 595.28, pageH: 841.89 });
    expect(wordPageSetup({ pageW: 612, pageH: 792, marginTop: 36 })).toEqual({ pageW: 612, pageH: 792, marginTop: 36 });
  });
});
