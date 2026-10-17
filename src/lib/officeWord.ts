/* Bridge between Filey and the app tabs in Office work. Each tab is an iframe
 * running a Craft app's web build (Apache-2.0/MIT, github.com/storytold), rebuilt
 * with a small control bridge (scripts/<app>/filey-control.patch) that exposes
 * the app's own control protocol: Word = WordCraft, Sheets = GridCraft,
 * PDF = PdfCraft. The agent's `word`, `sheet` and `pdf` tools go through here. */

import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeDocFile } from "./localPaths";
import { notifyDataChanged } from "./realtime";

export type OfficeApp = "word" | "sheet" | "pdf";

/** Each app's bundle (public/<dir>, scripts/fetch-office-apps.mjs) and the bridge its patch adds. */
export const OFFICE_APPS: Record<OfficeApp, { label: string; src: string; title: string; control: string; open?: string; files: RegExp }> = {
  word: { label: "Word", src: "/wordcraft/index.html", title: "WordCraft", control: "wordcraftControl", open: "wordcraftOpen", files: /\.(docx|odt|rtf)$/i },
  sheet: { label: "Sheets", src: "/gridcraft/index.html", title: "Sheets", control: "gridcraftControl", open: "gridcraftOpen", files: /\.(xlsx|xlsm|xlsb|xls|ods|csv|tsv)$/i },
  // PDF takes files in and hands saves back through PdfCraft's own `?host=parent` bridge.
  pdf: { label: "PDF", src: "/pdfcraft/index.html?host=parent", title: "PDF", control: "pdfcraftControl", files: /\.pdf$/i },
};

export type OfficeWindow = Window & {
  /** Frames the app asked for while the window was hidden (boot shim in fetch-office-apps.mjs). */
  fileyRunFrames?: () => void;
} & Record<string, unknown>;
export interface OfficeReply { ok: boolean; result?: unknown; error?: string }

const frames = new Map<string, { app: OfficeApp; win: OfficeWindow }>(); // tab id → its window, in opening order
const captures = new WeakMap<Window, (name: string, bytes: Uint8Array) => void>();
let office: { open: (app: OfficeApp, title?: string) => string; focus: (id: string) => void; selected: () => string; print: (pdf: Uint8Array) => void } | null = null;
let filing = Promise.resolve();

/** Every save (user or agent) also lands in My Files under the app's tool key, replacing
 *  the copy saved under the same name, so Office work lists it. Best effort: signed out or
 *  offline, the file on disk is still the save. Queued so quick re-saves can't each keep a copy. */
export function keepInMyFiles(name: string, bytes: Uint8Array, tool: OfficeApp): Promise<boolean> {
  const kept = filing.then(async () => {
    const { canSaveFiles, listFiles, saveOutput, deleteFile } = await import("./files");
    if (!(await canSaveFiles())) return false;
    const older = (await listFiles()).filter(f => f.tool === tool && f.name === name);
    await saveOutput({ name, bytes }, tool);
    for (const f of older) await deleteFile(f).catch(() => {});
    notifyDataChanged(["user_files"]);
    return true;
  }).catch(e => { console.warn(`${OFFICE_APPS[tool].label} save was not kept in My Files:`, e); return false; });
  filing = kept.then(() => {});
  return kept;
}

/** Writes a file where the user picks with the native Save dialog. */
async function saveCopy(name: string, bytes: Uint8Array): Promise<void> {
  const dest = await saveDialog({ defaultPath: name });
  if (!dest) return;
  const sep = Math.max(dest.lastIndexOf("/"), dest.lastIndexOf("\\"));
  await writeDocFile(dest.slice(0, sep), dest.slice(sep + 1), bytes);
}

/** Office work registers how to open and focus app tabs while it is mounted. */
export function registerOffice(handle: NonNullable<typeof office>): () => void {
  office = handle;
  return () => { if (office === handle) office = null; };
}

export function registerOfficeFrame(app: OfficeApp, id: string, win: Window, author?: string): () => void {
  frames.set(id, { app, win: win as OfficeWindow });
  // Comments, tracked changes and the title-bar initials carry the Filey user's name (PDF takes it from ?author=).
  if (author && app === "word") void until(() => typeof (win as OfficeWindow).wordcraftControl === "function", 60_000, "")
    .then(() => officeControl(win, "engine.execute", { command: "file.setAuthor", params: { name: author } })).catch(() => {});
  // PDF saves arrive as messages: the agent's capture takes one, else My Files keeps it and Save As asks where to write it.
  const onSave = (e: MessageEvent) => {
    if (app !== "pdf" || e.source !== win || e.origin !== location.origin || e.data?.type !== "pdfcraft:save") return;
    const name = String(e.data.name || "Document.pdf"), bytes = new Uint8Array(e.data.bytes as ArrayBuffer);
    const capture = captures.get(win);
    captures.delete(win);
    if (capture) return capture(name, bytes);
    const copy = () => void saveCopy(name, bytes).catch(err => void import("sonner").then(({ toast }) => toast.error(`Could not save ${name}: ${err instanceof Error ? err.message : err}`)));
    if (e.data.saveAs) copy();
    // Save keeps the edited PDF in My Files; say so, and offer a copy on disk.
    void keepInMyFiles(name, bytes, "pdf").then(kept => import("sonner").then(({ toast }) => kept
      ? toast.success(`${name} saved to My Files`, { action: { label: "Save a copy…", onClick: copy } })
      : toast.warning(`${name} could not be kept in My Files`, { action: { label: "Save a copy…", onClick: copy } })));
  };
  window.addEventListener("message", onSave);
  // Sheets and PDF follow Filey's light or dark theme, also when it changes.
  const theme = () => {
    const mode = document.documentElement.classList.contains("dark") ? "dark" : "light";
    if (app === "pdf") void officeControl(win, "ui.set", { key: "theme", value: mode }).catch(() => {});
    if (app === "sheet") void officeControl(win, "engine.execute", { command: "view.theme", params: { mode } }).catch(() => {});
  };
  const observer = new MutationObserver(theme);
  if (app !== "word") void until(() => typeof (win as OfficeWindow)[OFFICE_APPS[app].control] === "function", 60_000, "").then(() => {
    theme();
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }).catch(() => {});
  return () => {
    observer.disconnect();
    window.removeEventListener("message", onSave);
    if (frames.get(id)?.win === win) frames.delete(id);
  };
}

/** The desktop webview can't save browser downloads, so an app's save picker is answered
 *  by the native Save dialog, or handed to the agent when it asked for the file
 *  (captureNextSave). The apps check `instanceof Promise` in their own frame, so every
 *  promise handed back is that frame's Promise. Links (hyperlinks, About) go to the
 *  system browser: the webview drops window.open. */
export function bridgeDesktop(win: Window, tool: OfficeApp = "word"): void {
  const FramePromise = (win as unknown as { Promise: PromiseConstructor }).Promise;
  const local = <T,>(work: () => Promise<T>) => new FramePromise<T>((resolve, reject) => { work().then(resolve, reject); });
  Object.assign(win, {
    // File › Print hands over its PDF (the apps' Filey patches): Office work shows it in a Filey print dialog.
    fileyPrintPdf: (pdf: Uint8Array) => office?.print(pdf.slice()),
    open: (url?: string | URL) => {
      const href = String(url ?? "");
      if (/^(https?:|mailto:)/i.test(href)) void import("@tauri-apps/plugin-opener").then(o => o.openUrl(href)).catch(() => {});
      return null;
    },
    showSaveFilePicker: (opts?: { suggestedName?: string }) => local(async () => {
      const name = opts?.suggestedName || "Document.docx";
      const capture = captures.get(win);
      captures.delete(win);
      const dest = capture ? "" : await saveDialog({ defaultPath: name });
      if (!capture && !dest) throw new DOMException("Save cancelled", "AbortError");
      const parts: BlobPart[] = [];
      return {
        createWritable: () => local(async () => ({
          write: (chunk: BlobPart) => local(async () => { parts.push(chunk); }),
          close: () => local(async () => {
            const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
            const sep = Math.max(dest!.lastIndexOf("/"), dest!.lastIndexOf("\\"));
            keepInMyFiles(capture ? name : dest!.slice(sep + 1), bytes, tool);
            if (capture) return capture(name, bytes);
            await writeDocFile(dest!.slice(0, sep), dest!.slice(sep + 1), bytes);
          }),
        })),
      };
    }),
  });
}

async function until(ready: () => boolean, ms: number, what: string, signal?: AbortSignal): Promise<void> {
  const end = Date.now() + ms;
  while (!ready()) {
    signal?.throwIfAborted();
    if (Date.now() > end) throw new Error(what);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/** The tab the agent works in: the app's tab on screen, else its newest one, else a new tab.
 *  The tab is brought to the front, because a hidden frame stops drawing and answering. */
export async function officeWindow(app: OfficeApp, fresh: boolean, signal?: AbortSignal, title?: string): Promise<OfficeWindow> {
  if (!location.hash.startsWith("#/office")) location.hash = "#/office";
  await until(() => !!office, 10_000, "Office work did not open.", signal);
  const selected = office!.selected();
  const mine = [...frames].filter(([, f]) => f.app === app).map(([id]) => id);
  // The app's tab on screen counts even while it is still loading.
  const id = fresh ? office!.open(app, title) : selected.startsWith(`${app}-`) ? selected : mine.length ? mine.pop()! : office!.open(app, title);
  office!.focus(id);
  const { label, control } = OFFICE_APPS[app];
  await until(() => typeof frames.get(id)?.win[control] === "function", 60_000, `${label} did not finish starting.`, signal);
  return frames.get(id)!.win;
}

/** Opens a file in a new tab of the app, showing the document rather than its start page. */
export async function openInOffice(app: OfficeApp, name: string, bytes: Uint8Array, signal?: AbortSignal): Promise<OfficeWindow> {
  const win = await officeWindow(app, true, signal, name);
  const open = OFFICE_APPS[app].open;
  if (open) (win[open] as (name: string, bytes: Uint8Array) => void)(name, bytes);
  else win.postMessage({ type: "pdfcraft:open", name, bytes: bytes.slice() }, location.origin);
  if (app === "word") await officeControl(win, "engine.execute", { command: "ui.backstage", params: { value: false } });
  return win;
}

/** The app whose file this is, or none. Word documents, spreadsheets and PDFs open in Office work. */
export function officeAppFor(name: string): OfficeApp | undefined {
  return (Object.keys(OFFICE_APPS) as OfficeApp[]).find(app => OFFICE_APPS[app].files.test(name));
}

/** Prints a PDF through the compact system print dialog. Its pages, as images,
 *  become the only thing the page prints (print CSS in index.css); WebView2's own
 *  preview would cover the whole window and print the app around them. */
export async function printPdf(pdf: Uint8Array): Promise<void> {
  const [{ getDocument }, { invoke }] = await Promise.all([import("./pdfjsSafe"), import("@tauri-apps/api/core")]);
  const task = getDocument({ data: pdf.slice() });
  const doc = await task.promise;
  const sheet = document.createElement("div");
  sheet.id = "filey-print-sheet";
  sheet.innerHTML = "<style>@page { margin: 0 }</style>";
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2 }); // ~144 dpi: crisp text, modest memory
      const canvas = Object.assign(document.createElement("canvas"), { width: viewport.width, height: viewport.height });
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
      const img = Object.assign(new Image(), { src: canvas.toDataURL("image/png"), alt: "" });
      await img.decode();
      sheet.append(img);
    }
  } finally {
    await task.destroy();
  }
  document.getElementById(sheet.id)?.remove();
  document.body.append(sheet);
  window.addEventListener("afterprint", () => sheet.remove(), { once: true });
  await invoke("print_page");
}

/** One control request in the app's protocol (WordCraft/GridCraft docs/control-protocol.md,
 *  PdfCraft crates/ui-egui/src/control.rs). */
export async function officeControl(win: Window, method: string, params: unknown = {}, ms = 30_000): Promise<OfficeReply> {
  const w = win as OfficeWindow;
  const app = (Object.keys(OFFICE_APPS) as OfficeApp[]).find(a => typeof w[OFFICE_APPS[a].control] === "function");
  if (!app) return { ok: false, error: "The app is not running in this tab." };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  try {
    const answer = (w[OFFICE_APPS[app].control] as (method: string, params: string) => Promise<string>)(method, JSON.stringify(params ?? {}));
    void runFramesWhileHidden(w, () => done);
    const reply = await Promise.race([
      answer,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${OFFICE_APPS[app].label} did not answer ${method} in time.`)), ms); }),
    ]);
    return JSON.parse(reply) as OfficeReply;
  } finally { done = true; clearTimeout(timer); }
}

/** A hidden window (Filey minimised while the agent works from WhatsApp) gets no
 *  animation frames, so the app's are run here until it answers. A message channel,
 *  unlike timers, isn't slowed down in a hidden window. */
async function runFramesWhileHidden(win: OfficeWindow, done: () => boolean): Promise<void> {
  const channel = new MessageChannel();
  const turn = () => new Promise<void>(resolve => { channel.port1.onmessage = () => resolve(); channel.port2.postMessage(null); });
  let last = 0;
  while (!done()) {
    if (!win.document.hidden) { await new Promise(resolve => setTimeout(resolve, 50)); continue; }
    // ponytail: ~60 frames a second, spinning on the channel only while a request waits.
    if (performance.now() - last > 16) { last = performance.now(); win.fileyRunFrames?.(); }
    await turn();
  }
  channel.port1.close();
}

/** Resolves with the file the window saves next (save picker or PDF host save). */
export function captureNextSave(win: Window, ms = 60_000): { file: Promise<{ name: string; bytes: Uint8Array }>; cancel: () => void } {
  let cancel = () => {};
  const file = new Promise<{ name: string; bytes: Uint8Array }>((resolve, reject) => {
    const timer = setTimeout(() => { captures.delete(win); reject(new Error("The app did not hand over the file.")); }, ms);
    captures.set(win, (name, bytes) => { clearTimeout(timer); resolve({ name, bytes }); });
    cancel = () => { clearTimeout(timer); captures.delete(win); };
  });
  return { file, cancel };
}
