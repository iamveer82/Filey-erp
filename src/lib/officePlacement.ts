/* Image placement for Office work: one target model for Word, Sheets, Slides,
 * Designs, Fig and Vector.
 *
 * The apps expose their own native commands (Word insert.picture + arrange.*,
 * GridCraft insert.picture + Move Object, DeckCraft insert.picture +
 * shape.setBounds). This module turns one "place this image in this box"
 * request into the commands each app understands, and reads their layout back
 * so the agent knows where the letterhead, signature and stamp already are.
 *
 * Coordinates are app points unless a function says otherwise: Word pt,
 * Slides pt, Design/Fig/Vector document units, Sheets pixels for the picture
 * box with a cell anchor. Marked page images are mapped 1:1 at scale 1. */

export type OfficePlaceableApp = "word" | "sheet" | "slides" | "design" | "fig" | "vector";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PageGeometry {
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
}

export type Anchor =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "middle-center" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right"
  | "letterhead" | "signature" | "stamp"
  /** The whole page, behind the text: a full-page letterhead or a background. */
  | "page";

export type WrapMode =
  | "inline" | "square" | "tight" | "through" | "topAndBottom" | "behindText" | "inFrontOfText";

export type FitMode = "original" | "contain" | "cover" | "stretch";

export interface ImagePlacement {
  /** Word page (1-based) or Slides slide (1-based). */
  page?: number;
  /** Sheets anchor cell. */
  cell?: string;
  /** Existing object to move/resize instead of inserting a new one. */
  object?: string | number;
  /** Absolute box. Omit x/y to use an anchor. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  anchor?: Anchor;
  wrap?: WrapMode;
  /** Sheet picture anchoring. */
  placement?: "cell" | "overCells";
  mode?: "moveOnly" | "moveAndSize" | "absolute";
  fit?: FitMode;
  z?: "behind" | "front" | "forward" | "backward";
  rotate?: number;
  opacity?: number;
  /** Move relative to the current position (existing object only). */
  dx?: number;
  dy?: number;
  /** Word: put the picture in the page header so it repeats on every page. */
  allPages?: boolean;
}

export interface PlacedImage {
  name: string;
  data: string;
  /** Intrinsic size, used to keep the aspect ratio. */
  width?: number;
  height?: number;
  alt?: string;
  /** Per-image overrides when several images go in one call. */
  x?: number;
  y?: number;
  anchor?: Anchor;
}

export interface OfficeLayout {
  app: OfficePlaceableApp;
  page?: PageGeometry;
  text?: Box;
  objects: { id?: string | number; name?: string; kind?: string; page?: number; box?: Box; wrap?: string; selected?: boolean }[];
  suggested: Partial<Record<"letterhead" | "signature" | "stamp", Box>>;
  raw?: unknown;
}

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asBox = (value: unknown): Box | undefined => {
  if (Array.isArray(value) && value.length >= 4) {
    const [x, y, width, height] = value.map(Number);
    return [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  const x = num(o.x) ?? num(o.left);
  const y = num(o.y) ?? num(o.top);
  const width = num(o.width) ?? num(o.w);
  const height = num(o.height) ?? num(o.h);
  return x !== undefined && y !== undefined && width !== undefined && height !== undefined
    ? { x, y, width, height }
    : undefined;
};

export const A4: Size = { width: 595.28, height: 841.89 };

/** Filey's company letterhead is a full-page image. Its header and footer need the
 *  same clearance Filey's own letters give them (Letterhead.tsx DEFAULT_HEADER_SPACE /
 *  DEFAULT_FOOTER_SPACE, 150/140 px at 794 px wide = 112.5/105 pt). */
export const LETTERHEAD_CLEARANCE = { top: 112.5, bottom: 105 };

/** Where a full-page letterhead's header ends and its footer begins, as fractions of its
 *  height: the first blank band after the ink at each edge, looked for in the outer 40%.
 *  Faint watermarks don't count as ink. Undefined when there is no clear band (a tinted
 *  background), and then the defaults apply. */
export async function letterheadBands(data: string): Promise<{ top?: number; bottom?: number } | undefined> {
  try {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(data), ch => ch.charCodeAt(0))]));
    const w = 120, h = Math.max(1, Math.round(w * bitmap.height / bitmap.width));
    const ctx = new OffscreenCanvas(w, h).getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const inked = (y: number) => {
      let n = 0;
      for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (px[i + 3] > 128 && px[i] + px[i + 1] + px[i + 2] < 600) n++; }
      return n > w * 0.01;
    };
    const gap = Math.max(3, Math.round(h * 0.02));
    const edge = (from: number, step: 1 | -1) => {
      let seen = false, blank = 0;
      for (let k = 0, y = from; k < h * 0.4; k++, y += step) {
        if (inked(y)) { seen = true; blank = 0; }
        else if (seen && ++blank >= gap) return Math.abs(y - step * (gap - 1) - from) / h;
      }
      return undefined;
    };
    return { top: edge(0, 1), bottom: edge(h - 1, -1) };
  } catch { return undefined; }
}

/** Same shape as the page (portrait A4 letterhead on an A4 page), within `tolerance`. */
export function isPageShaped(image: Size, page: Size, tolerance = 0.1): boolean {
  if (!(image.width > 0 && image.height > 0)) return false;
  const want = page.height / page.width;
  return Math.abs(image.height / image.width - want) <= want * tolerance;
}

/** True when the image should cover the page behind the text, not sit in the text block.
 *  A letterhead with no known size counts: the company letterhead is a full page. */
export function coversPage(placement: ImagePlacement, natural: Size, page: Size): boolean {
  if (placement.x !== undefined || placement.y !== undefined) return false;
  if (placement.anchor === "page") return true;
  return placement.anchor === "letterhead" && (!natural.width || isPageShaped(natural, page) || isPageShaped(natural, A4));
}

/** The page's text block: the area a letter body, sign-off and stamp live in. */
export function textArea(page: PageGeometry): Box {
  return {
    x: page.margins.left,
    y: page.margins.top,
    width: Math.max(1, page.width - page.margins.left - page.margins.right),
    height: Math.max(1, page.height - page.margins.top - page.margins.bottom),
  };
}

/** Reserve room for the mark, and keep it inside the target box. */
function clampBox(box: Box, inside: Box): Box {
  const width = Math.min(Math.max(1, box.width), inside.width);
  const height = Math.min(Math.max(1, box.height), inside.height);
  return {
    width,
    height,
    x: Math.min(Math.max(inside.x, box.x), inside.x + inside.width - width),
    y: Math.min(Math.max(inside.y, box.y), inside.y + inside.height - height),
  };
}

export function anchorBox(target: Box, size: Size, anchor: Anchor): Box {
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  const left = target.x;
  const right = target.x + target.width - width;
  const center = target.x + (target.width - width) / 2;
  const top = target.y;
  const bottom = target.y + target.height - height;
  const middle = target.y + (target.height - height) / 2;
  switch (anchor) {
    case "top-left": return clampBox({ x: left, y: top, width, height }, target);
    case "top-center": return clampBox({ x: center, y: top, width, height }, target);
    case "top-right": return clampBox({ x: right, y: top, width, height }, target);
    case "middle-left": return clampBox({ x: left, y: middle, width, height }, target);
    case "middle-center": return clampBox({ x: center, y: middle, width, height }, target);
    case "middle-right": return clampBox({ x: right, y: middle, width, height }, target);
    case "bottom-left": return clampBox({ x: left, y: bottom, width, height }, target);
    case "bottom-center": return clampBox({ x: center, y: bottom, width, height }, target);
    case "bottom-right": return clampBox({ x: right, y: bottom, width, height }, target);
    // A letterhead spans the text block at the top; the body starts beneath it.
    case "letterhead": return clampBox({ x: left, y: top, width: target.width, height }, target);
    // A signature sits just above the bottom margin, on the right.
    case "signature": return clampBox({ x: right, y: bottom, width, height }, target);
    // A stamp overlaps the signature's right side, a little higher.
    case "stamp": return clampBox({ x: right, y: Math.max(top, bottom - height * 0.65), width, height }, target);
    case "page": return { x: 0, y: 0, width: target.width, height: target.height };
  }
}

/** Fit an image's natural size into a requested box without distorting it. */
export function fitSize(natural: Size, requested: { width?: number; height?: number; fit?: FitMode }): Size {
  const fit = requested.fit ?? "contain";
  const nw = Math.max(1, natural.width);
  const nh = Math.max(1, natural.height);
  if (fit === "original") {
    if (requested.width && requested.height) return { width: requested.width, height: requested.height };
    if (requested.width) return { width: requested.width, height: requested.width * nh / nw };
    if (requested.height) return { width: requested.height * nw / nh, height: requested.height };
    return { width: nw, height: nh };
  }
  if (!requested.width && !requested.height) return { width: nw, height: nh };
  if (requested.width && !requested.height) return { width: requested.width, height: requested.width * nh / nw };
  if (!requested.width && requested.height) return { width: requested.height * nw / nh, height: requested.height };
  const boxW = requested.width!;
  const boxH = requested.height!;
  if (fit === "stretch") return { width: boxW, height: boxH };
  const scale = fit === "cover" ? Math.max(boxW / nw, boxH / nh) : Math.min(boxW / nw, boxH / nh);
  return { width: nw * scale, height: nh * scale };
}

/** Map a rectangle drawn on an exported page image to page points. */
export function mapMarkedRect(rect: Box, image: Size, page: Size): Box {
  const sx = page.width / Math.max(1, image.width);
  const sy = page.height / Math.max(1, image.height);
  return {
    x: rect.x * sx,
    y: rect.y * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  };
}

/** Resolve the box for one image: marked target > absolute x/y > anchor. */
export function placementBox(
  placement: ImagePlacement,
  natural: Size,
  page: PageGeometry,
  marked?: Box,
): Box {
  const text = textArea(page);
  const size = fitSize(natural, placement);
  if (marked) return clampBox(marked, { x: 0, y: 0, width: page.width, height: page.height });
  if (placement.x !== undefined && placement.y !== undefined) {
    const width = placement.width ?? size.width;
    const height = placement.height ?? size.height;
    return clampBox({ x: placement.x, y: placement.y, width, height }, { x: 0, y: 0, width: page.width, height: page.height });
  }
  // A full-page letterhead covers the page edge to edge; it never shrinks into the margins.
  if (coversPage(placement, natural, page)) return { x: 0, y: 0, width: page.width, height: page.height };
  const anchor = placement.anchor ?? "top-left";
  const target = anchor === "letterhead" || anchor === "signature" || anchor === "stamp" ? text : { x: 0, y: 0, width: page.width, height: page.height };
  if (anchor === "letterhead" && placement.width === undefined && natural.width > 0) {
    const width = text.width;
    const height = placement.height ?? width * natural.height / natural.width;
    return anchorBox(text, { width, height }, anchor);
  }
  return anchorBox(target, { width: placement.width ?? size.width, height: placement.height ?? size.height }, anchor);
}

/** Word's layout.pageSetup takes points as pageW/pageH. Models send Word's names
 *  (pageSize "A4", pageWidth) that the engine ignores without an error, or twips
 *  (A4 = 11906 × 16838), which made a page four metres wide. Word's largest page is
 *  22 in = 1584 pt, so any bigger page size is twips. */
export function wordPageSetup(section: Record<string, unknown>): Record<string, unknown> {
  const s = { ...section };
  const named = ({ a4: A4, letter: { width: 612, height: 792 }, legal: { width: 612, height: 1008 } } as Record<string, Size>)[String(s.pageSize ?? "").toLowerCase()];
  s.pageW ??= s.pageWidth ?? s.width ?? named?.width;
  s.pageH ??= s.pageHeight ?? s.height ?? named?.height;
  for (const k of ["pageSize", "pageWidth", "pageHeight", "width", "height"]) delete s[k];
  if (Number(s.pageW) > 1584 || Number(s.pageH) > 1584) {
    for (const k of ["pageW", "pageH", "marginTop", "marginBottom", "marginLeft", "marginRight", "header", "footer", "gutter"])
      if (typeof s[k] === "number") s[k] = (s[k] as number) / 20;
  }
  return s;
}

function pageFrom(value: unknown): PageGeometry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  const width = num(o.width) ?? num(o.pageW) ?? num(o.w);
  const height = num(o.height) ?? num(o.pageH) ?? num(o.h);
  if (!width || !height) return undefined;
  const margins = (o.margins && typeof o.margins === "object" ? o.margins : o) as Record<string, unknown>;
  return {
    width,
    height,
    margins: {
      top: num(margins.top) ?? num(margins.marginTop) ?? 72,
      right: num(margins.right) ?? num(margins.marginRight) ?? 72,
      bottom: num(margins.bottom) ?? num(margins.marginBottom) ?? 72,
      left: num(margins.left) ?? num(margins.marginLeft) ?? 72,
    },
  };
}

function objectsFrom(value: unknown, depth = 0): OfficeLayout["objects"] {
  if (!value || depth > 4) return [];
  const out: OfficeLayout["objects"] = [];
  const visit = (node: unknown, level: number) => {
    if (!node || typeof node !== "object" || level > 4) return;
    if (Array.isArray(node)) { node.forEach(child => visit(child, level)); return; }
    const o = node as Record<string, unknown>;
    const kind = String(o.kind ?? o.type ?? "").toLowerCase();
    // Word pictures give their size as w/h and their offset under `float`.
    const float = o.float && typeof o.float === "object" ? o.float as Record<string, unknown> : undefined;
    const box = asBox(o.box) ?? asBox(o.bounds) ?? asBox(o.frame) ?? asBox(o.rect) ?? asBox(o)
      ?? (float ? asBox({ x: num(float.x) ?? 0, y: num(float.y) ?? 0, width: o.w, height: o.h }) : undefined);
    if (box && /(image|picture|graphic|shape|frame|object)/.test(kind || "object")) {
      out.push({
        id: typeof o.id === "string" || typeof o.id === "number" ? o.id
          : typeof o.index === "number" || typeof o.index === "string" ? o.index : undefined,
        // Word pictures carry no name, only their alt text ("Letterhead").
        name: typeof o.name === "string" ? o.name : typeof o.alt === "string" ? o.alt : undefined,
        kind: kind || "object",
        page: num(o.page),
        box,
        wrap: typeof o.wrap === "string" ? o.wrap : undefined,
        selected: o.selected === true,
      });
    }
    for (const [key, child] of Object.entries(o)) {
      if (key === "box" || key === "bounds" || key === "frame" || key === "rect") continue;
      if (child && typeof child === "object") visit(child, level + 1);
    }
  };
  visit(value, depth);
  return out;
}

function suggestedFrom(page: PageGeometry, objects: OfficeLayout["objects"]): OfficeLayout["suggested"] {
  const text = textArea(page);
  const letterhead = objects.find(o => /letterhead/i.test(o.name ?? ""))?.box
    ?? anchorBox(text, { width: text.width, height: Math.min(90, text.height * 0.16) }, "letterhead");
  const signature = objects.find(o => /sign|signature/i.test(o.name ?? ""))?.box
    ?? anchorBox(text, { width: 120, height: 42 }, "signature");
  const stamp = objects.find(o => /stamp|seal/i.test(o.name ?? ""))?.box
    ?? anchorBox(text, { width: 110, height: 110 }, "stamp");
  return { letterhead, signature, stamp };
}

function replyResult(reply: { ok: boolean; result?: unknown }): unknown {
  return reply.ok ? reply.result : undefined;
}

function command(reply: { ok: boolean; result?: unknown }): unknown {
  const result = replyResult(reply) as Record<string, unknown> | undefined;
  return result?.value ?? result;
}

/** Read the native app's own layout and objects. */
export async function readOfficeLayout(
  app: OfficePlaceableApp,
  control: (method: string, params?: unknown) => Promise<{ ok: boolean; result?: unknown; error?: string }>,
): Promise<OfficeLayout> {
  const execute = async (name: string, params: unknown = {}) => command(await control("engine.execute", { command: name, params }));
  if (app === "word") {
    const [inspect, layout] = await Promise.all([
      // text:true makes the paragraph tree (and therefore its picture objects) available;
      // the full text is not returned to the model, only the objects and page geometry.
      execute("document.inspect", { text: true }).catch(() => undefined),
      execute("document.layout").catch(() => undefined),
    ]);
    const page = pageFrom(layout) ?? pageFrom((inspect as Record<string, unknown> | undefined)?.layout) ?? pageFrom(inspect);
    const objects = objectsFrom(inspect);
    return {
      app, page, text: page ? textArea(page) : undefined, objects,
      suggested: page ? suggestedFrom(page, objects) : {},
      raw: { inspect: inspect ? { objects: objects.slice(0, 50) } : undefined, layout },
    };
  }
  if (app === "sheet") {
    const inspect = await execute("document.inspect").catch(() => undefined);
    const sheet = (inspect as Record<string, unknown> | undefined)?.sheets;
    const first = Array.isArray(sheet) ? sheet[0] : sheet;
    const objects = objectsFrom(first);
    return { app, objects, suggested: {}, raw: inspect };
  }
  if (app === "slides") {
    const [inspect, slide] = await Promise.all([
      execute("document.inspect").catch(() => undefined),
      execute("slide.inspect", {}).catch(() => undefined),
    ]);
    const page = pageFrom((inspect as Record<string, unknown> | undefined)?.size) ?? pageFrom(inspect);
    const objects = objectsFrom(slide);
    return { app, page, text: page ? textArea(page) : undefined, objects, suggested: page ? suggestedFrom(page, objects) : {}, raw: { inspect, slide } };
  }
  const inspect = await execute("document.inspect").catch(() => undefined);
  const page = pageFrom(inspect);
  const objects = objectsFrom(inspect);
  return { app, page, text: page ? textArea(page) : undefined, objects, suggested: page ? suggestedFrom(page, objects) : {}, raw: inspect };
}

function existingObjectId(layout: OfficeLayout | undefined, wanted: string | number | undefined): string | number | undefined {
  if (wanted === undefined || wanted === null) return undefined;
  if (typeof wanted === "number") return layout?.objects[wanted]?.id ?? wanted;
  const hit = layout?.objects.find(o => String(o.id) === String(wanted) || String(o.name ?? "").toLowerCase() === String(wanted).toLowerCase());
  return hit?.id ?? wanted;
}

async function applyWordStyle(
  control: (method: string, params?: unknown) => Promise<{ ok: boolean }>,
  box: Box | undefined,
  placement: ImagePlacement,
) {
  const execute = (name: string, params: unknown = {}) => control("engine.execute", { command: name, params });
  if (box) {
    // An inline object floats on the first arrange.bounds; that is how a
    // letterhead/stamp becomes an overlay at an exact page point.
    await execute("arrange.bounds", { x: box.x, y: box.y, width: box.width, height: box.height, ...(placement.page ? { page: placement.page - 1 } : {}) });
  }
  if (placement.wrap) await execute("arrange.wrap", { wrap: placement.wrap });
  if (placement.z === "behind") await execute("arrange.sendBackward");
  else if (placement.z === "front") await execute("arrange.bringForward");
  else if (placement.z === "backward") await execute("arrange.sendBackward");
  else if (placement.z === "forward") await execute("arrange.bringForward");
  if (placement.rotate !== undefined) await execute("arrange.rotate", { angle: placement.rotate });
  if (placement.opacity !== undefined) await execute("picture.transparency", { percent: Math.round(Math.max(0, Math.min(1, placement.opacity)) * 100) });
}

/** Insert or move one or many images in the app's own native commands. */
export async function placeOfficeImages(
  app: OfficePlaceableApp,
  control: (method: string, params?: unknown) => Promise<{ ok: boolean; result?: unknown; error?: string }>,
  images: PlacedImage[],
  placement: ImagePlacement,
  layout?: OfficeLayout,
): Promise<{ ok: boolean; placed: { name: string; box?: Box }[]; error?: string; hint?: string }> {
  const execute = (name: string, params: unknown = {}) => control("engine.execute", { command: name, params });
  const page = layout?.page ?? (app === "word" || app === "slides"
    ? { width: 595, height: 842, margins: { top: 72, right: 72, bottom: 72, left: 72 } }
    : { width: 100_000, height: 100_000, margins: { top: 0, right: 0, bottom: 0, left: 0 } });
  const placed: { name: string; box?: Box }[] = [];
  const objectId = existingObjectId(layout, placement.object);
  const existing = layout?.objects.find(o => objectId !== undefined && String(o.id) === String(objectId));
  const existingBox = existing?.box;
  const moveSize = {
    width: placement.width ?? existingBox?.width ?? 120,
    height: placement.height ?? existingBox?.height ?? 120,
  };
  const moveTarget = placement.x !== undefined || placement.y !== undefined
    ? placementBox({ ...placement, width: moveSize.width, height: moveSize.height }, moveSize, page)
    : existingBox;
  const wordIndex = typeof objectId === "number" ? objectId
    : objectId !== undefined && Number.isFinite(Number(objectId)) ? Number(objectId)
    : objectId !== undefined ? layout?.objects.findIndex(o => String(o.name ?? "").toLowerCase() === String(objectId).toLowerCase()) : undefined;

  // A full-page letterhead in Word, the way a person does it: page to the letterhead's
  // shape (A4), body margins clear its header/footer, picture stretched to the page
  // corner, Wrap Text › Behind Text, Fix Position on Page.
  // ponytail: a Letter-shaped image on an A4 page stretches ~8%; add Letter when US users need it.
  const coverWordPage = async (natural: Size, data?: string) => {
    const shape = !natural.width || isPageShaped(natural, A4, 0.03) ? A4 : page;
    // The body starts a line below the letterhead's own header and stops above its footer.
    const bands = data ? await letterheadBands(data) : undefined;
    const pad = 14;
    const top = Math.max(page.margins.top, bands?.top ? bands.top * shape.height + pad : LETTERHEAD_CLEARANCE.top);
    const bottom = Math.max(page.margins.bottom, bands?.bottom ? bands.bottom * shape.height + pad : LETTERHEAD_CLEARANCE.bottom);
    await execute("layout.pageSetup", { section: { pageW: shape.width, pageH: shape.height, marginTop: top, marginBottom: bottom } });
    return { x: 0, y: 0, width: shape.width, height: shape.height };
  };
  const behindOnPage = (p: ImagePlacement): ImagePlacement => ({ ...p, anchor: "page", wrap: "behindText", z: "behind" });

  // Move-only: no new image, just place the existing signature/stamp/logo.
  if (objectId !== undefined && images.length === 0) {
    if (app === "word") {
      if (placement.allPages) return { ok: false, placed, error: "A picture in the page cannot be moved into the header. Insert it again with all_pages (insert_letterhead all_pages:true, or place_image images + all_pages); the page-1 letterhead is removed for you." };
      if (wordIndex === undefined || wordIndex < 0) return { ok: false, placed, error: "Use the numeric object index from layout for a Word picture." };
      if (coversPage(placement, existingBox ?? { width: 0, height: 0 }, page)) {
        const box = await coverWordPage(existingBox ?? { width: 0, height: 0 });
        await execute("select.objects", { index: wordIndex });
        await applyWordStyle(control, box, behindOnPage(placement));
        await execute("arrange.moveWithText", { value: false });
        await execute("select.collapse", { end: true });
        return { ok: true, placed: [{ name: String(placement.object), box }] };
      }
      await execute("select.objects", { index: wordIndex });
      await applyWordStyle(control, moveTarget, placement);
      await execute("select.collapse", { end: true });
    } else if (app === "sheet") {
      const moved = await execute("object.move", {
        kind: "image", id: objectId,
        ...(placement.cell ? { at: placement.cell } : {}),
        ...(placement.dx !== undefined ? { dx: placement.dx } : {}),
        ...(placement.dy !== undefined ? { dy: placement.dy } : {}),
        ...(placement.width !== undefined ? { width: placement.width } : {}),
        ...(placement.height !== undefined ? { height: placement.height } : {}),
      });
      if (!moved.ok) return { ok: false, placed, error: moved.error || "The picture could not be moved." };
      if (placement.mode) await execute("object.setAnchorMode", { kind: "image", id: objectId, mode: placement.mode });
      if (placement.z === "front") await execute("arrange.bringForward", { kind: "image", id: objectId, toFront: true });
      else if (placement.z === "behind") await execute("arrange.sendBackward", { kind: "image", id: objectId, toBack: true });
    } else if (app === "slides" && moveTarget) {
      if (placement.page) await execute("slide.go", { index: placement.page - 1 });
      const moved = await execute("shape.setBounds", { id: objectId, x: moveTarget.x, y: moveTarget.y, w: moveTarget.width, h: moveTarget.height });
      if (!moved.ok) return { ok: false, placed, error: moved.error || "The picture could not be moved." };
    } else if ((app === "design" || app === "vector" || app === "fig") && moveTarget) {
      const moved = await execute("object.setBounds", { id: objectId, x: moveTarget.x, y: moveTarget.y, width: moveTarget.width, height: moveTarget.height });
      if (!moved.ok) return { ok: false, placed, error: moved.error || "The object could not be moved." };
    } else {
      return { ok: false, placed, error: "Give x/y or a cell for the object you want to move." };
    }
    return { ok: true, placed: [{ name: String(placement.object), box: moveTarget }] };
  }

  if (app === "word") {
    for (const image of images) {
      const natural = { width: image.width ?? 0, height: image.height ?? 0 };
      const p = { ...placement, x: image.x ?? placement.x, y: image.y ?? placement.y, anchor: image.anchor ?? placement.anchor };
      if (objectId === undefined && coversPage(p, natural, page)) {
        const box = await coverWordPage(natural, image.data);
        if (p.allPages) {
          // Every page: the letterhead lives in the page header. A page-1 copy from an
          // earlier insert goes, last first so the earlier indexes stay put.
          const old = (layout?.objects ?? []).map((o, i) => /letterhead/i.test(o.name ?? "") ? i : -1).filter(i => i >= 0).reverse();
          for (const index of old) { await execute("select.objects", { index }); await execute("text.delete"); }
          await execute("insert.createHeader", { page: (p.page ?? 1) - 1 });
        }
        // Anchored in the first paragraph, so it belongs to page 1 (or the page asked for).
        else if (p.page) await execute("caret.set", { page: p.page - 1, x: 0, y: 0 });
        else { await execute("select.all"); await execute("select.collapse", { end: false }); }
        // insert.picture caps the width at the text block; arrange.bounds then sets the full page.
        const reply = await execute("insert.picture", { data: image.data, width: box.width, alt: image.alt ?? image.name });
        if (!reply.ok) return { ok: false, placed, error: reply.error || `${image.name} could not be inserted.` };
        await applyWordStyle(control, box, behindOnPage(p));
        await execute("arrange.moveWithText", { value: false });
        // Back to the body, caret at its start, so typing goes into the letter.
        if (p.allPages) await execute("insert.closeHeader");
        placed.push({ name: image.name, box });
        continue;
      }
      const box = placementBox(p, natural, page);
      if (objectId !== undefined && images.length === 1) {
        if (wordIndex === undefined || wordIndex < 0) return { ok: false, placed, error: "Use the numeric object index from layout for a Word picture." };
        await execute("select.objects", { index: wordIndex });
        await applyWordStyle(control, box, p);
        placed.push({ name: image.name, box });
        continue;
      }
      if (p.page || p.x !== undefined || p.y !== undefined) {
        const caret = p.page ? { page: p.page - 1, x: box.x, y: box.y } : { page: 0, x: box.x, y: box.y };
        await execute("caret.set", caret);
      }
      const reply = await execute("insert.picture", { data: image.data, width: box.width, alt: image.alt ?? image.name });
      if (!reply.ok) return { ok: false, placed, error: reply.error || `${image.name} could not be inserted.` };
      await applyWordStyle(control, box, p);
      placed.push({ name: image.name, box });
    }
    // A placed picture stays selected, and the next text.insert would replace it.
    await execute("select.collapse", { end: true });
    return { ok: true, placed };
  }

  if (app === "sheet") {
    for (const image of images) {
      const natural = { width: image.width ?? 0, height: image.height ?? 0 };
      const p = { ...placement, x: image.x ?? placement.x, y: image.y ?? placement.y, anchor: image.anchor ?? placement.anchor };
      const box = placementBox(p, natural, page);
      const reply = await execute("insert.picture", {
        base64: image.data,
        alt: image.alt ?? image.name,
        at: p.cell ?? "A1",
        width: Math.round(box.width),
        height: Math.round(box.height),
        placement: p.placement ?? "overCells",
        mode: p.mode ?? "absolute",
      });
      if (!reply.ok) return { ok: false, placed, error: reply.error || `${image.name} could not be inserted.` };
      const result = replyResult(reply) as Record<string, unknown> | undefined;
      const id = result?.id ?? result?.image ?? result?.object;
      if (id !== undefined && (p.x !== undefined || p.y !== undefined || p.dx !== undefined || p.dy !== undefined)) {
        await execute("object.move", { kind: "image", id, dx: p.x ?? p.dx ?? 0, dy: p.y ?? p.dy ?? 0, width: Math.round(box.width), height: Math.round(box.height) });
      }
      if (id !== undefined && p.z === "front") await execute("arrange.bringForward", { kind: "image", id, toFront: true });
      else if (id !== undefined && p.z === "behind") await execute("arrange.sendBackward", { kind: "image", id, toBack: true });
      placed.push({ name: image.name, box });
    }
    return { ok: true, placed };
  }

  if (app === "slides") {
    if (placement.page) await execute("slide.go", { index: placement.page - 1 });
    for (const image of images) {
      const natural = { width: image.width ?? 0, height: image.height ?? 0 };
      const p = { ...placement, x: image.x ?? placement.x, y: image.y ?? placement.y, anchor: image.anchor ?? placement.anchor };
      const box = placementBox(p, natural, page);
      if (objectId !== undefined && images.length === 1) {
        const moved = await execute("shape.setBounds", { id: objectId, x: box.x, y: box.y, w: box.width, h: box.height });
        if (!moved.ok) return { ok: false, placed, error: moved.error || "The picture could not be moved." };
        placed.push({ name: image.name, box });
        continue;
      }
      let reply = await execute("insert.picture", { data: image.data, x: box.x, y: box.y, w: box.width, h: box.height });
      if (!reply.ok) {
        reply = await execute("insert.picture", { data: image.data, frame: { x: box.x, y: box.y, w: box.width, h: box.height } });
      }
      if (!reply.ok) return { ok: false, placed, error: reply.error || `${image.name} could not be inserted.` };
      placed.push({ name: image.name, box });
    }
    return { ok: true, placed };
  }

  if (app === "design") {
    for (const image of images) {
      const natural = { width: image.width ?? 0, height: image.height ?? 0 };
      const p = { ...placement, x: image.x ?? placement.x, y: image.y ?? placement.y, anchor: image.anchor ?? placement.anchor };
      const box = placementBox(p, natural, page);
      let reply = await execute("file.place", { base64: image.data, name: image.name, rect: [box.x, box.y, box.width, box.height], ...(p.page ? { page: p.page - 1 } : {}) });
      if (!reply.ok) {
        reply = await execute("frame.create", { rect: [box.x, box.y, box.width, box.height], content: "image", base64: image.data, name: image.name });
      }
      if (!reply.ok) return { ok: false, placed, error: reply.error || `${image.name} could not be placed.` };
      placed.push({ name: image.name, box });
    }
    return { ok: true, placed };
  }

  if (app === "fig") {
    for (const image of images) {
      const natural = { width: image.width ?? 0, height: image.height ?? 0 };
      const p = { ...placement, x: image.x ?? placement.x, y: image.y ?? placement.y, anchor: image.anchor ?? placement.anchor };
      const box = placementBox(p, natural, page);
      let reply = await execute("file.placeImage", { data: image.data, name: image.name, x: box.x, y: box.y, width: box.width, height: box.height });
      if (!reply.ok) {
        reply = await execute("image.place", { data: image.data, name: image.name, x: box.x, y: box.y, width: box.width, height: box.height });
      }
      if (!reply.ok) {
        reply = await execute("file.place", { base64: image.data, name: image.name, x: box.x, y: box.y, width: box.width, height: box.height });
      }
      if (!reply.ok) return { ok: false, placed, error: reply.error || `${image.name} could not be placed.` };
      placed.push({ name: image.name, box });
    }
    return { ok: true, placed };
  }

  for (const image of images) {
    const natural = { width: image.width ?? 0, height: image.height ?? 0 };
    const p = { ...placement, x: image.x ?? placement.x, y: image.y ?? placement.y, anchor: image.anchor ?? placement.anchor };
    const box = placementBox(p, natural, page);
    const reply = await execute("file.place", { files: [{ name: image.name, dataBase64: image.data }], rect: [box.x, box.y, box.width, box.height] });
    if (!reply.ok) return { ok: false, placed, error: reply.error || `${image.name} could not be placed.` };
    placed.push({ name: image.name, box });
  }
  return { ok: true, placed };
}
