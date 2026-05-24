import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/* Filey loading screen — the folder mascot bounces and runs while papers
 * (pdf / image / sheet / text) fly in and snap into it, with sparkles, the
 * "Filey" wordmark, a yellow progress pill, live percentage and status text
 * that tracks progress. Seamless framer-motion loop with playful overshoot. */

const BODY = "#FFD323";
const SHADOW = "#F5B700";
const EDGE = "#E5A800";
const INK = "#111111";

// playful overshoot
const POP = [0.34, 1.56, 0.64, 1] as const;

// status phrases keyed to progress thresholds (mirrors the storyboard)
const STAGES = [
  { at: 0, text: "Getting things ready…" },
  { at: 15, text: "Catching your files…" },
  { at: 40, text: "Organizing everything…" },
  { at: 70, text: "Sorting it all out…" },
  { at: 88, text: "Almost there…" },
  { at: 100, text: "All set! Let's go!" },
];

function stageFor(pct: number) {
  let s = STAGES[0];
  for (const stage of STAGES) if (pct >= stage.at) s = stage;
  return s.text;
}

const PAPERS = [
  { color: "#E5484D", label: "PDF", delay: 0 },
  { color: "#2CADF6", label: "IMG", delay: 1 },
  { color: "#3FB984", label: "XLS", delay: 2 },
  { color: "#8C8475", label: "TXT", delay: 3 },
];

function Filey() {
  return (
    <motion.div
      // bouncy run-in-place
      animate={{ y: [0, -14, 0], rotate: [-2, 2, -2] }}
      transition={{ duration: 0.7, repeat: Infinity, ease: "easeInOut" }}
      style={{ width: 132, height: 124 }}
      className="relative"
    >
      <svg viewBox="0 0 132 124" width="132" height="124" fill="none">
        {/* folder tab */}
        <rect x="74" y="20" width="40" height="20" rx="9" fill={EDGE} />
        {/* body */}
        <rect x="14" y="30" width="104" height="84" rx="22" fill={EDGE} />
        <rect x="14" y="26" width="104" height="84" rx="22" fill={BODY} />
        {/* bottom shade */}
        <rect x="14" y="86" width="104" height="24" rx="22" fill={SHADOW} opacity="0.45" />
        {/* gloss */}
        <ellipse cx="44" cy="48" rx="26" ry="14" fill="#FFFFFF" opacity="0.25" />

        {/* legs */}
        <motion.g
          animate={{ rotate: [14, -14, 14] }}
          transition={{ duration: 0.36, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: "52px 110px" }}
        >
          <rect x="46" y="108" width="12" height="16" rx="6" fill={EDGE} />
        </motion.g>
        <motion.g
          animate={{ rotate: [-14, 14, -14] }}
          transition={{ duration: 0.36, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: "80px 110px" }}
        >
          <rect x="74" y="108" width="12" height="16" rx="6" fill={EDGE} />
        </motion.g>

        {/* arms */}
        <motion.g
          animate={{ rotate: [-28, 24, -28] }}
          transition={{ duration: 0.36, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: "16px 70px" }}
        >
          <rect x="2" y="64" width="18" height="9" rx="4.5" fill={BODY} stroke={EDGE} strokeWidth="1.5" />
        </motion.g>
        <motion.g
          animate={{ rotate: [24, -28, 24] }}
          transition={{ duration: 0.36, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: "116px 70px" }}
        >
          <rect x="112" y="64" width="18" height="9" rx="4.5" fill={BODY} stroke={EDGE} strokeWidth="1.5" />
        </motion.g>

        {/* eyes (blink) */}
        <motion.g
          animate={{ scaleY: [1, 1, 0.1, 1, 1] }}
          transition={{ duration: 4, repeat: Infinity, times: [0, 0.86, 0.9, 0.94, 1], ease: "easeInOut" }}
          style={{ transformOrigin: "66px 66px" }}
        >
          <ellipse cx="52" cy="66" rx="6.5" ry="8.5" fill={INK} />
          <ellipse cx="80" cy="66" rx="6.5" ry="8.5" fill={INK} />
          <circle cx="54" cy="62" r="2" fill="#fff" />
          <circle cx="82" cy="62" r="2" fill="#fff" />
        </motion.g>

        {/* smile */}
        <path d="M58 82 Q66 90 74 82" stroke={INK} strokeWidth="3.2" strokeLinecap="round" fill="none" />
      </svg>
    </motion.div>
  );
}

export default function FileyLoader() {
  const [pct, setPct] = useState(0);

  // Indeterminate-but-progressing bar: eases up, lingers near the end, then
  // loops. The status line + percentage track it so the scene feels staged.
  useEffect(() => {
    let raf = 0;
    let start = performance.now();
    const CYCLE = 6000; // ms per loop
    const tick = (now: number) => {
      const t = ((now - start) % CYCLE) / CYCLE;
      // ease-out so it slows toward 100% like the storyboard
      const eased = 1 - Math.pow(1 - t, 2.2);
      setPct(Math.min(100, Math.round(eased * 100)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const status = stageFor(pct);

  return (
    <div
      className="relative grid h-full min-h-full place-items-center overflow-hidden"
      style={{ background: "linear-gradient(160deg, #FFF9F0 0%, #F7F3EA 100%)" }}
    >
      {/* soft floating circles */}
      {[
        { s: 220, x: "12%", y: "18%", d: 9 },
        { s: 160, x: "82%", y: "24%", d: 11 },
        { s: 120, x: "74%", y: "78%", d: 8 },
        { s: 90, x: "20%", y: "76%", d: 10 },
      ].map((c, i) => (
        <motion.div
          key={i}
          className="pointer-events-none absolute rounded-full"
          style={{
            width: c.s,
            height: c.s,
            left: c.x,
            top: c.y,
            background: "rgba(255,211,35,0.10)",
            filter: "blur(2px)",
          }}
          animate={{ y: [0, -16, 0], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: c.d, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}

      <div className="relative flex flex-col items-center">
        {/* stage */}
        <div className="relative" style={{ width: 320, height: 190 }}>
          {/* papers flying in from the left, snapping into Filey */}
          {PAPERS.map((p, i) => (
            <motion.div
              key={i}
              className="absolute left-0 top-1/2 flex h-9 w-7 flex-col gap-[3px] rounded-md bg-white p-1 shadow-md"
              style={{ borderTop: `3px solid ${p.color}` }}
              animate={{
                x: [0, 120, 196],
                y: [0, -40 - i * 8, -4],
                rotate: [-12, 18, 0],
                scale: [1, 1, 0.2],
                opacity: [0, 1, 0],
              }}
              transition={{
                duration: 2.4,
                repeat: Infinity,
                ease: POP,
                delay: p.delay * 0.6,
                times: [0, 0.6, 1],
              }}
            >
              <span className="h-[2px] w-full rounded-full bg-black/15" />
              <span className="h-[2px] w-3/4 rounded-full bg-black/10" />
              <span
                className="mt-auto text-center text-[5px] font-bold"
                style={{ color: p.color }}
              >
                {p.label}
              </span>
            </motion.div>
          ))}

          {/* sparkles near the catch point */}
          {[0, 1, 2, 3].map((i) => (
            <motion.span
              key={`s${i}`}
              className="absolute rounded-full bg-[#FFD323]"
              style={{
                width: 6,
                height: 6,
                right: 40 + (i % 2) * 18,
                top: 30 + Math.floor(i / 2) * 26,
              }}
              animate={{ scale: [0, 1.4, 0], opacity: [0, 1, 0] }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                delay: 0.5 + i * 0.25,
                ease: "easeOut",
              }}
            />
          ))}

          {/* mascot, anchored right */}
          <div className="absolute right-6 top-1/2 -translate-y-1/2">
            <Filey />
            {/* ground shadow */}
            <motion.div
              className="mx-auto rounded-[50%] bg-black/10"
              style={{ width: 96, height: 14, marginTop: -6 }}
              animate={{ scaleX: [1, 0.8, 1], opacity: [0.18, 0.1, 0.18] }}
              transition={{ duration: 0.7, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
        </div>

        {/* wordmark */}
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">Filey</h1>

        {/* status text + heart */}
        <div className="mt-1.5 flex h-6 items-center gap-1.5">
          <AnimatePresence mode="wait">
            <motion.p
              key={status}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="text-sm font-medium text-brand-500"
            >
              {status}
            </motion.p>
          </AnimatePresence>
          <motion.span
            aria-hidden
            className="text-sm"
            style={{ color: BODY }}
            animate={{ scale: [1, 1.25, 1] }}
            transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
          >
            ♥
          </motion.span>
        </div>

        {/* progress pill */}
        <div className="mt-3 h-2.5 w-64 overflow-hidden rounded-full bg-black/[0.06]">
          <motion.div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${SHADOW}, ${BODY})`,
            }}
          />
        </div>

        {/* percentage */}
        <p className="mt-2 text-xs font-semibold tabular-nums text-brand-400">
          {pct}%
        </p>
      </div>
    </div>
  );
}
