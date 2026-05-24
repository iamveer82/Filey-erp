import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { AiImage } from "./ai";

/* Turn an uploaded file into an image the AI can read. Images pass through;
 * PDFs are rendered (first page) to a PNG via pdfjs. */

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function fileToImage(file: File): Promise<AiImage> {
  if (file.type.startsWith("image/")) {
    return { mediaType: file.type, dataBase64: await fileBase64(file) };
  }
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return pdfFirstPageImage(file);
  }
  throw new Error("Unsupported file — upload a PDF or an image (PNG/JPG).");
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

async function pdfFirstPageImage(file: File): Promise<AiImage> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const url = canvas.toDataURL("image/png");
  return { mediaType: "image/png", dataBase64: url.slice(url.indexOf(",") + 1) };
}
