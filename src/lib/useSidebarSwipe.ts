import { useEffect, useRef, type RefObject } from "react";

/** Mobile-only touch gestures; native scrolling wins until a horizontal drag is clear. */
export function useSidebarSwipe(
  root: RefObject<HTMLDivElement | null>,
  sidebar: RefObject<HTMLElement | null>,
  enabled: boolean,
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  const suppressClickUntil = useRef(0);
  useEffect(() => {
    const host = root.current, panel = sidebar.current;
    const backdrop = host?.querySelector<HTMLElement>(".workspace-drawer-backdrop");
    if (!enabled || !host || !panel || !backdrop) return;
    let gesture: { id: number; x: number; y: number; time: number; width: number; distance: number; dragging: boolean } | null = null;
    const reset = () => {
      gesture = null;
      host.style.removeProperty("--workspace-reveal");
      delete host.dataset.sidebarDragging;
    };
    const start = (event: TouchEvent) => {
      reset();
      suppressClickUntil.current = 0;
      if (event.touches.length !== 1) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest('input,textarea,select,[contenteditable="true"],[role="slider"]')) return;
      if (document.querySelector('[aria-modal="true"]:not(#workspace-sidebar)')) return;
      const touch = event.touches[0];
      // Leave the very edge to Safari's back gesture. Start just inside the edge.
      if (!open && (touch.clientX < 8 || touch.clientX > 32)) return;
      if (open && !panel.contains(target) && target !== backdrop) return;
      gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp,
        width: panel.getBoundingClientRect().width, distance: 0, dragging: false };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1 || !event.cancelable) { reset(); return; }
      const touch = event.touches[0];
      if (touch.identifier !== gesture.id) { reset(); return; }
      const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
      if (!gesture.dragging) {
        if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { reset(); return; }
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        if ((open && dx > 0) || (!open && dx < 0)) { reset(); return; }
        gesture.dragging = true;
      }
      event.preventDefault();
      gesture.distance = Math.max(0, Math.min(gesture.width, open ? -dx : dx));
      const reveal = open ? gesture.width - gesture.distance : gesture.distance;
      // One position drives the page and sidebar; no React render per touch frame.
      host.dataset.sidebarDragging = "true";
      host.style.setProperty("--workspace-reveal", `${reveal}px`);
    };
    const end = (event: TouchEvent) => {
      if (!gesture?.dragging) { reset(); return; }
      const elapsed = Math.max(1, event.timeStamp - gesture.time);
      const commit = gesture.distance > gesture.width * 0.35
        || (gesture.distance > 40 && gesture.distance / elapsed > 0.45);
      suppressClickUntil.current = Date.now() + 400;
      reset();
      if (commit) setOpen(!open);
    };
    const cancel = () => {
      if (gesture?.dragging) suppressClickUntil.current = Date.now() + 400;
      reset();
    };
    const click = (event: MouseEvent) => {
      if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); }
    };
    host.addEventListener("touchstart", start, { passive: true });
    host.addEventListener("touchmove", move, { passive: false });
    host.addEventListener("touchend", end);
    host.addEventListener("touchcancel", cancel);
    host.addEventListener("click", click, true);
    return () => {
      reset();
      host.removeEventListener("touchstart", start);
      host.removeEventListener("touchmove", move);
      host.removeEventListener("touchend", end);
      host.removeEventListener("touchcancel", cancel);
      host.removeEventListener("click", click, true);
    };
  }, [root, sidebar, enabled, open, setOpen]);
}
