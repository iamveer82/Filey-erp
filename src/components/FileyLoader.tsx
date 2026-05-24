import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/* Filey loading screen — a 6-scene staged sequence that mirrors the
 * storyboard: wave → run → reach → carry → desk(laptop + ✓) → cheer(confetti).
 * One progress driver advances scene, status text and percentage together.
 * Pure SVG + framer-motion, playful overshoot easing, seamless loop. */

const BODY = "#FFD323";
const SHADOW = "#F5B700";
const EDGE = "#E5A800";
const INK = "#111111";

const RED = "#E5484D";
const BLUE = "#2CADF6";
const GREEN = "#3FB984";
const PURP = "#8B5CF6";

const POP = [0.34, 1.56, 0.64, 1] as const;

// scene boundaries (progress %) + status text — mirrors the storyboard cards
const STAGES = [
  { at: 0, text: "Getting things ready…" },
  { at: 18, text: "Catching your files…" },
  { at: 40, text: "Organizing everything…" },
  { at: 62, text: "Sorting it all out…" },
  { at: 80, text: "Almost there…" },
  { at: 93, text: "All set! Let's go!" },
];

/* ── mascot parts (drawn directly in stage coordinates, no nested translate
   so every rotation pivot is unambiguous) ────────────────────────────────── */

function FolderBody() {
  return (
    <g>
      <rect x="210" y="49" width="40" height="20" rx="9" fill={EDGE} />
      <rect x="150" y="59" width="104" height="84" rx="22" fill={EDGE} />
      <rect x="150" y="55" width="104" height="84" rx="22" fill={BODY} />
      <rect x="150" y="115" width="104" height="24" rx="22" fill={SHADOW} opacity="0.4" />
      <ellipse cx="180" cy="80" rx="26" ry="14" fill="#fff" opacity="0.25" />
    </g>
  );
}

function Face({ wink }: { wink?: boolean }) {
  return (
    <g>
      {wink ? (
        <>
          <path d="M181 95 Q188 89 195 95" stroke={INK} strokeWidth="3.4" fill="none" strokeLinecap="round" />
          <ellipse cx="216" cy="95" rx="6.5" ry="8.5" fill={INK} />
          <circle cx="218" cy="91" r="2" fill="#fff" />
        </>
      ) : (
        <motion.g
          animate={{ scaleY: [1, 1, 0.1, 1, 1] }}
          transition={{ duration: 4, repeat: Infinity, times: [0, 0.86, 0.9, 0.94, 1], ease: "easeInOut" }}
          style={{ transformOrigin: "202px 95px" }}
        >
          <ellipse cx="188" cy="95" rx="6.5" ry="8.5" fill={INK} />
          <ellipse cx="216" cy="95" rx="6.5" ry="8.5" fill={INK} />
          <circle cx="190" cy="91" r="2" fill="#fff" />
          <circle cx="218" cy="91" r="2" fill="#fff" />
        </motion.g>
      )}
      <path d="M192 113 Q202 122 212 113" stroke={INK} strokeWidth="3.2" fill="none" strokeLinecap="round" />
    </g>
  );
}

function Arm({ side, rot, dur }: { side: "l" | "r"; rot: number | number[]; dur: number }) {
  const origin = side === "l" ? "156px 98px" : "248px 98px";
  const x = side === "l" ? 138 : 248;
  return (
    <motion.g
      style={{ transformOrigin: origin }}
      animate={{ rotate: rot }}
      transition={{ duration: dur, repeat: Array.isArray(rot) ? Infinity : 0, ease: "easeInOut" }}
    >
      <rect x={x} y={94} width={18} height={9} rx={4.5} fill={BODY} stroke={EDGE} strokeWidth={1.5} />
    </motion.g>
  );
}

function Leg({ side, rot, dur }: { side: "l" | "r"; rot: number | number[]; dur: number }) {
  const origin = side === "l" ? "188px 139px" : "216px 139px";
  const x = side === "l" ? 182 : 210;
  return (
    <motion.g
      style={{ transformOrigin: origin }}
      animate={{ rotate: rot }}
      transition={{ duration: dur, repeat: Array.isArray(rot) ? Infinity : 0, ease: "easeInOut" }}
    >
      <rect x={x} y={137} width={12} height={18} rx={6} fill={EDGE} />
    </motion.g>
  );
}

type Pose = {
  body: { y: number[] };
  dur: number;
  limbDur?: number;
  la: number | number[];
  ra: number | number[];
  ll: number | number[];
  rl: number | number[];
  hideLegs?: boolean;
  wink?: boolean;
};

const POSES: Record<string, Pose> = {
  // standing, one arm waving
  wave: { body: { y: [0, -6, 0] }, dur: 1.3, la: 48, ra: [-120, -95, -120], ll: 0, rl: 0 },
  // running, limbs pumping, slight bounce
  run: { body: { y: [0, -12, 0] }, dur: 0.6, limbDur: 0.3, la: [-30, 25, -30], ra: [25, -30, 25], ll: [16, -16, 16], rl: [-16, 16, -16] },
  // mid-air, one arm reaching up
  reach: { body: { y: [0, -26, 0] }, dur: 1.0, la: [55, 70, 55], ra: 60, ll: 28, rl: -16 },
  // walking, both arms forward hugging a stack
  carry: { body: { y: [0, -5, 0] }, dur: 0.8, limbDur: 0.5, la: -68, ra: 78, ll: [10, -10, 10], rl: [-10, 10, -10] },
  // seated at a desk, arms down on a laptop
  type: { body: { y: [0, -2, 0] }, dur: 1.6, la: -80, ra: 82, ll: 0, rl: 0, hideLegs: true },
  // jumping for joy, both arms up, winking
  cheer: { body: { y: [0, -20, 0] }, dur: 0.55, la: [100, 118, 100], ra: [-100, -118, -100], ll: 22, rl: -22, wink: true },
};

function Filey({ pose }: { pose: keyof typeof POSES }) {
  const c = POSES[pose];
  const ld = c.limbDur ?? c.dur;
  return (
    <motion.g animate={c.body} transition={{ duration: c.dur, repeat: Infinity, ease: "easeInOut" }}>
      {!c.hideLegs && (
        <>
          <Leg side="l" rot={c.ll} dur={ld} />
          <Leg side="r" rot={c.rl} dur={ld} />
        </>
      )}
      <FolderBody />
      <Arm side="l" rot={c.la} dur={ld} />
      <Arm side="r" rot={c.ra} dur={ld} />
      <Face wink={c.wink} />
    </motion.g>
  );
}

/* ── props ─────────────────────────────────────────────────────────────── */

function Paper({ c }: { c: string }) {
  return (
    <g>
      <rect width="26" height="32" rx="3" fill="#fff" stroke="#E6E2D8" strokeWidth="1.2" />
      <rect width="26" height="6" rx="3" fill={c} opacity="0.9" />
      <rect x="5" y="13" width="16" height="2" rx="1" fill="#0000001f" />
      <rect x="5" y="18" width="12" height="2" rx="1" fill="#00000016" />
      <rect x="5" y="23" width="14" height="2" rx="1" fill="#00000012" />
    </g>
  );
}

function Sparkle({ x, y, d = 0 }: { x: number; y: number; d?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <motion.path
        d="M0 -7 L1.6 -1.6 L7 0 L1.6 1.6 L0 7 L-1.6 1.6 L-7 0 L-1.6 -1.6 Z"
        fill={BODY}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        animate={{ scale: [0, 1.3, 0], opacity: [0, 1, 0], rotate: [0, 45] }}
        transition={{ duration: 1.3, repeat: Infinity, delay: d, ease: "easeInOut" }}
      />
    </g>
  );
}

function FloatPaper({ x, y, c, d }: { x: number; y: number; c: string; d: number }) {
  return (
    <motion.g
      animate={{ y: [6, -6, 6], opacity: [0.85, 1, 0.85], rotate: [-6, 6, -6] }}
      transition={{ duration: 2.6, repeat: Infinity, delay: d, ease: "easeInOut" }}
    >
      <g transform={`translate(${x} ${y})`}>
        <Paper c={c} />
      </g>
    </motion.g>
  );
}

/* ── scenes (return SVG children; paint order = depth) ─────────────────────── */

const SCENES: Array<() => React.ReactNode> = [
  // 1 — waving, papers drifting in along a dotted trail
  () => (
    <>
      <motion.path
        d="M58 152 C 92 162, 112 120, 138 130"
        stroke={BODY}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="1 7"
        opacity="0.7"
        animate={{ strokeDashoffset: [0, -16] }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      />
      <FloatPaper x={44} y={36} c={RED} d={0} />
      <FloatPaper x={86} y={74} c={GREEN} d={0.5} />
      <FloatPaper x={56} y={116} c={BLUE} d={1} />
      <Filey pose="wave" />
    </>
  ),
  // 2 — running, papers swirling in, speed lines trailing
  () => (
    <>
      <motion.path d="M70 56 C 36 92, 64 134, 124 118" stroke={BODY} strokeWidth="2" fill="none" opacity="0.3" strokeLinecap="round" />
      {[
        { x: 52, y: 44, c: GREEN, d: 0 },
        { x: 96, y: 74, c: BLUE, d: 0.3 },
        { x: 130, y: 62, c: RED, d: 0.6 },
      ].map((p, i) => (
        <motion.g
          key={i}
          animate={{ x: [-12, 12, -12], y: [-4, 5, -4], rotate: [-16, 16, -16] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: p.d, ease: "easeInOut" }}
        >
          <g transform={`translate(${p.x} ${p.y})`}>
            <Paper c={p.c} />
          </g>
        </motion.g>
      ))}
      {[0, 1, 2].map((i) => (
        <motion.line
          key={i}
          x1="264"
          y1={92 + i * 12}
          x2="290"
          y2={92 + i * 12}
          stroke={EDGE}
          strokeWidth="3"
          strokeLinecap="round"
          animate={{ opacity: [0, 0.8, 0], pathLength: [0.2, 1, 0.2] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
        />
      ))}
      <Filey pose="run" />
    </>
  ),
  // 3 — leaping to grab a paper, sparkles around
  () => (
    <>
      <FloatPaper x={50} y={66} c={GREEN} d={0} />
      <FloatPaper x={46} y={114} c={BLUE} d={0.6} />
      <FloatPaper x={88} y={138} c={RED} d={1.1} />
      <motion.g
        animate={{ y: [0, -5, 0], rotate: [-5, 5, -5] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <g transform="translate(108 40)">
          <Paper c={BODY} />
        </g>
      </motion.g>
      <Sparkle x={300} y={64} d={0} />
      <Sparkle x={300} y={120} d={0.4} />
      <Sparkle x={70} y={44} d={0.8} />
      <Filey pose="reach" />
    </>
  ),
  // 4 — carrying a tidy stack of papers
  () => (
    <>
      <Filey pose="carry" />
      <g transform="translate(132 98)">
        {[0, 1, 2, 3].map((i) => (
          <rect
            key={i}
            x={i * 2}
            y={-i * 5}
            width="50"
            height="12"
            rx="2"
            fill="#fff"
            stroke="#E6E2D8"
            strokeWidth="1.2"
          />
        ))}
        <rect x="4" y="-24" width="22" height="15" rx="2" fill={BODY} stroke={EDGE} strokeWidth="1.2" />
      </g>
      <Sparkle x={118} y={66} d={0} />
      <Sparkle x={272} y={84} d={0.5} />
    </>
  ),
  // 5 — at a desk with a laptop, a green ✓ confirming
  () => (
    <>
      <Filey pose="type" />
      {/* desk + laptop in front (covers the lower body → seated look) */}
      <g>
        <rect x="118" y="150" width="156" height="10" rx="3" fill="#C8895A" />
        <rect x="128" y="160" width="8" height="24" rx="2" fill="#A86B3F" />
        <rect x="256" y="160" width="8" height="24" rx="2" fill="#A86B3F" />
        <g transform="translate(150 120)">
          <rect x="0" y="22" width="46" height="8" rx="2" fill="#9AA1AC" />
          <rect x="4" y="0" width="38" height="24" rx="2" fill="#C7CCD4" />
          <path d="M23 7 c -3 -4 -8 -1 -5 3 l 5 6 l 5 -6 c 3 -4 -2 -7 -5 -3 z" fill="#aab0b9" />
        </g>
        <g transform="translate(122 130)">
          <rect x="0" y="10" width="12" height="11" rx="2" fill="#C8895A" />
          <path d="M6 10 C 0 4, 1 0, 6 2 C 11 0, 12 4, 6 10 Z" fill={GREEN} />
        </g>
      </g>
      {/* speech bubble with check */}
      <motion.g
        initial={{ scale: 0 }}
        animate={{ scale: [0, 1.15, 1] }}
        transition={{ duration: 0.5, delay: 0.2, ease: POP }}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
      >
        <g transform="translate(248 46)">
          <rect width="42" height="32" rx="11" fill="#fff" stroke="#E6E2D8" strokeWidth="1.2" />
          <path d="M12 30 L8 42 L22 31 Z" fill="#fff" />
          <path d="M14 16 l5 6 l9 -12" stroke={GREEN} strokeWidth="3.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </motion.g>
      <Sparkle x={300} y={70} d={0} />
      <Sparkle x={116} y={70} d={0.5} />
    </>
  ),
  // 6 — celebration, arms up, winking, confetti raining
  () => (
    <>
      {[
        { x: 80, c: RED, d: 0 },
        { x: 120, c: BLUE, d: 0.4 },
        { x: 160, c: GREEN, d: 0.15 },
        { x: 200, c: PURP, d: 0.6 },
        { x: 240, c: BODY, d: 0.3 },
        { x: 280, c: RED, d: 0.5 },
        { x: 300, c: GREEN, d: 0.1 },
        { x: 100, c: PURP, d: 0.7 },
      ].map((p, i) => (
        <g key={i} transform={`translate(${p.x} 0)`}>
          <motion.rect
            width="6"
            height="11"
            rx="1.5"
            fill={p.c}
            initial={{ y: -12, opacity: 0 }}
            animate={{ y: [-12, 188], opacity: [0, 1, 1, 0], rotate: [0, 220] }}
            transition={{ duration: 1.8, repeat: Infinity, delay: p.d, ease: "easeIn" }}
          />
        </g>
      ))}
      <Sparkle x={118} y={58} d={0} />
      <Sparkle x={292} y={70} d={0.4} />
      <Sparkle x={284} y={132} d={0.8} />
      <Filey pose="cheer" />
    </>
  ),
];

/* ── loader ────────────────────────────────────────────────────────────── */

export default function FileyLoader() {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const CYCLE = 7200; // ms per full storyboard loop
    const tick = (now: number) => {
      const t = ((now - start) % CYCLE) / CYCLE;
      // advance to 100% by 90% of the cycle, then hold (celebrate) before looping
      setPct(Math.min(100, Math.round((t / 0.9) * 100)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  let idx = 0;
  for (let i = 0; i < STAGES.length; i++) if (pct >= STAGES[i].at) idx = i;
  const status = STAGES[idx].text;

  return (
    <div
      className="relative grid h-full min-h-full place-items-center overflow-hidden"
      style={{ background: "linear-gradient(160deg, #FFF9F0 0%, #F7F3EA 100%)" }}
    >
      {/* soft floating blobs */}
      {[
        { s: 220, x: "12%", y: "16%", d: 9 },
        { s: 160, x: "82%", y: "22%", d: 11 },
        { s: 120, x: "74%", y: "78%", d: 8 },
        { s: 90, x: "18%", y: "76%", d: 10 },
      ].map((c, i) => (
        <motion.div
          key={i}
          className="pointer-events-none absolute rounded-full"
          style={{ width: c.s, height: c.s, left: c.x, top: c.y, background: "rgba(255,211,35,0.10)", filter: "blur(2px)" }}
          animate={{ y: [0, -16, 0], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: c.d, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}

      <div className="relative flex flex-col items-center">
        {/* stage */}
        <svg viewBox="0 0 360 200" width="360" height="200" className="max-w-[88vw]" fill="none">
          <AnimatePresence mode="wait">
            <motion.g
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: "easeInOut" }}
            >
              {SCENES[idx]()}
            </motion.g>
          </AnimatePresence>
          {/* ground shadow */}
          <ellipse cx="202" cy="172" rx="56" ry="9" fill="#000" opacity="0.07" />
        </svg>

        {/* wordmark */}
        <h1 className="-mt-1 text-3xl font-extrabold tracking-tight text-ink">Filey</h1>

        {/* status + heart */}
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
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${SHADOW}, ${BODY})` }}
          />
        </div>

        {/* percentage */}
        <p className="mt-2 text-xs font-semibold tabular-nums text-brand-400">{pct}%</p>
      </div>
    </div>
  );
}
