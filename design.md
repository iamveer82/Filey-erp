# Filey — Design System (design.md)

> **This document is the source of truth for all UI work in this project.**
> Do NOT deviate from these tokens, components, or rules without an explicit
> instruction from the user that overrides this file. If a value is not
> specified here, derive it from the closest existing component.
>
> **Direction: minimal.** Filey follows an Odoo/Tally-style, usability-first
> aesthetic: quiet neutral surfaces, one restrained brand accent, no
> decorative effects. Function over flourish on every screen.

---

## 0. Operating Rules for Claude Code

1. **Never** introduce colors, fonts, radii, shadows, or spacing values that are not defined here.
2. **Always** use design tokens / component classes instead of hard-coded values.
3. **One typeface:** Plus Jakarta Sans everywhere (`font-sans` = `font-display`). IBM Plex Mono for code/numeric identifiers only. Geist Pixel (`font-pixel`) is the display accent — wordmark, dashboard numbers, chart text; see §3.
4. **4px spacing scale** only: 4, 8, 12, 16, 24, 32, 48, 64, 96.
5. **Radii:** 12px (`rounded-xl`) for buttons/inputs, 16px (`rounded-2xl`) for cards/modals. Nothing rounder.
6. **Icons:** Lucide React only, 1.75px stroke (set globally), sizes 16/18/20/24.
7. **Yellow `#FFD600` is reserved** for primary actions, the active nav state, and small key highlights. Never body text, large backgrounds, gradients, or decoration.
8. **No decorative effects.** Banned: gradients (background or text), glows, shimmer, spotlight/tilt cards, scale/lift **hovers**, staggered entrances, spring animations, parallax, glassmorphism blur.
9. **Motion budget:** opacity fades ≤150ms and color transitions ≤200ms. The ONE sanctioned exception is the **materialize** enter primitive for overlays (modals, command palette, popovers): opacity + a ≤3% scale + ≤6px translate from the anchor, cubic-bezier(0.16,1,0.3,1) (fast-out/gentle-settle), ≤200ms, one-shot, `transform-origin` set to where it appears (`.materialize-scrim` / `.materialize-surface` in index.css). Everything else: nothing moves position, scales, or bounces — no hover motion, no springs, no loops. `prefers-reduced-motion` collapses materialize to a fade.
10. Dark mode is supported (`dark:` class strategy); every new surface needs a dark variant.

---

## 1. Brand & Vibe

Filey is a calm, professional ERP/CRM for UAE small businesses. The UI should
read like a well-set ledger: dense but breathable, obvious to operate,
nothing competing for attention with the user's data.

Avoid: visual noise, oversized hero numbers, multiple accent colors in one
view, animation that draws the eye away from content.

---

## 2. Colors

| Token                   | Value             | Role                                       |
| ----------------------- | ----------------- | ------------------------------------------ |
| `primary-400`           | `#FFD600`         | Brand yellow — primary buttons, active nav |
| `primary-100/700`       | tints/shades      | Accent chips, active text on tint          |
| `brand-50…900`          | neutral gray ramp | Surfaces, hairlines, text hierarchy        |
| `ink`                   | `#0A0A0A`         | Primary text                               |
| `canvas` / `background` | `#FDFDFD`         | Page background (flat — no washes)         |
| `surface`               | `#F5F8FB`         | Sidebar / quiet grouped surfaces           |
| `success`               | `#3FB984`         | Positive status                            |
| `warning`               | `#F59E0B`         | Caution status                             |
| `danger`                | `#E5484D`         | Errors, destructive actions                |
| `info`                  | `#0EA5E9`         | Informational status                       |

Rules:

- White cards on a flat near-white canvas. No background gradients or washes.
- Status colors are for status only (badges, deltas, semantic icons) — never decoration.
- Charts: dark ink stroke (`#0A0A0A`, 2px) with 6% ink fill; grid `#E7E7EE`; ticks `#9A9A9A`. No gradient fills, no yellow charts.

## 3. Typography

**Plus Jakarta Sans** for everything (weights 400–800). `font-mono` (IBM Plex
Mono) for document numbers / code only. **Geist Pixel Square** (`font-pixel`,
single weight, vendored OFL woff2 in `public/fonts/geist-pixel`) is the
display accent: the sidebar wordmark, dashboard stat/metric numbers, and
chart text (axis ticks, legend, tooltip — global rule in index.css) ONLY.
Never body text, headings, form labels, or table data; never bold it
(synthetic bold ruins the pixel grid).

| Style             | Size / Line | Weight                        |
| ----------------- | ----------- | ----------------------------- |
| Page title        | 28 / 36     | 700                           |
| Section header    | 16–18       | 700                           |
| Card title        | 15–16       | 700                           |
| Body / table data | 14 / 22     | 400–500                       |
| Caption / meta    | 11–12       | 400–600                       |
| Stat number       | 24          | `font-pixel`, `tabular-nums`  |

Eyebrow labels: 10–11px, semibold, uppercase, tracked, `brand-400`.

## 4. Spacing & Layout

- Card inner padding: 20px (`p-5`); grid gaps 16px; section rhythm 24–32px.
- App shell: resizable sidebar (rail-collapsible), top bar with global search, content scrolls independently.
- Tables: header `.th` (12px uppercase, `brand-400`, quiet tint), cells `.td` (14px, hairline top border), row hover = background tint only.

## 5. Elevation & Borders

- `shadow-bento` `0 1px 2px rgb(0 0 0 / 0.05)` — default card.
- `shadow-bento-hover` `0 2px 8px rgb(0 0 0 / 0.08)` — hover/popovers.
- Hairlines: `brand-200` (light) / `#3A3D45` (dark).
- Cards use shadow + hairline together at these weights — both are near-invisible by design.

## 6. Component Classes (index.css / components/ui.tsx)

- Buttons: `.btn-primary` (yellow), `.btn-secondary` (yellow tint), `.btn-ghost` (white + hairline), `.btn-danger`. All 40px tall, 12px radius, semibold.
- Forms: `.input`, `.select`, `.textarea`, `.label`, `.help`, `.error-text` — 40px controls, shared baseline.
- Surfaces: `.card` (canonical), `.card-accent` (white + 4px yellow left rule), `.card-dark` (reserved, avoid in new work).
- Status: `Badge` tones via `statusTone()`; `.pill`, `.chip` / `.chip-active`.
- Shared React: `PageHeader`, `MetricCard`, `InfoCard`, `DataTable` (sort/bulk/inline-edit/empty/skeleton), `Modal` (focus-trapped), `FormField`, `EmptyState`, `Spinner`, `ErrorBanner`, `ShareToggle`.
- Legacy names (`MagicCard`, `SpotlightCard`, `ShimmerButton`, `OrdersStatCard`, `StockBreakdownCard`) now render quiet minimal surfaces — keep using them only for back-compat; prefer `.card` / `.btn-*` in new code.

## 7. States (non-negotiable for every screen)

- **Loading:** `Skeleton` rows/cards or `Spinner` — never a blank panel.
- **Empty:** `EmptyState` with icon, one-line explanation, and a CTA when a create action exists.
- **Error:** `ErrorBanner` for load failures; `toast.error` for action failures; every `await` of a mutation wrapped in try/catch.
- **Busy:** buttons disable and show progress text while saving; no double-submit.
- **Destructive:** `confirm({ danger: true, confirmLabel })` before deletes.

## 8. Accessibility

- Text contrast ≥ 4.5:1. Yellow is never used for text on light surfaces.
- Focus rings: 2px ring in text color, 2px offset, `:focus-visible` only — never removed.
- Icon-only buttons require `aria-label`. Hit targets ≥ 40×40px.
- All interactive elements are real `<button>`/`<a>` (keyboard operable), not click-handler divs.

## 9. Print / PDF (do not touch)

`.invoice-print`, `.fp-box`, `.fp-frame`, `.paper-texture` and the
`@media print` block in `index.css` drive invoice/quote PDF output and are
exempt from theme rules — documents keep their own letterhead styling.

## 10. Definition of Done (every screen)

- [ ] Tokens/classes from this file only — no raw hex or px inventions.
- [ ] All four states implemented (loading / empty / error / busy).
- [ ] No banned effects (rule 0.8); motion within budget (rule 0.9).
- [ ] Dark mode verified.
- [ ] Keyboard + screen-reader basics: focus order, labels, escape closes overlays.
- [ ] `npx tsc --noEmit` clean.
