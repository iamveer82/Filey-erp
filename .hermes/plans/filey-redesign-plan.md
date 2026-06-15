# Filey ERP — Full Redesign Plan

## 1. Problems identified
- Dashboard KPI cards overflow text when 6 columns on large screens (`grid-cols-6`). Labels like "Revenue (issued)" and values like "AED 1,234,567.89" get cut off.
- TrendChart is invisible / collapsed because CSS variables (`--chart-*`) are never defined.
- Current dashboard mixes too many sections; visual hierarchy is weak.
- Sidebar still uses basic Lucide icons instead of custom Odoo-style module icons.
- Cards use inconsistent padding/spacing; text alignment is off.
- No premium component polish (motion, blur fade, staggered lists, spotlight cards).

## 2. Goals
- Fix overflow: readable numbers and labels at every viewport.
- Restore and improve the orders trend chart.
- Replace generic Lucide icons with custom, unique SVG module icons (and svgl where useful).
- Adopt a professional dashboard layout inspired by Odoo/Linear: bento grid, KPI row, chart + activity, inventory alerts, money snapshot.
- Use selected 21st.dev components for premium feel without bloat: blur-fade, text-effect, spotlight card, shimmer button, animated gradient text.
- Keep minimal iOS design system: rounded-2xl cards, rounded-full CTAs, soft shadows, hairlines, no uppercase, no decorative glow.
- Preserve all data logic and avoid touching print templates.

## 3. Component selection from 21st.dev
Available components downloaded successfully:
- `shadcn/chart` → chart primitives with CSS variables (restore chart styling).
- `shadcn/card` → clean card primitives.
- `shadcn/badge` → refined badge variants.
- `shadcn/alert` → alert/empty-state styling.
- `magicui/blur-fade` → staggered entrance animations for dashboard sections.
- `motion-primitives/text-effect` → subtle animated page title.
- `magicui/animated-gradient-text` → accent headline (optional, use sparingly).
- `aceternity/hero-parallax` → too flashy; skip.
- `shadcn/data-table` → will be used later for table pages; not dashboard.

We will NOT use particle/sparkle/shimmer/spotlight decorative effects because they violate the minimal iOS constraint. We keep blur-fade and text-effect only for entrance polish.

## 4. Icon strategy
Custom SVG icon set (unique, Odoo-style line icons):
- `overview`, `inventory`, `orders`, `invoicing`, `quoting`, `customers`, `suppliers`, `purchase`, `reports`, `accounting`, `people`, `tools`, `settings`, `files`, `delivery`, `payment`, `declaration`, `cheque`, `bank`, `email`, `followups`, `low-stock`, `inventory-in`, `inventory-out`, `money`, `activity`, `empty`, `success`, `warning`, `danger`.

All icons are 48×48, 2.2px stroke, rounded caps, consistent visual weight. They will be consumed by `AppIcon` component.

## 5. Dashboard layout rebuild
### KPI row
- Change grid to `grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4` with taller cards.
- Each card: icon chip (40×40), label in one line, value in one line, no truncation. Use `text-sm` labels, `text-xl` values.
- Remove `MetricCard` from `ui.tsx` and replace with a new `DashboardMetric` component in `ModernOverview.tsx` for full control.

### Main row
- `lg:grid-cols-12 gap-4`
- Chart column: `lg:col-span-8` with fixed `h-[320px]` chart container.
- Activity column: `lg:col-span-4` with compact timeline list.

### Inventory + Money + Customer row
- `lg:grid-cols-3 gap-4`
- Inventory alerts: list with product icon + SKU + quantity chips.
- Money period: 3 metric rows + mini composition bar.
- Customer snapshot: 4 tiles in 2×2 grid using custom icons.

### Chart fix
Define CSS variables in `src/index.css` under `@layer base` / `:root`:
```
--chart-stroke: var(--color-primary-600);
--chart-fill-start: var(--color-primary-500);
--chart-fill-end: var(--color-primary-200);
--chart-fill-opacity-start: 0.35;
--chart-fill-opacity-end: 0.05;
--chart-grid: var(--color-brand-200);
--chart-tick: var(--color-brand-500);
--chart-tooltip-bg: var(--color-surface);
--chart-tooltip-border: var(--color-brand-200);
```
Ensure `TrendChart` wrapper has explicit height.

## 6. Sidebar module icons
Update `src/modules/registry.tsx` so each `AppModule.icon` is a custom SVG string rendered via `AppIcon` instead of a Lucide component. Because the registry currently expects a `LucideIcon` component, we will change the type to `ReactNode | LucideIcon` and render accordingly in `Layout.tsx`.

## 7. Page-by-page rollout
Priority order:
1. Dashboard (`ModernOverview.tsx`) — biggest impact.
2. Sidebar (`Layout.tsx` + `registry.tsx`) — consistent identity.
3. Core list pages (`Inventory`, `Customers`, `Invoicing`, `PurchaseOrders`, `Orders`, `Suppliers`) — replace page headers, metric cards, empty states with new icons and cleaner spacing.
4. Shared primitives (`ui.tsx`, `Card.tsx`) — align tokens.

## 8. Quality gates
- Run `npm run typecheck` after each file.
- Run `npm run build` and `npm test -- --run` before final commit.
- No new `console.log`.
- Keep print templates untouched.
- Avoid adding heavy dependencies beyond what already exists (framer-motion is already present).

## 9. Deliverables
- New icon assets in `src/assets/icons/`.
- Updated `AppIcon.tsx` with full icon map.
- Rewritten `ModernOverview.tsx` dashboard.
- Updated `Layout.tsx` sidebar rendering.
- Updated `modules/registry.tsx` icon types.
- CSS chart variables in `src/index.css`.
- Commit message: `design: full dashboard + module icon redesign`.
