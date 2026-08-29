import * as pdfjs from "pdfjs-dist";
import * as safePdf from "./pdfjsSafe";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { AiImage } from "./ai";

/* Turn an uploaded file into image(s) the AI can read. Images pass through;
 * PDFs are rendered to PNGs via pdfjs — ALL pages (capped), so multi-page
 * invoices/receipts aren't truncated to the first page. */

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Cap pages sent to the model — invoices/receipts are rarely longer, and this
// bounds payload size + token cost. Pages beyond this are ignored.
const MAX_PDF_PAGES = 8;

/** All pages of a PDF (or the single image) as model-ready images. */
export async function fileToImages(file: File): Promise<AiImage[]> {
  if (file.type.startsWith("image/")) {
    return [{ mediaType: file.type, dataBase64: await fileBase64(file) }];
  }
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return pdfPagesImages(file);
  }
  throw new Error("Unsupported file — upload a PDF or an image (PNG/JPG).");
}

/** First page / the single image — for callers that only need one (e.g. the
 * Copilot image attach). Multi-page extraction should use fileToImages. */
export async function fileToImage(file: File): Promise<AiImage> {
  const [first] = await fileToImages(file);
  if (!first) throw new Error("Could not read the file.");
  return first;
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function pdfPagesImages(file: File): Promise<AiImage[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await safePdf.getDocument({ data }).promise;
  const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const out: AiImage[] = [];
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available");
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const url = canvas.toDataURL("image/png");
    out.push({ mediaType: "image/png", dataBase64: url.slice(url.indexOf(",") + 1) });
  }
  return out;
}
