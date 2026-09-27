/** Scanned business documents; active formats such as HTML/SVG are excluded. */
export function validateDocumentUpload(file: File): string {
  const mime = ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" } as Record<string, string>)[file.name.split(".").pop()?.toLowerCase() || ""];
  if (!mime || (file.type && file.type !== mime) || !file.size || file.size > 10 * 1024 * 1024)
    throw new Error("Choose a PDF, PNG, JPG or WebP document up to 10 MB.");
  return mime;
}
