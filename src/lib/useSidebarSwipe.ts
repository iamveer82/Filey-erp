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
    const main = host?.querySelector<HTMLElement>(".workspace-main");
    if (!enabled || !host || !panel || !backdrop || !main) return;
    let gesture: { id: number; x: number; y: number; time: number; width: number; distance: number; dragging: boolean } | null = null;
    const reset = () => {
      gesture = null;
      main.style.removeProperty("transform");
      panel.style.removeProperty("transform");
      delete host.dataset.sidebarDragging;
    };
    const start = (event: TouchEvent) => {
      if (gesture?.dragging) suppressClickUntil.current = Date.now() + 400;
      reset();
      if (event.touches.length !== 1) return;
      suppressClickUntil.current = 0;
      const target = event.target;
      if (!(target instanceof Element) || target.closest('input,textarea,select,canvas,[contenteditable="true"],[role="slider"],.filey-table-scroll')) return;
      if (document.querySelector('[aria-modal="true"]:not(#workspace-sidebar)')) return;
      const touch = event.touches[0];
      // Leave Safari's outer edge and ordinary buttons/links to native gestures.
      if (!open && (touch.clientX < 16 || touch.clientX > 48 || target.closest('button,a,[role="button"]'))) return;
      if (open && !panel.contains(target) && target !== backdrop) return;
      gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp,
        width: panel.getBoundingClientRect().width, distance: 0, dragging: false };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1 || !event.cancelable) { cancel(); return; }
      const touch = event.touches[0];
      if (touch.identifier !== gesture.id) { cancel(); return; }
      const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
      if (!gesture.dragging) {
        if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { reset(); return; }
        // The open drawer already reserves its horizontal axis with touch-action.
        // Keep finger jitter on navigation links/buttons as an ordinary tap.
        if (open && Math.abs(dx) < 10) return;
        // Claim clear horizontal intent on the first move. Waiting for a large
        // distance at the closed page edge lets mobile scrolling own the touch.
        // Ambiguous/diagonal movement still belongs to the native scroller.
        if (dx === 0 || Math.abs(dx) < Math.abs(dy) * 2) return;
        if ((open && dx > 0) || (!open && dx < 0)) { reset(); return; }
        gesture.dragging = true;
        host.dataset.sidebarDragging = "true";
      }
      event.preventDefault();
      gesture.distance = Math.max(0, Math.min(gesture.width, open ? -dx : dx));
      const reveal = open ? gesture.width - gesture.distance : gesture.distance;
      // Only the two moving layers change. An inherited workspace variable
      // would invalidate styles throughout every open page on each touch frame.
      main.style.transform = `translate3d(${reveal}px, 0, 0)`;
      panel.style.transform = `translate3d(${reveal - gesture.width}px, 0, 0)`;
    };
    const end = (event: TouchEvent) => {
      if (!gesture?.dragging) { reset(); return; }
      const touch = Array.from(event.changedTouches ?? []).find(t => t.identifier === gesture!.id);
      if (touch) {
        const dx = touch.clientX - gesture.x;
        gesture.distance = Math.max(0, Math.min(gesture.width, open ? -dx : dx));
      }
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
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      reset();
      host.removeEventListener("touchstart", start);
      host.removeEventListener("touchmove", move);
      host.removeEventListener("touchend", end);
      host.removeEventListener("touchcancel", cancel);
      host.removeEventListener("click", click, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
    };
  }, [root, sidebar, enabled, open, setOpen]);
}
