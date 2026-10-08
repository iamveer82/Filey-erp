import * as safePdf from "./pdfjsSafe";
import type { AiImage } from "./ai";

/* Turn an uploaded file into image(s) the AI can read. Images pass through;
 * PDFs are rendered to PNGs via pdfjs — ALL pages (capped), so multi-page
 * invoices/receipts aren't truncated to the first page. */


// Cap pages sent to the model — invoices/receipts are rarely longer, and this
// bounds payload size + token cost. Never silently omit invoice pages.
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
  const task = safePdf.getDocument({ data });
  const out: AiImage[] = [];
  try {
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`This PDF has ${pdf.numPages} pages. Scan supports up to ${MAX_PDF_PAGES} pages; split the document before scanning so no pages are missed.`);
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 2 });
      if (!Number.isFinite(viewport.width * viewport.height) || viewport.width <= 0 || viewport.height <= 0
        || viewport.width * viewport.height > 16_000_000) throw new Error("This PDF page is too large to scan. Resize the page before scanning.");
      const canvas = document.createElement("canvas");
      try {
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not available");
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        const url = canvas.toDataURL("image/png");
        out.push({ mediaType: "image/png", dataBase64: url.slice(url.indexOf(",") + 1) });
      } finally { canvas.width = 0; canvas.height = 0; page.cleanup(); }
    }
    return out;
  } finally {
    await task.destroy();
  }
}
