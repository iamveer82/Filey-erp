import { heicTo } from "heic-to/csp";

// Own the decoder's lifetime so cancellation also stops its nested worker.
self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const bitmap = await heicTo({ blob: event.data.file, type: "bitmap" });
    self.postMessage({ bitmap }, { transfer: [bitmap] });
  } catch {
    self.postMessage({ error: "Could not decode this HEIC/HEIF image. Try exporting it as JPEG or PNG." });
  }
};
