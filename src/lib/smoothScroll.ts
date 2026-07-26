// Smooth scrolling for the main content column, via Lenis.
//
// The app shell is not a page that scrolls — the window never does. The real
// scroller is <main>, so Lenis is attached to that element rather than the
// document, and it drives the element's own scrollTop (no transforms), which
// keeps position:sticky headers and native scroll anchoring working.
//
// Deliberately conservative for an ERP: wheel only. Trackpad/touch panning and
// every nested scroller (tables, dropdowns, the sidebar) stay native, because
// these screens are scanned quickly and eased motion there reads as lag.
import Lenis from "lenis";

const KEY = "filey_smooth_scroll";
const REDUCED = "(prefers-reduced-motion: reduce)";

/** On unless the user turned it off. */
export function getSmoothScroll(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSmoothScroll(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private mode — the preference just won't persist */
  }
  // Same bus the theme and accent stores use, so subscribers re-read.
  window.dispatchEvent(new Event("filey-ui"));
}

function reducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia(REDUCED).matches;
}

/** The OS accessibility setting always wins over the app preference. */
function wanted(): boolean {
  return getSmoothScroll() && !reducedMotion();
}

/**
 * Attach Lenis to a scroll container. Returns a cleanup function.
 * Re-evaluates whenever the preference or prefers-reduced-motion changes.
 */
export function attachSmoothScroll(
  wrapper: HTMLElement,
  content: HTMLElement
): () => void {
  let lenis: Lenis | null = null;

  const create = () => {
    if (lenis) return;
    lenis = new Lenis({
      wrapper,
      content,
      lerp: 0.12,
      smoothWheel: true,
      // Trackpad and touch panning stay 1:1 with the finger.
      syncTouch: false,
      // Let Lenis own its rAF loop — the app has no shared ticker.
      autoRaf: true,
      // Wheel over a nested scroller scrolls that, not the page behind it.
      allowNestedScroll: true,
    });
  };

  const destroy = () => {
    lenis?.destroy();
    lenis = null;
  };

  const update = () => (wanted() ? create() : destroy());

  update();
  window.addEventListener("filey-ui", update);
  const mq = typeof matchMedia !== "undefined" ? matchMedia(REDUCED) : null;
  mq?.addEventListener("change", update);

  return () => {
    window.removeEventListener("filey-ui", update);
    mq?.removeEventListener("change", update);
    destroy();
  };
}
