/** Keep phone forms above the software keyboard without disabling pinch zoom. */
export function watchViewport(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  const update = () => {
    if (viewport.scale !== 1) return;
    const style = document.documentElement.style;
    style.setProperty("--filey-viewport-height", `${viewport.height}px`);
    style.setProperty("--filey-viewport-top", `${viewport.offsetTop}px`);
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    document.documentElement.style.removeProperty("--filey-viewport-height");
    document.documentElement.style.removeProperty("--filey-viewport-top");
  };
}
