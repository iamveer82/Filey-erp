import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { mascotChoice, type MascotId } from "../lib/profileAvatars";

/** Portrait URLs remain ordinary images in older clients, exports and team lists. */
export function ProfileAvatarImage({
  animate = false,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { animate?: boolean }) {
  const id = mascotChoice(props.src || "");
  if (!id || !animate) return <img {...props} />;
  return (
    <span
      className={`relative inline-block overflow-hidden [&:has([data-visible=true])>img]:opacity-0 ${props.className || ""}`}
      style={props.style}
    >
      <img {...props} className="h-full w-full object-contain" style={undefined} />
      <MascotMotion key={id} id={id} />
    </span>
  );
}

// Sprite directions adapted from page-mascot, MIT © 2026 Kamran Ahmed.
// https://github.com/nilbuild/page-mascot — public/avatars/mascots/LICENSE.txt
function MascotMotion({ id }: { id: MascotId }) {
  const root = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [enabled, setEnabled] = useState(false);
  const [direction, setDirection] = useState(4);
  const [reaction, setReaction] = useState(false);
  const [ready, setReady] = useState({ directions: false, reactions: false });
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");
    const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0;
    const update = () => {
      setEnabled(motion.matches);
      setDirection(4);
      setReaction(false);
    };
    const move = (event: PointerEvent) => {
      if (!motion.matches || !pointer.matches) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = root.current?.getBoundingClientRect();
        if (!box || !box.width || box.bottom < 0 || box.top > window.innerHeight) return;
        const dx = event.clientX - box.left - box.width / 2;
        const dy = event.clientY - box.top - box.height / 2;
        const sector = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
        setDirection(Math.hypot(dx, dy) < 70 ? 4 : [5, 8, 7, 6, 3, 0, 1, 2][sector]);
      });
    };
    update();
    motion.addEventListener("change", update);
    pointer.addEventListener("change", update);
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer.current);
      motion.removeEventListener("change", update);
      pointer.removeEventListener("change", update);
      window.removeEventListener("pointermove", move);
    };
  }, []);
  return (
    <span
      ref={root}
      aria-hidden="true"
      className="absolute inset-0 overflow-hidden rounded-[inherit]"
      onPointerDown={() => {
        if (!enabled) return;
        clearTimeout(timer.current);
        setReaction(true);
        timer.current = setTimeout(() => setReaction(false), 560);
      }}
    >
      {enabled &&
        (["directions", "reactions"] as const).map((sheet) => {
          const index = sheet === "directions" ? direction : 0;
          const visible =
            sheet === "directions" ? !reaction || !ready.reactions : reaction;
          return (
            <img
              key={sheet}
              alt=""
              draggable={false}
              data-visible={ready[sheet] && visible}
              src={`/avatars/mascots/${id}-${sheet}.webp`}
              onLoad={() => setReady((previous) => ({ ...previous, [sheet]: true }))}
              onError={() => setReady((previous) => ({ ...previous, [sheet]: false }))}
              className="pointer-events-none absolute max-w-none"
              style={{
                width: "300%",
                height: "300%",
                left: `${-(index % 3) * 100}%`,
                top: `${-Math.floor(index / 3) * 100}%`,
                opacity: ready[sheet] && visible ? 1 : 0,
              }}
            />
          );
        })}
    </span>
  );
}
