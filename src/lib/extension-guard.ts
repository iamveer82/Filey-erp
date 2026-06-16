/**
 * Removes injected announcement banners from AI coding assistant browser
 * extensions (e.g. Cursor) that overlay third-party web apps.
 * Run once on app startup.
 */
const BANNER_KEYWORDS = [
  "early access",
  "React Native support",
  "Slack early access",
];

function isCursorBanner(node: Element): boolean {
  const text = node.textContent?.toLowerCase() ?? "";
  const hasKeyword = BANNER_KEYWORDS.some((k) =>
    text.includes(k.toLowerCase())
  );
  if (!hasKeyword) return false;

  // Cursor uses a black circular button with a white diamond icon.
  const hasDiamondIcon =
    node.querySelector("svg")?.outerHTML?.includes("diamond") ||
    Array.from(node.querySelectorAll("*")).some((el) => {
      const styles = window.getComputedStyle(el);
      return (
        styles.backgroundImage?.includes("diamond") ||
        /[◆◇💎]/.test(el.textContent ?? "")
      );
    });

  const style = window.getComputedStyle(node);
  const isFloating =
    style.position === "fixed" ||
    style.position === "absolute" ||
    style.position === "sticky";

  return hasKeyword && (hasDiamondIcon || isFloating);
}

function removeInjectedBanners(): void {
  document.querySelectorAll("body > *").forEach((node) => {
    if (isCursorBanner(node)) {
      node.remove();
    }
  });
}

export function installExtensionBannerGuard(): void {
  if (typeof document === "undefined") return;
  removeInjectedBanners();

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      m.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element;
          if (isCursorBanner(el)) {
            el.remove();
          }
          el.querySelectorAll("*").forEach((child) => {
            if (isCursorBanner(child)) child.remove();
          });
        }
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
