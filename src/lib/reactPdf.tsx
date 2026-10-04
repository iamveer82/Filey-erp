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

/** Include images whose private Storage URLs resolve after the initial render. */
async function imagesSettled(el: HTMLElement): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      observer.disconnect();
      clearTimeout(timeout);
      el.removeEventListener("load", check, true);
      el.removeEventListener("error", check, true);
      if (error) reject(error); else resolve();
    };
    const check = () => {
      const failed = el.querySelector<HTMLImageElement>('[data-company-asset-status="error"]');
      if (failed) { finish(new Error(`The ${failed.alt || "company image"} could not be loaded. Reopen the document before exporting.`)); return; }
      if (el.querySelector('[data-company-asset-status="loading"]')) return;
      const images = Array.from(el.querySelectorAll("img"));
      if (images.some((image) => !image.complete)) return;
      if (images.some((image) => image.naturalWidth === 0)) { finish(new Error("A document image could not be loaded. Reopen the document before exporting.")); return; }
      finish();
    };
    const observer = new MutationObserver(check);
    const timeout = setTimeout(() => finish(new Error("Document images are still loading. Wait for the preview, then export again.")), 10000);
    observer.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "data-company-asset-status"] });
    el.addEventListener("load", check, true);
    el.addEventListener("error", check, true);
    check();
  });
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
    await nextFrame();
    await imagesSettled(host);
    return await elementToPdfBytes(host, name);
  } finally {
    root.unmount();
    host.remove();
  }
}
