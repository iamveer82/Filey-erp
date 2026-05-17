# Filey Design System

> This document outlines the design system and components used in the
> **Filey Inventory Management Desktop App**. A warm, friendly and modern
> system built for clarity, speed and delight. **v2.0.0**

---

## 01 · Colors

A warm, poppy palette built on a single confident yellow with soft neutral
surfaces. Soft gradients and warm neutrals create a friendly, modern look.

### Core

| Token | Hex | Use |
|-------|-----------|-----|
| `primary` | `#FFD600` | Primary actions, active nav, key highlights |
| `secondary` | `#FFBA3D` | Secondary accents, warm gradients, focus states |
| `background` | `#F3EBD6` | App canvas / page background |
| `surface` | `#CBBEAA` | Muted surfaces, dividers, inactive fills |
| `text` / `dark` | `#222222` | Primary text, dark cards, sidebar foreground |

### Primary ramp (yellow)

| Token | Hex |
|-------|-----------|
| `primary-50`  | `#FFFBEB` |
| `primary-100` | `#FFF3C4` |
| `primary-200` | `#FFE885` |
| `primary-300` | `#FFDD47` |
| `primary-400` | `#FFD600` (base) |
| `primary-500` | `#F5C400` |
| `primary-600` | `#E0AE00` |
| `primary-700` | `#B88C00` |

### Neutrals (warm)

| Token | Hex |
|-------|-----------|
| `brand-900` | `#222222` (text / darkest) |
| `brand-700` | `#4A453B` |
| `brand-600` | `#6B6457` (body text) |
| `brand-500` | `#8C8475` |
| `brand-400` | `#A89F8C` (muted / captions) |
| `brand-300` | `#CBBEAA` (surface) |
| `brand-200` | `#E4DAC6` (borders) |
| `brand-100` | `#F0E9D9` (soft fills) |
| `brand-50`  | `#F8F3E7` (tint surfaces) |
| white       | `#FFFFFF` (cards) |

### Semantic

| Name | Hex | Meaning |
|------|-----------|---------|
| Success | `#16A34A` | In stock, up delta, paid, positive |
| Warning | `#F59E0B` | Low stock, pending, attention |
| Danger | `#EF4444` | Out of stock, overdue, destructive |
| Info | `#0EA5E9` | Informational, neutral status |

---

## 02 · Typography

Clean, modern and highly readable — **Poppins** for all text.

| Style | Size / Line | Weight |
|-------|-------------|--------|
| H1 | 32 / 40 | Bold (700) |
| H2 | 24 / 32 | SemiBold (600) |
| H3 | 18 / 28 | Medium (500) |
| Body | 14 / 22 | Regular (400) |
| Caption | 12 / 18 | Regular (400) |

Weights used: 400 Regular · 500 Medium · 600 SemiBold · 700 Bold.

---

## 03 · Navigation

A clean, **icon-first light sidebar** for seamless navigation.

- White sidebar, `#222222` foreground, line icons.
- Active item: soft `primary-100` pill with `primary-700` text + icon.
- Inactive: `brand-500` icon + label, hover lightens to `brand-50`.
- Brand lockup top (logo chip + "Filey"), bell + avatar inline.
- Storage card pinned bottom: usage donut, `XX% Used`, GB caption,
  "Upgrade Storage" ghost button.
- Quick-access icon row beneath the storage card.
- Sections: **Overview, Inventory, Orders, Invoicing, CRM,
  Suppliers, Purchase, Reports, Tools, Settings.**

### Topbar

`Search anything… ⌘K` field (left), notification bell with count badge,
and a user chip (avatar + name + role + chevron) on the right.

---

## 04 · Components

Reusable components for building a consistent UI.

- **Buttons:** Primary (filled `primary`, dark text), Secondary (soft
  `primary-100`), Ghost (border + transparent), Icon. States: Default,
  Hover (darken/tint), Disabled (`brand-200`).
- **Chips / Filters:** rounded-full, `brand-200` border, dropdown caret;
  active = `primary-100` fill.
- **Inputs:** rounded-`12px`, `brand-200` border, focus ring `primary`.
- **Badges (status):**
  - In stock / Paid / Active → `success`
  - Low stock / Pending → `warning`
  - Out of stock / Overdue → `danger`
  - Info / Neutral → `info`
- **Avatars:** circular, stacked groups with `+N` overflow.

---

## 05 · Cards

Cards give users a glimpse of information at a glance.

- White surface, **radius 16px**, soft shadow, `brand-200` border.
- Icon chip + label, large metric (`H2`/`H1`), delta row
  (`↑ 12.5% vs last month` in success/danger) and optional mini chart.
- Accent cards use a soft `primary → secondary` gradient on a warm
  neutral; dark feature cards use `#222222` with white text.

---

## 06 · Dashboard layout

- KPI stat row (Total Items, Suppliers, Low Stock, Storage) — each a
  card with icon chip + metric + delta.
- Orders summary card, delivery status card, recent-activity feed,
  stock breakdown, reorder spotlight, top low-stock list.
- Glanceable: every card answers one question without a click.

---

## 07 · Charts

Beautiful and easy to read: Line, Bar, Area, Donut, Progress ring.
Primary series = `primary-400`, gridlines `brand-200`, axis text
`brand-400`, soft gradient area fills (`primary → transparent`).

---

## 08 · Icons

Consistent, minimal, modern **line icons** (Lucide) with a consistent
stroke width.

---

## 09 · Design principles

1. **Clarity First** — every element serves a purpose.
2. **Glance, don't dig** — cards surface key info up front.
3. **Consistency Always** — same patterns, same behavior.
4. **Delight in Details** — small interactions, big impact.

---

## 10 · Spacing & Radius

8px-friendly system on a **4px base unit**.

- **Spacing scale (px):** 4, 8, 12, 16, 24, 32, 48, 64, 96
- **Border radius (px):** cards `16`, buttons `12`, pills `999`

---

## 11 · Tech stack

Tauri 2 · Vite · React 19 · TypeScript · Tailwind CSS · Recharts ·
React Router · Supabase.

---

## Implementation map (this repo)

| Spec | Where applied |
|------|---------------|
| Color tokens | `tailwind.config.js` (`primary`, `secondary`, `brand`, semantic) |
| Component styles | `src/index.css` (`btn-*`, `card`, `pill`, `chip`, `input`, table) |
| Poppins font | `index.html` + `tailwind.config.js` `fontFamily` |
| Light icon-first nav | `src/components/Layout.tsx` |
| Nav definition | `src/lib/apps.ts` |
| Card primitives | `src/components/ui.tsx` (`MetricCard`, `InfoCard`, `Card`) |
| Chart palette | `src/pages/Overview.tsx`, `src/pages/Reports.tsx` |
| Status badges | `src/components/ui.tsx` `Badge`, `statusTone` |
