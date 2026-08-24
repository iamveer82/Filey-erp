import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { BotEngine, type BotFrame } from "../lib/bloub/engine";
import { NOTIF_BLUE } from "../lib/bloub/decor";
import { DEFAULT_EXPRESSION, EXPRESSION_BY_ID } from "../lib/bloub/expressions";
import { DEMI_VIEWBOX, RAYON } from "../lib/bloub/repere";
import { DEFAULT_SHAPE, SHAPE_BY_ID, mixHex } from "../lib/bloub/skins";
import { STATE_BY_ID, type StateId } from "../lib/bloub/states";
import { getPersona } from "../lib/ai";

/* The assistant's face: one filled shape that morphs between states, with two
 * eyes punched out of it as real holes. The geometry lives in src/lib/bloub
 * (vendored, MIT — see that folder's README); this component is only a
 * renderer: it owns the clock, the colours and the SVG.
 *
 * Ported from the upstream Vue component. The engine is a pure function of
 * time, so everything here is a loop that samples it and paints the result. */

/** A pose late enough that the entry morph has finished, used for the still
 *  frame. Sampling at 0 would draw the state mid-arrival. */
const SETTLED_AT = 1.2;

/** Longest frame the clock will accept. A backgrounded tab suspends rAF; without
 *  the clamp the first frame back advances the animation by the whole absence. */
const MAX_STEP = 0.064;

/** Short, friendly states the bot may slip into on its own while it waits —
 *  everything playful from the catalogue. `alert` and `exclaim` stay out:
 *  they read as alarms. */
const AMBIENT_STATES: StateId[] = [
  "wink",
  "wide",
  "egg",
  "hexagon",
  "notify",
  "orbit",
  "play",
  "comet",
  "burst",
  "swirl",
];

/** States an ambient trick may interrupt — the presence states only. Alarms
 *  and one-shots (`alert` for errors, `sleep`) always play untouched. */
const AMBIENT_HOSTS = new Set<StateId>([
  "idle",
  "thinking",
  "wide",
  "wink",
  "egg",
  "hexagon",
  "orbit",
  "play",
  "notify",
  "swirl",
]);

/** Quiet time between two ambient tricks, in ms. */
const AMBIENT_EVERY = [3500, 8000] as const;

/** Cursor tracking: the gaze saturates at full deflection once the pointer is
 *  this far from the bot's centre, and never turns the head past this angle. */
const GAZE_REACH = 260;
const GAZE_MAX_DEG = 55;

export interface BloubBotProps {
  /** Rendered size in px, square. */
  size?: number;
  /** Which of the 14 states to play. */
  state?: StateId;
  /** Resting expression — the face worn by states that don't prescribe one
   *  (`heureux`, `triste`, `colere`, `somnolent`, … see expressions.ts). */
  expression?: string;
  /** Body silhouette from the upstream shape set. */
  shape?: string;
  /** Body colour. Defaults to the accent from Settings → Appearance. */
  ink?: string;
  /** What shows through the eyes. Defaults to the current theme's surface. */
  paper?: string;
  /** false = draw one settled frame and start no loop. Use it for every avatar
   *  that isn't the one currently doing something: a long chat would otherwise
   *  run one animation loop per message. */
  animate?: boolean;
  /** true = while idle, slip into a short catalogue trick every few seconds —
   *  a wink, an egg, a spin — then settle back. Presence bots only. */
  ambient?: boolean;
  /** true = the eyes follow the pointer (animating bots only; a still frame
   *  cannot repaint between props). */
  trackCursor?: boolean;
  className?: string;
  /** Accessible name. The bot is decorative next to text that already says the
   *  same thing, so this is empty by default and the SVG is hidden. */
  label?: string;
}

/* Colour and theme in one subscription. Both arrive on the shared "filey-ui"
 * event — the colour when it's changed in Settings -> Appearance or the
 * copilot's customiser, the theme when it's flipped anywhere — and both change
 * what the bot is painted with. */
function subscribeSkin(cb: () => void): () => void {
  window.addEventListener("filey-ui", cb);
  return () => window.removeEventListener("filey-ui", cb);
}

function skinSnapshot(): string {
  const dark = document.documentElement.classList.contains("dark");
  return `${dark ? "dark" : "light"}:${getPersona().orbColor}`;
}

/** The assistant's colour and the current theme, kept live. Exported because
 *  the settings preview wants the same value the bots are using. */
export function useBotSkin(): { dark: boolean; color: string } {
  const snap = useSyncExternalStore(
    subscribeSkin,
    skinSnapshot,
    () => "light:#FFD600"
  );
  const [mode, color] = snap.split(":");
  return { dark: mode === "dark", color: color || "#FFD600" };
}

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function BloubBot({
  size = 64,
  state = "idle",
  expression = DEFAULT_EXPRESSION,
  shape = DEFAULT_SHAPE,
  ink,
  paper,
  animate = true,
  ambient = false,
  trackCursor = true,
  className,
  label,
}: BloubBotProps) {
  const skin = useBotSkin();
  const inkColor = ink ?? skin.color;
  const paperColor = paper ?? (skin.dark ? "#0a0a0a" : "#ffffff");

  const shapeRadii = useMemo(
    () => SHAPE_BY_ID.get(shape)?.radii ?? null,
    [shape]
  );
  const expr = useMemo(
    () => EXPRESSION_BY_ID.get(expression) ?? null,
    [expression]
  );

  const engineRef = useRef<BotEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new BotEngine(RAYON, state, shapeRadii, expr);
  }
  const engine = engineRef.current;
  const svgRef = useRef<SVGSVGElement | null>(null);

  /** Scene clock, in seconds. Shared by the loop and by the still frame so a
   *  bot that stops animating doesn't jump backwards in time. */
  const clock = useRef(0);
  const [frame, setFrame] = useState<BotFrame>(() =>
    engine.sample(SETTLED_AT)
  );

  const still = !animate || prefersReducedMotion();

  useEffect(() => {
    engine.setState(state, clock.current);
    if (still) setFrame(engine.sample(clock.current + SETTLED_AT));
  }, [engine, state, still]);

  useEffect(() => {
    engine.setShape(shapeRadii, clock.current);
    engine.setExpression(expr, clock.current);
    if (still) setFrame(engine.sample(clock.current + SETTLED_AT));
  }, [engine, shapeRadii, expr, still]);

  useEffect(() => {
    if (still) return;
    let raf = 0;
    let last = 0;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      const dt = last ? Math.min((ms - last) / 1000, MAX_STEP) : 0;
      last = ms;
      clock.current += dt;
      setFrame(engine.sample(clock.current));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, still]);

  /* Ambient life: after a few quiet seconds the bot slips into one of the short
   * catalogue states, plays it once, and settles back onto whatever it was
   * doing — including a turn in flight ("thinking"), which is exactly when a
   * chat should feel alive. The schedule dies whenever the caller pins another
   * state and restarts on the next render. The cancelled flag neutralises
   * stale chained timers even where clearTimeout can only reach the latest
   * one. */
  useEffect(() => {
    if (
      !animate ||
      !ambient ||
      !AMBIENT_HOSTS.has(state) ||
      prefersReducedMotion()
    )
      return;
    let cancelled = false;
    let timer = 0;
    let last = "";
    const wait = (fn: () => void, ms: number) => {
      timer = window.setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    };
    const playTrick = () => {
      // Never the same trick twice in a row: ten states read as variety, two
      // identical neighbours read as a loop.
      const pool = AMBIENT_STATES.filter((s) => s !== last);
      const next = pool[Math.floor(Math.random() * pool.length)]!;
      last = next;
      const dur = STATE_BY_ID.get(next)!.duration;
      engine.setState(next, clock.current);
      wait(() => {
        engine.setState(state, clock.current);
        wait(playTrick, AMBIENT_EVERY[0] + Math.random() * (AMBIENT_EVERY[1] - AMBIENT_EVERY[0]));
      }, dur * 1000);
    };
    wait(
      playTrick,
      AMBIENT_EVERY[0] + Math.random() * (AMBIENT_EVERY[1] - AMBIENT_EVERY[0])
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [animate, ambient, engine, state]);

  /* The eyes follow the pointer. The engine owns the blend — setLook repoints
   * from wherever the gaze currently is — so this only turns pixels into head
   * angles: direction from the bot's centre, magnitude saturating past
   * GAZE_REACH px. States that carry their own glance (wink, notify, the orbit
   * spin…) keep most of it; resting states hand the direction over fully.
   * Leaving the window or losing focus gives the gaze back to the state. */
  useEffect(() => {
    if (!animate || !trackCursor || prefersReducedMotion()) return;
    const follow = (e: PointerEvent) => {
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const k = Math.min(Math.hypot(dx, dy) / GAZE_REACH, 1);
      const ang = Math.atan2(-dy, dx);
      const mix = STATE_BY_ID.get(engine.state)?.baseFace ? 1 : 0.4;
      engine.setLook(
        {
          yaw: Math.cos(ang) * k * GAZE_MAX_DEG,
          pitch: Math.sin(ang) * k * GAZE_MAX_DEG,
          mix,
          spin: 0,
          wander: 0.25,
        },
        clock.current
      );
    };
    const release = () => engine.setLook(null, clock.current);
    window.addEventListener("pointermove", follow, { passive: true });
    document.documentElement.addEventListener("pointerleave", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointermove", follow);
      document.documentElement.removeEventListener("pointerleave", release);
      window.removeEventListener("blur", release);
    };
  }, [animate, trackCursor, engine]);

  const uid = useId().replace(/:/g, "");
  const maskId = `bloub-mask-${uid}`;
  const VB = DEMI_VIEWBOX;

  /* Fill for one particle. Depth-fogged particles mix toward the paper, which
   * only the renderer knows, so the engine hands over the ratio not the hex. */
  const dotFill = (dot: BotFrame["dots"][number]) =>
    dot.color ??
    (dot.depth === undefined
      ? inkColor
      : mixHex(paperColor, inkColor, dot.depth));

  const dots = (keyPrefix: string) =>
    frame.dots.map((dot, i) =>
      dot.d ? (
        <path
          key={`${keyPrefix}${i}`}
          d={dot.d}
          transform={`translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${RAYON})`}
          fill={dotFill(dot)}
          opacity={dot.opacity}
        />
      ) : (
        <circle
          key={`${keyPrefix}${i}`}
          cx={dot.x}
          cy={dot.y}
          r={dot.r}
          fill={dotFill(dot)}
          opacity={dot.opacity}
        />
      )
    );

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
      className={className}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        {/* The eyes are holes cut in the body rather than white shapes laid on
            top, which is what makes them clip themselves against the
            silhouette when they slide to the edge. */}
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x={-VB}
          y={-VB}
          width={VB * 2}
          height={VB * 2}
        >
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, i) => (
            <path
              key={i}
              d={eye.d}
              transform={eye.matrix}
              opacity={eye.alpha}
              fill="#000"
            />
          ))}
          {frame.notch && (
            <circle
              cx={frame.notch.x}
              cy={frame.notch.y}
              r={frame.notch.r}
              fill="#000"
            />
          )}
        </mask>

        {frame.arcs.map((arc) => (
          <linearGradient
            key={arc.id}
            id={`${uid}-${arc.id}`}
            gradientUnits="userSpaceOnUse"
            x1={arc.grad.x1}
            y1={arc.grad.y1}
            x2={arc.grad.x2}
            y2={arc.grad.y2}
          >
            {arc.grad.stops.map((c, i) => (
              <stop
                key={i}
                offset={i / (arc.grad.stops.length - 1)}
                stopColor={c}
              />
            ))}
          </linearGradient>
        ))}
      </defs>

      {/* Back half of the orbits: drawn before the body, so the body hides it. */}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path
            key={`b${arc.id}`}
            d={arc.back}
            stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width}
            opacity={arc.opacity}
          />
        ))}
      </g>

      {frame.dotsBehind && <g>{dots("pb")}</g>}

      <g opacity={frame.bodyAlpha}>
        {/* Opaque backing in the exact shape of the body. The eyes are holes,
            and a hole shows whatever is behind it — which is where the back
            half of the rings and the burst particles are drawn. Without this,
            a ring passing behind the ball reappears inside the eyes. */}
        <path d={frame.bodyPath} fill={paperColor} />
        <g mask={`url(#${maskId})`}>
          <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={inkColor} />
        </g>
      </g>

      {!frame.dotsBehind && <g>{dots("pf")}</g>}

      {frame.notif && (
        <circle
          cx={frame.notif.x}
          cy={frame.notif.y}
          r={frame.notif.r}
          fill={NOTIF_BLUE}
        />
      )}

      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path
            key={`f${arc.id}`}
            d={arc.front}
            stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width}
            opacity={arc.opacity}
          />
        ))}
      </g>
    </svg>
  );
}
