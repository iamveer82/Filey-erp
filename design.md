# Filey — Design System (design.md)

> **This document is the source of truth for all UI work in this project.**
> It describes the Filey-DEMO design system ported across the app in v2.3.0
> (the "Emergent / Efferd" minimal reference). If a value is not specified
> here, derive it from the closest existing component (`src/pages/Quoting.tsx`
> and `src/pages/CustomerDetail.tsx` are the canonical house references).
>
> **Direction: minimal.** Quiet neutral (zinc) surfaces, one restrained amber
> accent, 13px working density, no decorative effects. The UI reads like a
> well-set ledger — nothing competes with the user's data.

---

## 0. Operating Rules

1. **Never** introduce colors, fonts, radii, shadows, or spacing values that are not defined here or in the token files.
2. **Always** use design tokens / shared primitives instead of hard-coded values.
3. **Typefaces:** Inter (`font-sans`, self-hosted variable font) everywhere. IBM Plex Mono (`font-mono`) for document numbers/code only. Lora (`font-serif`) only inside print document templates.
4. **Icons:** Lucide React only, 1.75px stroke (set globally in index.css), sizes 15px (sidebar), 16–20px elsewhere.
5. **Amber accent** (`primary-*` ramp, `primary-400 #fbbf24` ≈ amber-400) is for primary CTAs and small key highlights. Never body text on light surfaces, never large fills.
6. **No decorative effects.** Banned: gradients (background or text), glows, shimmer, spotlight/tilt cards, parallax, glassmorphism. The only gradient allowed is inside recharts (accent bar/area fills) and the neutral avatar disc.
7. **Motion budget:** color transitions ≤200ms; route enter = `.fade-in` (opacity + 4px rise, 250ms); overlay enter = `.materialize-*` (opacity + ≤3% scale + ≤6px translate, ≤200ms, one-shot). No hover movement (no scale/lift), no springs, no loops. `prefers-reduced-motion` collapses transforms to fades. Exception: buttons may press to `scale(0.97)` on `:active`.
8. Dark mode is supported (`.dark` class); every surface needs a working dark variant — use token classes and you get it for free.

---

## 1. Tokens (src/index.css + tailwind.config.js)

All surfaces/text resolve through HSL CSS variables, flipped by the `.dark`
class. **Use token classes, never raw hex/gray utilities:**

| Class | Token | Role |
| --- | --- | --- |
| `bg-background` / `text-foreground` | `--background` / `--foreground` | Page canvas / primary text |
| `bg-card` | `--card` | Cards, tables, modals, popovers |
| `bg-sidebar` | `--sidebar` | App sidebar surface |
| `bg-hover` | `--hover` | Hover film, active nav, quiet fills |
| `bg-muted` / `text-muted-foreground` | `--muted` / `--muted-foreground` | Quiet fills / secondary text |
| `border-border` / `bg-input` / `ring-ring` | `--border` / `--input` / `--ring` | Hairlines / field borders / focus |
| `primary-50…900` | amber ramp | Accent CTA + tints |
| `success #3FB984`, `warning #F59E0B`, `danger #E5484D`, `info #0EA5E9` | status only — badges, deltas, semantic icons; never decoration |

Legacy aliases (`brand-*`, `ink`, `surface`, `canvas`, `hairline`) resolve onto
the same tokens and keep working; prefer token classes in new code.

## 2. Typography & layout metrics

- Page title (PageHeader): 22px / semibold / tracking-tight; subtitle 13px muted.
- Card title 14px semibold; card subtitle 12.5px muted.
- Body/table data 13px; captions/meta 11.5–12px muted. Tabular numbers for data (`tabular-nums` on `.td`).
- Page gutter comes from the Layout route container (`px-4 sm:px-6 py-6`) — pages do not add their own outer padding.
- Sidebar 248px; section labels 11.5px muted; nav items 13.5px with 15px icons; active = `bg-hover` + `font-medium` (no amber).
- Header h-14: sidebar toggle, divider, page title, ⌘K search (260px), theme toggle, notifications, account avatar.
- Radii: `rounded-md` (6px) buttons/inputs/chips, `rounded-xl` (12px) cards/modals, `rounded-full` pills/avatars only.

## 3. Theme & accent system

- Light/dark via `getTheme/setTheme` (`src/lib/theme.ts`), persisted `theme`, applied as `.dark` on `<html>`; defaults to OS preference.
- 7 user accents (`src/lib/accent.ts`: amber/blue/emerald/rose/violet/sky/slate), persisted `filey-accent`, applied as `data-accent` on `<html>`. Picked in **Settings → Appearance** (swatch grid).
- **All recharts must use `useChartColors()`** from `lib/accent.ts` (theme+accent aware: `accent`, `accentSoft`, `primary`, `grid`, `axis`, `tooltip*`). No hardcoded chart hexes.

## 4. Component classes (index.css) & primitives (components/ui.tsx)

- Buttons (all h-8, rounded-md, 13px font-medium): `.btn-primary` (amber, neutral-900 text), `.btn-secondary` (ink), `.btn-ghost` (card + hairline), `.btn-danger`. `active:scale-[0.97]`; disabled halves opacity.
- Forms: `.input` / `.select` (h-9), `.textarea`, `.label` (12px muted), `.help`, `.error-text`; quiet focus = border darkens to muted-foreground.
- Surfaces: `.card` (rounded-xl border bg-card p-5); `.card-hover` (border-lift hover only).
- Tables: `.th` (12px, muted, px-5 py-2.5, hairline bottom) / `.td` (13px, px-5 py-3, hairline top) / `.row-hover` (bg-hover film).
- Joined grids: `.joined-kpis` on a grid wrapper — cells share hairlines inside one rounded-xl border (KPI strips, tool grids, chart cards).
- Chips/filters: `.chip` / `.chip-active`, `.pill`; `FilterChip` + `SearchInput` primitives.
- Shared React primitives (`src/components/ui.tsx`): `PageHeader`, `Card`, `MetricCard`, `InfoCard`, `DataTable` (sort/bulk/inline-edit/empty/skeleton), `Modal` (focus-trapped), `FormField`, `EmptyState`, `Skeleton`, `Spinner`, `ErrorBanner`, `Badge` + `statusTone()`, `SectionBox`, `ToggleTile`, `PageSection`.
- Row-level record actions (`src/components/RowActions.tsx`): `RowActions` (quick view / edit / duplicate / send menu: WhatsApp·email·SMS·copy-link / delete under "More"), `QuickViewModal` (title + status Badge + meta grid + line items + total + notes), `shareVia()`.

## 5. The list-page pattern (canonical: Quoting.tsx)

Every index/list page composes the same anatomy:

1. `PageHeader` — title + 13px subtitle + right-aligned actions (ghost utilities + one amber primary CTA).
2. Optional joined KPI strip (`.joined-kpis` + `MetricCard`).
3. Toolbar: `SearchInput` + `FilterChip`s with live counts.
4. `DataTable` with an **Actions** column: page-specific primary action(s) + `RowActions` (quick view → `QuickViewModal`, edit → the page's real editor, duplicate via the real create flow, send menu with real portal link/contact data, delete behind `confirm({ danger: true })`).
5. `QuickViewModal` wired to real record fields; its Edit button routes into the page's real editor.
6. All four states: `Skeleton`/loading prop, `EmptyState`, `ErrorBanner`/toast, busy-disabled buttons.

Numbers must always be real: KPI deltas compare against a real previous
period; if no real baseline exists, show hint text only — never invent %.

## 6. Accessibility

- Text contrast ≥ 4.5:1. Amber is never small text on light surfaces.
- `:focus-visible` ring 2px `ring-primary-400` + 2px offset — never removed.
- Icon-only buttons require `aria-label`; hit targets ≥ 40×40px (row-action icon buttons are 28px inside ≥44px rows — keep the row clickable).
- All interactives are real `<button>`/`<a>`; Esc closes overlays; overlays trap focus (use `Modal`).

## 7. App modules

Sidebar groups (Layout `MODULE_GROUPS`): Assistant (Filey AI) · Business
(Overview, Reports) · Sales (Orders, Invoicing, Quoting, CRM, Customers,
Follow-ups) · Purchases (Suppliers, Purchase, Purchase Orders) · Inventory ·
Accounting (People, Accounting, Bank Accounts, Cheques, Payment Receipts,
Declaration) · Tools (Tools, Files, Email Templates, Delivery Challans) ·
System (Settings, Integrations). Modules are gated by `useModules()` and
managed in Settings → Apps & Modules.

## 8. Print / PDF (do not touch)

`.invoice-print`, `.fp-box`, `.fp-frame`, `.paper-texture` and the
`@media print` block in `index.css` drive invoice/quote PDF output and are
exempt from theme rules — documents keep their own letterhead styling.
Document templates live in `src/components/DocTemplates.ts` (incl. UAE FTA
Tax Invoice variants) and render through `DocView.tsx`; new templates are
additive registrations there.

## 9. Definition of Done (every screen)

- [ ] Token classes and shared primitives only — no raw hex or one-off metrics.
- [ ] All four states implemented (loading / empty / error / busy).
- [ ] No banned effects (rule 0.6); motion within budget (rule 0.7).
- [ ] Dark mode verified.
- [ ] Every number real; deletes behind `confirm({ danger: true })`.
- [ ] Keyboard + screen-reader basics: focus order, labels, Esc closes overlays.
- [ ] `npx tsc --noEmit` clean; page smoke tests pass.
