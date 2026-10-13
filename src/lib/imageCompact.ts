/* Logos are stored as data: URLs and copied into every document row, so their size is paid on
 * each save, list read and sync. A 3 MB logo made cloud invoice saves time out on the free-tier
 * database. Documents render the logo at most a few hundred pixels wide; 600px covers print. */

const MAX_LOGO_PX = 600;

const readAsDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error ?? new Error("Could not read the image."));
  reader.readAsDataURL(file);
});

/** The image as a PNG data URL no larger than MAX_LOGO_PX on its longest side. Formats the
 *  browser cannot rasterise (e.g. some SVGs) are kept as uploaded. */
export async function compactLogo(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return readAsDataUrl(file);
  }
  try {
    const scale = Math.min(1, MAX_LOGO_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return readAsDataUrl(file);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // PNG keeps transparency and is accepted by every PDF/print path the documents use.
    const png = canvas.toDataURL("image/png");
    const original = await readAsDataUrl(file);
    return png.length < original.length ? png : original;
  } finally {
    bitmap.close();
  }
}
