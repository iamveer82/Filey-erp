# Filey — Design System (design.md)

> **This document is the source of truth for all UI work in this project.**
> Updated 7 September 2026 against `src/index.css`, `tailwind.config.js`,
> `src/components/Button.tsx` and `src/components/ui.tsx`. These shared
> primitives define the current desktop workspace. If a value is not specified
> here, reuse the closest shared component before adding a page-specific style.
>
> **Direction: minimal.** Warm white and charcoal surfaces, Filey yellow as the
> default accent, 13px working density, no decorative effects. The UI reads like a
> well-set ledger — nothing competes with the user's data.

---

## Design guidance

Use [Taste Skill](https://github.com/Leonxlnx/taste-skill) alongside Impeccable, as requested by the user. The installed `design-taste-frontend` skill matches upstream as checked on 6 September 2026. Apply its audit-first preservation, consistent colors and shapes, readable controls, responsive layout and accessibility guidance within Filey's existing design system.

Taste's current scope emphasizes landing pages and explicitly excludes dense dashboards, tables and multi-step product UI. Use its marketing-specific composition rules on Filey's public-facing pages; use Impeccable and the shared Filey primitives for ERP/CRM workflows. Preserve Inter, the selected accent, semantic status colors, compact working density and restrained motion. Filey's contextual settings are `DESIGN_VARIANCE: 3`, `MOTION_INTENSITY: 2`, `VISUAL_DENSITY: 7`.

## 0. Operating Rules

1. **Never** introduce colors, fonts, radii, shadows, or spacing values that are not defined here or in the token files.
2. **Always** use design tokens / shared primitives instead of hard-coded values.
3. **Typefaces:** Inter (`font-sans`, self-hosted variable font) everywhere. IBM Plex Mono (`font-mono`) for document numbers/code only. Lora (`font-serif`) only inside print document templates.
4. **Icons:** Lucide React only, 1.75px stroke (set globally in index.css), sizes 15px (sidebar), 16–20px elsewhere.
5. **Filey yellow** is the default accent (`amber` remains its saved key). Use the `primary-*` ramp for primary CTAs and small key highlights. Never use bright accent colors for body text on light surfaces or large decorative fills. A user's selected accent replaces the default across shared controls and charts.
6. **No decorative effects.** Banned: gradients (background or text), glows, shimmer, spotlight/tilt cards, parallax, glassmorphism. The only gradient allowed is inside recharts (accent bar/area fills) and the neutral avatar disc.
7. **Motion budget:** color transitions ≤200ms; route enter = `.fade-in` (opacity + 4px rise, 250ms); overlay enter = `.materialize-*` (opacity + ≤3% scale + ≤6px translate, ≤200ms, one-shot). No hover movement (no scale/lift), no springs, no loops. `prefers-reduced-motion` collapses transforms to fades. Exception: buttons may press to `scale(0.97)` on `:active`.
8. Dark mode is supported (`.dark` class); every surface needs a working dark variant — use token classes and you get it for free.

---

## 1. Tokens (src/index.css + tailwind.config.js)

All surfaces/text resolve through HSL CSS variables, flipped by the `.dark`
class. **Use token classes, never raw hex/gray utilities:**

| Class | Token | Role |
| --- | --- | --- |
| `bg-page` | `--page` | Warm white / charcoal ground behind page content |
| `bg-background` / `text-foreground` | `--background` / `--foreground` | Base surface / primary text |
| `bg-card` | `--card` | Cards, tables, modals, popovers |
| `bg-sidebar` | `--sidebar` | App sidebar surface |
| `bg-hover` | `--hover` | Hover film, active nav, quiet fills |
| `bg-muted` / `text-muted-foreground` | `--muted` / `--muted-foreground` | Quiet fills / secondary text |
| `border-border` / `border-input` / `ring-ring` | `--border` / `--input` / `--ring` | Hairlines / field borders / focus |
| `primary-50…900` | `--primary-50…900` | Selected accent CTA + tints |
| `success`, `warning`, `danger`, `info` | Theme-specific HSL variables | Status only: badges, measured deltas and semantic icons |

Current surface values are HSL triples, consumed as `hsl(var(--token))`:

| Token | Light | Dark |
| --- | --- | --- |
| `--page` | `45 15% 97%` | `0 0% 4%` |
| `--background` / `--card` | `0 0% 100%` / `0 0% 100%` | `0 0% 4%` / `0 0% 6%` |
| `--sidebar` | `45 12% 98%` | `0 0% 5%` |
| `--foreground` | `240 10% 3.9%` | `0 0% 93%` |
| `--muted-foreground` | `240 4% 42%` | `0 0% 62%` |
| `--border` / `--input` | `240 5.9% 90%` | `0 0% 15%` |
| `--hover` / `--muted` | `240 4.8% 95.9%` | `0 0% 10%` |

The default CSS accent uses `--p-h: 45`, `--p-s: 96%` and
`--p-l400: 54%`; `--primary-400` combines those values. The Filey yellow
swatch and chart palette in `src/lib/accent.ts` use `#faca1a`, with
`#fdd86a` as the soft color. Reuse these sources; do not copy the old
Tailwind amber hex into a new component.

Legacy aliases (`brand-*`, `ink`, `surface`, `canvas`, `hairline`) resolve onto
the same tokens and keep working; prefer token classes in new code.

## 2. Typography & layout metrics

- Page title (`PageHeader`): 24px / semibold / leading-tight / tracking-tight; subtitle 13px muted with a 4px top gap. Actions wrap inside the heading row on narrow screens.
- Card title 14px semibold; card subtitle 12.5px muted.
- Body/table data 13px; captions/meta 11.5–12px muted. Tabular numbers for data (`tabular-nums` on `.td`).
- Page gutter comes from the Layout route container (`px-4 sm:px-6 pt-6 pb-16`) — pages do not add their own outer padding. The extra bottom space keeps the final row and pagination reachable.
- Sidebar 248px; section labels 11.5px muted; nav items 13.5px with 15px icons; active = `bg-hover` + `font-medium` (no amber).
- Header h-16: sidebar toggle, divider, page title, ⌘K search (260px), theme toggle, notifications, account avatar.
- Settings uses horizontally scrollable section tabs with keyboard navigation, URL state and preserved unsaved panel drafts. The user prefers this to a second vertical sidebar. Appearance uses aligned, divided rows.
- Keep the existing 48px animated BloubBot beside Filey AI in the sidebar. This requested brand detail is an exception to standard Lucide navigation icons; preserve its reduced-motion and hidden-view behavior.
- Radii: `rounded-full` for buttons, filter chips and avatars; explicit `rounded-[8px]` for shared inputs/selects/textareas; `rounded-xl` (12px) for cards/modals. Do not substitute `rounded-lg` for an 8px field: the current Tailwind configuration maps `lg` to 10px. Pill buttons are the user's explicit preference; square icon buttons become circles, and joined calendar ranges keep flat inner edges.

## 3. Theme & accent system

- Light/dark via `getTheme/setTheme` (`src/lib/theme.ts`), persisted `theme`, applied as `.dark` on `<html>`; defaults to OS preference.
- 7 user accents (`src/lib/accent.ts`: amber/blue/emerald/rose/violet/sky/slate), persisted `filey-accent`, applied as `data-accent` on `<html>`. The default `amber` key is labeled **Filey yellow**. Picked in **Settings → Appearance** (labelled pill swatches).
- **All recharts must use `useChartColors()`** from `lib/accent.ts` (theme+accent aware: `accent`, `accentSoft`, `primary`, `grid`, `axis`, `tooltip*`). No hardcoded chart hexes.

## 4. Component classes (index.css) & primitives (components/ui.tsx)

- `Button`/`buttonVariants` delegate to the same `.btn-*` classes as native buttons; `outline` and `ghost` both use the bordered card treatment. Keep actions pill-shaped, and use `.chip` for filters and selection.
- Standard action buttons are 40px high (`h-10`), pill-shaped, with 13px medium text: `.btn-primary` (selected accent, neutral-900 text), `.btn-secondary` (foreground), `.btn-ghost` (card + hairline), `.btn-danger` (semantic destructive color). `Button` defaults to `md` (40px); its icon size is 40×40px, `lg` is 44px and the explicit compact `sm` variant is 28px. Keep compact controls contextual; do not shrink ordinary form and toolbar actions. Authentication actions keep their 44px height and pill shape. Press feedback is `scale(0.97)` over 140ms, disabled opacity is 50%, and reduced motion removes the press transform.
- Calendars inherit the app font, root theme and selected accent. No independent OS-theme observer, gradients, glass or hover lift. Popovers fit the viewport.
- Forms: `.input` / `.select` are 40px high (`h-10`) with 8px corners, card fill, 13px text and 12px horizontal padding. `.textarea` shares the 8px radius and has an 88px minimum height; `.label` is 12px muted. Use `.help` and `.error-text`; focus darkens the border while visible keyboard focus remains available.
- Surfaces: `.card` (12px radius, card fill, 20px padding) has a 1px edge matching the card fill. The tinted page ground separates cards; `.card-hover` reveals the border on hover without movement.
- Tables: `.th` (12px, muted, px-5 py-2.5, hairline bottom) / `.td` (13px, px-5 py-3, hairline top) / `.row-hover` (bg-hover film).
- KPI grids: the legacy `.joined-kpis` name now supplies a 12px gap (`gap-3`) between cards. Preserve that separated layout instead of rebuilding a zero-gap shared-border strip.
- Chips/filters: `.chip` / `.chip-active` use neutral selection, pill corners and keyboard focus rings. `FilterChip` shares these classes; `.pill` is reserved for badges. `SearchInput` shares `.input` and has an accessible name.
- Descriptive metric metadata defaults to muted text; reserve green/red/amber for explicit measured changes or statuses.
- Shared React primitives (`src/components/ui.tsx`): `PageHeader`, `Card`, `MetricCard`, `InfoCard`, `DataTable` (sort/bulk/inline-edit/empty/skeleton), `Modal` (focus-trapped), `FormField`, `EmptyState`, `Skeleton`, `Spinner`, `ErrorBanner`, `Badge` + `statusTone()`, `SectionBox`, `ToggleTile`, `PageSection`.
- Row-level record actions (`src/components/RowActions.tsx`): `RowActions` (quick view / edit / duplicate / send menu: WhatsApp·email·SMS·copy-link / delete under "More"), `QuickViewModal` (title + status Badge + meta grid + line items + total + notes), `shareVia()`.

## 5. The list-page pattern (canonical: Quoting.tsx)

Every index/list page composes the same anatomy:

1. `PageHeader` — title + 13px subtitle + right-aligned actions (ghost utilities + one amber primary CTA).
2. Optional KPI grid (`.joined-kpis` + `MetricCard`, with 12px gaps).
3. Toolbar: `SearchInput` + `FilterChip`s with live counts.
4. `DataTable` with an **Actions** column: page-specific primary action(s) + `RowActions` (quick view → `QuickViewModal`, edit → the page's real editor, duplicate via the real create flow, send menu with real portal link/contact data, delete behind `confirm({ danger: true })`).
5. `QuickViewModal` wired to real record fields; its Edit button routes into the page's real editor.
6. All four states: `Skeleton`/loading prop, `EmptyState`, `ErrorBanner`/toast, busy-disabled buttons.

Numbers must always be real: KPI deltas compare against a real previous
period; if no real baseline exists, show hint text only — never invent %.

Settings use `SettingsPanel` and `SettingsSection`: one divided surface per tab, with a 200px label/description column and flexible controls on large screens, stacked on smaller screens. Use the stacked variant for tables and logs. Keep actions at the end of their section, and make automatic saving explicit. Horizontal pill tabs wrap on desktop and scroll on narrow screens; visited panels stay mounted to preserve unsaved fields. Use flat rows for modules, notifications and account actions. Provider selection uses a grouped native select; advanced connection fields remain available in a disclosure.

## 6. Accessibility

- Text contrast ≥ 4.5:1. Amber is never small text on light surfaces.
- `:focus-visible` ring 2px `ring-primary-400` + 2px offset — never removed.
- Icon-only buttons require `aria-label`; ordinary action targets are at least 40×40px. Explicit compact row controls must remain keyboard-operable and have a sufficiently spaced clickable area; a clickable row alone does not replace access to its individual actions.
- Label every input, including each control in a combined field. Repeated invoice/quotation fields use meaningful names with the line number; placeholders alone are not labels. `SearchInput` provides an accessible name.
- All interactives are real `<button>`/`<a>`; Esc closes overlays; overlays trap focus (use `Modal`).

## 7. App modules

Sidebar groups (Layout `MODULE_GROUPS`): Assistant (Filey AI) · Business
(Overview, Reports) · Sales (Orders, Invoicing, Quoting, CRM, Customers,
Follow-ups, Marketing) · Purchases (Suppliers, Purchase, Purchase Orders,
Purchase Invoices) · Inventory · Accounting (People, Accounting, Bank
Accounts, Cheques, Payment Receipts, Declaration) · Service (Projects,
Helpdesk) · Team (Team, Comms) · Tools (Tools, Files, Email Templates,
Delivery Challans) · System (Settings, Integrations). Modules are gated by `useModules()` and
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
