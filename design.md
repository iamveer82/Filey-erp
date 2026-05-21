# Filey — Design System (design.md)

> **This document is the source of truth for all UI work in this project.**
> Do NOT deviate from these tokens, components, or rules without an explicit instruction from the user that overrides this file. If a value is not specified here, ask before inventing one. Pixel-perfect adherence to this spec is the primary success criterion.

---

## 0. Operating Rules for Claude Code

1. **Never** introduce colors, fonts, radii, shadows, or spacing values that are not defined in this file.
2. **Always** use the design tokens (Section 4) instead of hard-coded values in components.
3. **Type pairing:** **Poppins** (display) for headings, metrics, buttons, labels & UI chrome — use the `font-display` utility or a heading tag. **Open Sans** (body) for paragraphs, table data, descriptions & long-form text — the default `font-sans`. No other faces; only `system-ui, sans-serif` fallbacks.
4. **Always** use the 4px base spacing scale. No `5px`, `7px`, `13px`, `15px`, etc.
5. **Always** use **16px** border-radius for cards and **12px** for buttons. No other radii unless listed below.
6. **Always** use line-style icons with consistent stroke width (Lucide React, 1.75px stroke).
7. **Yellow (`#FFD600`) is reserved** for primary actions, key highlights, and the active nav state. Do not use it for body text, large backgrounds, or decoration.
8. Before claiming a screen is "done," compare it side-by-side against the reference and list any deltas. Match spacing, weights, and proportions — not just colors.
9. If asked to add a new component, derive its style from the closest existing component in this file rather than inventing a new visual language.
10. Dark mode is **not** in scope for v1 unless explicitly requested. Build light UI only.

---

## 1. Brand & Vibe

Filey is a friendly, modern, slightly playful inventory & expense tool for UAE small businesses. The visual feel is:

- **Warm + clean.** Soft creams and warm neutrals form the backdrop; yellow provides energy.
- **Confident but not corporate.** Rounded corners (16px), generous spacing, soft shadows.
- **Data-dense but breathable.** Cards are well-padded; numbers are large and bold.

Avoid: harsh blacks on large surfaces, neon gradients, glassmorphism, drop shadows that are too dark, sharp 90° corners.

---

## 2. Colors

Use only these. CSS variables defined below — components must reference variables, never hex values directly.

| Token | Hex | Role |
|---|---|---|
| `--color-primary` | `#FFD600` | Primary yellow — CTAs, active states, key highlights |
| `--color-secondary` | `#FFBA3D` | Secondary orange — accent cards, badges, secondary highlights |
| `--color-background` | `#F3EBD6` | Page background — warm cream |
| `--color-surface` | `#CBBEAA` | Subtle surface tint — used sparingly for grouped sections |
| `--color-text` | `#222222` | Primary text & dark UI elements |
| `--color-text-muted` | `#6B6B6B` | Secondary text, captions, helper text |
| `--color-text-subtle` | `#9A9A9A` | Tertiary text, placeholder, disabled |
| `--color-card` | `#FFFFFF` | Card / panel background |
| `--color-border` | `#EAE4D6` | Hairline borders on cards & dividers |
| `--color-success` | `#3FB984` | Positive deltas (↑ vs last month) |
| `--color-danger` | `#E5484D` | Low stock badges, errors |
| `--color-chart-dark` | `#1F1F1F` | Chart/product card backgrounds (used for contrast cards like Reorders) |

```css
:root {
  --color-primary: #FFD600;
  --color-secondary: #FFBA3D;
  --color-background: #F3EBD6;
  --color-surface: #CBBEAA;
  --color-text: #222222;
  --color-text-muted: #6B6B6B;
  --color-text-subtle: #9A9A9A;
  --color-card: #FFFFFF;
  --color-border: #EAE4D6;
  --color-success: #3FB984;
  --color-danger: #E5484D;
  --color-chart-dark: #1F1F1F;
}
```

**Usage rules**
- Yellow `#FFD600`: primary buttons, active nav pill, hero stat cards (e.g. "Orders 94"), key chart fills.
- Orange `#FFBA3D`: secondary accent cards (e.g. "Stock"), badges like "High demand", warning highlights.
- Cream `#F3EBD6`: app background, **not** card background.
- White `#FFFFFF`: all cards and panels.
- Dark `#1F1F1F`: used for the product photo card style only (e.g. Reorders / camera cards).

---

## 3. Typography

**Display:** `Poppins`, system-ui, sans-serif — headings, metric values, buttons, labels, table headers, pills/chips. Weights 500/600/700. Use the `font-display` Tailwind utility (heading tags get it automatically).

**Body:** `Open Sans`, system-ui, sans-serif — paragraphs, table cell data, descriptions, message bodies, inputs. Weights 400/500/600/700. This is the default `font-sans`.

Geometric Poppins gives the brand voice on chrome; humanist Open Sans keeps dense data and long-form text readable.

| Style | Size / Line height | Weight | Use |
|---|---|---|---|
| H1 | 32 / 40 | 700 Bold | Page titles |
| H2 | 24 / 32 | 600 SemiBold | Section headers |
| H3 | 18 / 28 | 500 Medium | Card titles |
| Body | 14 / 22 | 400 Regular | Default text |
| Caption | 12 / 18 | 400 Regular | Helper / meta text |
| Stat number | 28-32 / 36 | 700 Bold | Big numbers on stat cards |

**Rules**
- Numbers in stat cards (`24,560`, `1,240`, `68.3 GB`) are H1-sized, bold, tight tracking.
- Stat labels above the number ("Total Items") are 13–14px, medium weight, `--color-text-muted`.
- Never use ALL CAPS except for section eyebrows like "TOTAL ITEMS" — small (11px), tracked +0.5px.

---

## 4. Spacing System

**Base unit: 4px.** Allowed values only:

`4, 8, 12, 16, 24, 32, 48, 64, 96`

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-6` | 24px |
| `--space-8` | 32px |
| `--space-12` | 48px |
| `--space-16` | 64px |
| `--space-24` | 96px |

**Defaults**
- Card inner padding: **24px** (`--space-6`)
- Gap between cards in a grid: **16px** (`--space-4`)
- Section vertical rhythm: **32px** between major sections
- Page outer padding: **24–32px** on desktop

---

## 5. Radius, Shadows, Borders

| Token | Value | Use |
|---|---|---|
| `--radius-button` | 12px | Buttons, chips, inputs |
| `--radius-card` | 16px | Cards, panels, modal containers |
| `--radius-pill` | 999px | Nav pill, status badges, avatar |
| `--radius-icon-tile` | 12px | Square icon tiles in stat cards |
| `--shadow-card` | `0 1px 2px rgba(34,34,34,0.04), 0 8px 24px rgba(34,34,34,0.06)` | Default card elevation |
| `--shadow-pop` | `0 4px 12px rgba(255,214,0,0.25)` | Yellow CTA hover / active stat card |
| `--border-hairline` | `1px solid var(--color-border)` | Card outlines when no shadow |

Cards either use `--shadow-card` OR `--border-hairline` — not both.

---

## 6. Components

### 6.1 Buttons

| Variant | Background | Text | Border | Use |
|---|---|---|---|---|
| Primary | `#FFD600` | `#222222` | none | Main CTA |
| Secondary | `#FFFFFF` | `#222222` | `--border-hairline` | Secondary action |
| Ghost | transparent | `#222222` | none | Tertiary / inline |
| Icon (•••) | `#FFFFFF` | `#222222` | `--border-hairline` | Overflow menus |

- Padding: `10px 20px` (height ~40px). Radius `12px`. Weight 500.
- No gradients. No drop shadows on buttons except primary hover (`--shadow-pop`).
- Disabled: 40% opacity, `cursor: not-allowed`.

### 6.2 Chips / Filters

Pill-shaped, 32px tall, `8px 14px` padding, `--radius-pill`.
- Default: white bg, `--border-hairline`, dark text.
- Active: yellow bg `#FFD600`, dark text, no border.
- Leading icon optional (16px, line style).
- Trailing caret for dropdown chips.

### 6.3 Cards

Two main styles:

**(a) Stat card** — white bg, 24px padding, 16px radius, `--shadow-card`.
Layout: square icon tile top-left (40×40, tinted yellow or orange bg, dark icon), `•••` overflow top-right, label, big number, delta row (`↑ 12.5% vs last month` — success green up, danger red down).

**(b) Feature card** — same shell, can use yellow or orange as full background for emphasis (e.g. Orders card uses yellow, Stock card uses orange). Numbers stay dark `#222222` on these.

**(c) Product card (dark)** — `--color-chart-dark` background, white text, used for product imagery (e.g. Reorders camera). 16px radius. Has a small yellow action button bottom-right.

### 6.4 Navigation (Sidebar)

- White panel, 16px radius, fills sidebar column.
- Each nav item: 44px tall, 12px horizontal padding, 12px radius.
- Active item: yellow `#FFD600` bg, dark text, no icon recolor.
- Inactive: transparent, `--color-text-muted` text, icon at 20px line stroke.
- Icon + label, 12px gap.
- Bottom utility row: icon-only buttons, 40×40, the active one is a yellow pill.

### 6.5 Top Bar

- Logo left, search center (rounded pill input, 44px tall, `⌘K` hint right-aligned), notifications bell with red count dot, avatar + name + role + caret on the right.
- Search input: `#F7F2E6` bg or white with hairline; radius `--radius-pill`; search icon at 16px.

### 6.6 Tables

- Header row: 12px caption, uppercase tracked, `--color-text-muted`.
- Row height: 56px. Hairline divider between rows (`--color-border`).
- Status pills inline (e.g. "Low" → red-tinted pill with `--color-danger` text on `#FDECEC` bg).
- Trailing `•••` actions column right-aligned.
- No zebra striping. No vertical grid lines.

### 6.7 Charts

- Line charts: 2px stroke, smooth (monotone). Active series uses `--color-text` (dark). Filled area below: 12% opacity of stroke color.
- Tooltip: white card, 12px radius, 12px padding, hairline border, small dot showing the value.
- Axis labels: 12px caption, `--color-text-subtle`.
- Donut / progress rings: yellow `#FFD600` foreground on `#F3EBD6` track, 8px stroke.
- Bar charts: rounded top corners (4px), yellow primary fill.

### 6.8 Badges

- Status pill: `--radius-pill`, `2px 10px` padding, 12px text, medium weight.
- "Low" → bg `#FDECEC`, text `#E5484D`.
- "High demand" → bg `#FFD600`, text `#222222`, ⚡ icon.
- Delta arrows: ↑ green `#3FB984`, ↓ red `#E5484D`, both at 12px.

---

## 7. Icons

- Library: **Lucide React** only.
- Stroke width: **1.75px** everywhere.
- Sizes: 16 (inline), 20 (nav, buttons), 24 (stat tiles).
- Color: inherit from parent text color. Never multi-color icons.
- Active nav icon: dark on yellow (no recoloring).

---

## 8. Layout

- Desktop max width: **1440px** centered, **32px** outer padding.
- Sidebar: fixed **264px** wide on ≥1280px screens; collapses to icon-only at <1024px.
- Main grid: **12 columns**, **24px** gutter.
- Stat row: 4 equal cards. Below: 2-column primary content area (charts left, activity right).
- Cards never touch viewport edges — minimum 24px gap.

---

## 9. Motion

- Default duration: **180ms**, easing `cubic-bezier(0.2, 0, 0.2, 1)`.
- Hover: bg lighten or shadow lift only. No scale > 1.02.
- No bouncing, no spring overshoots, no parallax.
- Page transitions: simple 120ms opacity fade.

---

## 10. Accessibility (non-negotiable)

- Text contrast ≥ 4.5:1 against background. Yellow on white is **not** allowed for text.
- Focus rings: 2px solid `--color-text`, 2px offset. Never remove `:focus-visible`.
- All icon-only buttons must have `aria-label`.
- Hit targets ≥ 44×44px.

---

## 11. Definition of Done (checklist for every screen)

Before marking any screen complete, Claude Code must verify:

- [ ] Only tokens from this file are used. No raw hex / px values in components.
- [ ] Poppins is loaded and applied to all text.
- [ ] All cards use 16px radius and either `--shadow-card` or `--border-hairline` (not both).
- [ ] All buttons use 12px radius and one of the four defined variants.
- [ ] Spacing values are from the 4/8/12/16/24/32/48/64/96 scale.
- [ ] Yellow is used only for primary actions, active nav, and key highlights — not for body text or large backgrounds.
- [ ] Icons are Lucide, 1.75px stroke, inheriting text color.
- [ ] No element invents a new color, font, radius, or shadow.
- [ ] Side-by-side visual comparison done against the Filey reference; any deltas listed.

If any box is unchecked, the screen is not done.
