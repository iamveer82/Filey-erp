# Filey ERP — Ultimate Front-End Improvement Plan

Built from three skills:
1. `emilkowalski/skill` (`emil-design-eng`) — UI craft, animation taste, Before/After/Why reviews.
2. `pbakaus/impeccable` — 23-command design language (shape, audit, polish, layout, typeset, colorize, animate, harden, critique).
3. `leonxlnx/taste-skill` (`design-taste-frontend` + `redesign-existing-projects` + `high-end-visual-design`) — anti-slop brief inference, variance/motion/density dials.

## Design Read

- **Page kind:** B2B ERP dashboard + data tables + multi-step forms + print previews.
- **Audience:** Owner/operator of a UAE manufacturing business; needs numbers at a glance, fast invoicing/inventory/order flows.
- **Visual language:** iOS-like pill minimal, neutral surfaces, Filey yellow brand accent, one allowed gradient (ColorOrb per explicit user exception).
- **Motion approach:** Restrained, purposeful, desktop-first with responsive safety.
- **Stack:** React + Vite + TypeScript + Tailwind + Framer Motion + Radix. No Next.js. No `class-variance-authority`.

**Dial settings for Filey**
| Dial | Value | Why |
|------|-------|-----|
| `DESIGN_VARIANCE` | 4 | ERP needs predictable grids, not artsy chaos. |
| `MOTION_INTENSITY` | 3 | Data work is repeated; animation must not slow decisions. |
| `VISUAL_DENSITY` | 6 | Dense tables and forms, but airy cards for KPIs. |

## Phase 0 — Baseline with the skills

### 0.1 Install / load the skills
- `npx skills add emilkowalski/skill`
- `npx skills add https://github.com/pbakaus/impeccable`
- `npx skills add https://github.com/leonxlnx/taste-skill`
- Pin the ones you use most: `/impeccable audit`, `/impeccable polish`, `redesign-existing-projects`.

### 0.2 Run `/impeccable document`
Generate a root `DESIGN.md` from existing code so every future redesign pass has a single source of truth.

### 0.3 Run `/impeccable audit` on every page
Detect anti-patterns: generic gradients, missing active states, low-contrast text, inconsistent spacing, uppercase labels, broken hierarchy.

### 0.4 Inventory of components
List every shared primitive in `src/components/ui.tsx` and map which pages still use one-off styling. Goal: **one component, one behavior**.

## Phase 1 — Design tokens & primitives

### 1.1 Tailwind config hardening
- Confirm `shadow-bento`, `rounded-2xl`, `rounded-full`, `border`/`border-border` tokens exist.
- Add `ease-out-filey`, `ease-in-out-filey`, `duration-fast`, `duration-normal` tokens so animations use custom curves, not built-in `ease-in`.
- Ban `uppercase`, `tracking-widest`, `font-mono` for labels (user rule).

### 1.2 `src/components/ui.tsx` cleanup
- Consolidate button variants: only `rounded-full`, regular weight, no uppercase.
- Consolidate cards: `rounded-2xl`, subtle bento shadow on hover only, hairline border.
- Consolidate inputs: consistent focus ring, height, radius, placeholder color.
- Add missing primitives: `Skeleton`, `Switch`, `Avatar`, `CommandPalette` (later), `DatePicker`.
- Delete any unused variants to reduce decision fatigue.

### 1.3 ColorOrb sync
Keep the animated conic gradient orb (user exception). Ensure it reads the brand color from Settings and stays performant (GPU layer, `will-change`).

### 1.4 Typography scale
Lock heading/text scale to 6 sizes max. Use regular (400) and medium (500) only. No bold page titles unless they are actual KPI numbers.

## Phase 2 — Layout & information hierarchy

### 2.1 Overview / dashboard
- Already modernized. Next: run `/impeccable polish`.
- Add “time range” switcher to KPIs (Today / This month / This quarter) so numbers stay glanceable.
- Use `high-end-visual-design` for the money/composition card: softer contrast, clearer callouts.
- Ensure all 5 KPI values are single-line, never truncated.

### 2.2 Inventory
- Finish the filter bar: `SearchInput` + `FilterChip` pattern (already added).
- Apply `redesign-existing-projects`: audit spacing, align table header with card header, add bulk-action bar.
- Add low-stock/out-of-stock visual indicators with Filey yellow / red accent, not badges-only.

### 2.3 Orders
- Complete status `FilterChip` row (already added).
- Add quick-view slide-over for order detail instead of full-page navigation.
- Use `emil-design-eng` active-state rule on every row action button.

### 2.4 Invoicing
- Already added configurable item columns and manual unit entry. Next:
  - Bold item description **only** in print/preview (done in code; verify).
  - Reorder columns via drag-and-drop using `@dnd-kit/sortable`.
  - Save column layout to `invoice_docs.custom_columns` (schema applied).
  - Add a compact “Items config” popover to show/hide/reorder columns.

### 2.5 CRM & settings
- Apply `layout` command: settings forms currently have inconsistent widths; standardize to a single 640 px max-width column with sections.
- Add sticky section nav on long settings pages.

## Phase 3 — Motion & micro-interactions

Apply the `emil-design-eng` animation framework rigorously.

### 3.1 Animation decision matrix
| Interaction | Frequency | Decision |
|-------------|-----------|----------|
| KPI number change | rare | 200 ms ease-out count-up |
| Page enter | once per session | 180 ms fade-up |
| Card hover | often | 150 ms `translateY(-2px)` + shadow, or none |
| Table row hover | very often | no transform; only background-color 100 ms |
| Button press | very often | `:active scale(0.97)` 100 ms |
| Modal/drawer | occasional | 250 ms ease-out |
| Filter chip toggle | often | 150 ms background + border |

### 3.2 Replace default `ease-in` and `ease` with custom curves
```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```
Map to Tailwind: `transition-[transform,opacity] duration-200 ease-out-filey`.

### 3.3 Springs only where needed
- Use Framer `useSpring` only for the ColorOrb mouse-follow (if added) or drag-to-reorder.
- Avoid springs on repeated interactions.

### 3.4 `:active` states
Every interactive element (button, chip, row action) must have a visible `:active` state.

## Phase 4 — Data density & tables

### 4.1 `DataTable` hardening
- Add sticky headers.
- Add column resize (optional).
- Add empty-state illustrations that match Filey brand.
- Add row hover action menu to reduce visual clutter.

### 4.2 Filters everywhere
Reuse `SearchInput` + `FilterChip` from `ui.tsx` on Inventory, Orders, Invoicing, CRM, Files.

### 4.3 Pagination / infinite scroll
- Keep table compact; add pagination if rows > 50.
- Use skeletons, not spinners, for table loading.

## Phase 5 — Forms & inputs

### 5.1 Settings forms
- One column, generous vertical rhythm, section cards with hairline borders.
- Save button always bottom-right, sticky on mobile.
- Inline validation, never blocking submit until touched.

### 5.2 Invoicing item editor
- Manual unit dropdown or free-text with common presets (pcs, kg, ltr, set, box).
- Column config popover: visible columns + drag-to-reorder + reset defaults.
- Live total row that animates value changes.

### 5.3 CRM customization
Use the new `custom_entity_fields` + `custom_entity_values` tables:
- Allow users to add custom fields to Customers and Leads.
- Render fields dynamically in CRM forms and detail views.

## Phase 6 — Print / PDF chrome

- Per user rule: **do not redesign print templates**, only editor chrome.
- Improve the print preview chrome: toolbar, zoom toggle, page thumbnails.
- Keep the bold item description rule in preview only.

## Phase 7 — Edge cases & shipping polish

### 7.1 Accessibility
- Focus rings on every focusable.
- `prefers-reduced-motion`: disable all transforms and fades.
- Color contrast for Filey yellow on white: use darker yellow text or darker surface.

### 7.2 Error / empty states
- Replace generic loaders with contextual empty states (already started in Overview).
- Use `harden` command to cover no-data, no-search-results, offline, permission-denied.

### 7.3 Responsive
- Desktop primary; tablet wrap; mobile stack cards and hide non-essential columns.

### 7.4 Detector gates
Before marking any phase done, run `/impeccable audit` on changed files. Fix:
- uppercase text
- missing active states
- `ease-in` on UI animations
- `transition: all`
- generic gradients
- low contrast

## How to use the skills during execution

1. **Before starting a phase:** run `/impeccable shape <page>` to plan UX.
2. **During implementation:** keep `taste-skill` dials in the prompt header (VARIANCE 4 / MOTION 3 / DENSITY 6).
3. **After implementation:** run `/impeccable polish <page>` and `/impeccable audit <page>`.
4. **For any animation:** consult `emil-design-eng` Before/After/Why table.
5. **For reviews:** present changes in `| Before | After | Why |` format.

## Success metrics

- `npx tsc --noEmit` = 0 errors.
- `npm run build` succeeds.
- Lighthouse a11y score ≥ 90.
- No `ease-in` in animation code except for special marketing sections.
- No `uppercase`/`tracking-widest` on labels.
- All KPI values visible at a glance without truncation.
- Customer data untouched (presentation only).

## Immediate next steps

1. Run `/impeccable document` → write `DESIGN.md`.
2. Run `/impeccable audit` on `src/pages/ModernOverview.tsx`, `src/pages/Inventory.tsx`, `src/pages/Orders.tsx`, `src/pages/Invoicing.tsx`.
3. Apply Phase 1 tokens/primitives.
4. Then tackle Invoicing column drag-and-drop and CRM custom fields.
