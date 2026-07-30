// Render a React node to PDF bytes without it being on screen.
//
// The house PDF pipeline (elementToPdfBytes) captures a live DOM element, so
// until now a document could only be exported while its editor was mounted.
// This mounts the node into a detached, off-screen container, waits for fonts
// and images to actually settle — html-to-image captures whatever is painted,
// so a logo that hasn't loaded yet is simply missing from the PDF — captures,
// then tears the container down.

import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import { elementToPdfBytes } from "./pdfTools";

/** Resolve once every <img> under `el` has loaded (or failed). */
async function imagesSettled(el: HTMLElement): Promise<void> {
  const imgs = Array.from(el.querySelectorAll("img"));
  await Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((res) => {
            img.addEventListener("load", () => res(), { once: true });
            img.addEventListener("error", () => res(), { once: true });
          })
    )
  );
}

const nextFrame = () =>
  new Promise<void>((res) => requestAnimationFrame(() => res()));

export async function reactToPdfBytes(node: ReactNode, name: string) {
  const host = document.createElement("div");
  // Off-screen rather than display:none — a hidden subtree has no layout, and
  // html-to-image would capture nothing.
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("data-no-i18n", "");
  host.setAttribute("dir", "ltr");
  host.style.cssText =
    "position:fixed;left:-99999px;top:0;width:794px;background:#fff;pointer-events:none";
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    root.render(node);
    // Two frames: one for React to commit, one for the browser to lay out.
    await nextFrame();
    await nextFrame();
    if (document.fonts?.ready) await document.fonts.ready;
    await imagesSettled(host);
    return await elementToPdfBytes(host, name);
  } finally {
    root.unmount();
    host.remove();
  }
}
