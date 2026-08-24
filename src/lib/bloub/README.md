# bloub — vendored bot engine

The assistant's face. One filled shape morphing through 14 states, with two eyes
punched out of it as holes, drawn as plain SVG with no animation library.

Vendored verbatim from **[jeremy-prt/bloub](https://github.com/jeremy-prt/bloub)**
(MIT, © 2026 Jérémy Perret — full text in `LICENSE`). Upstream is a Vue app; only
its `src/bot/` engine is copied here, because that part is framework-free
TypeScript. The React renderer that consumes it is ours:
`src/components/BloubBot.tsx`.

## Why vendored rather than installed

Upstream publishes no package — it is an app, not a library. Copying the engine
is the only way to use it, and it has no runtime dependencies of its own.

## Don't "clean up" the constants

The numbers in here are **measurements**, taken frame by frame off the reference
video, not values someone chose. Rounding them to friendlier ones breaks the
resemblance, which is the whole point of the thing. A few read as mistakes and
are not:

- the eyes lean `\\`, about 26° off vertical, not `//`
- the body is a true circle, not a squircle
- transitions are exponential ease-outs; the body never overshoots

## What's here

| File | What |
|---|---|
| `states.ts` | the 14 states and their poses (`idle`, `thinking`, `orbit`, `burst`, …) |
| `engine.ts` | `BotEngine.sample(t)` — a pure function of time, so pausing and seeking give identical frames |
| `shape.ts`, `profiles.ts` | body silhouettes |
| `face.ts`, `eyefit.ts` | eyes, blinking, gaze, keeping the eyes inside the body |
| `expressions.ts` | the 16 resting faces (`heureux`, `triste`, `colere`, …) |
| `skins.ts` | selectable shapes and colours |
| `decor.ts` | particles, orbit rings, the notification dot |
| `cycles.ts` | sequences of states with hold durations |

Upstream's own tests were not copied: they test upstream's Vue app conventions,
and the engine is exercised here through `BloubBot` instead.

## Updating

Re-copy `src/bot/*.ts` from upstream and re-run `npm run typecheck`. The files
import only each other, so nothing else needs touching — but check
`BloubBot.tsx` against upstream's `src/components/BloubBot.vue` template if the
`BotFrame` shape changed.
