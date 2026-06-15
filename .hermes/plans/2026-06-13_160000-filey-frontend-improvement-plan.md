# Filey ERP — Front-end & UX Improvement Plan

> **For Hermes:** Use `subagent-driven-development` to implement this plan task-by-task. Treat `src/pages/Invoicing.tsx`, `Quoting.tsx`, `PurchaseOrders.tsx`, `DeliveryChallan.tsx`, `PaymentReceipt.tsx`, `DeclarationLetter.tsx` print-template bodies as read-only; only redesign the surrounding chrome.

**Goal:** Turn the current functional-but-rough Filey ERP UI into a cohesive, user-friendly CRM/ERP front-end that is easy to scan, hard to break, and pleasant to use in both light and dark modes.

**Architecture:** Move from ad-hoc page implementations to a small, documented design system (`src/design-system/`). Refactor the largest pages into routed shells + isolated feature sections. Keep the existing React/Vite/Tailwind v4 stack; no framework changes.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Tailwind CSS 4, `lucide-react`, `recharts`, `framer-motion`, Radix primitives, `clsx`/`tailwind-merge`, `@number-flow/react`.

---

## Current State Snapshot

- **Pages:** 47 `src/pages/**/*.tsx`. Top offenders by size:
  - `src/pages/Invoicing.tsx` (~3,889 lines)
  - `src/pages/PurchaseOrders.tsx` (~2,260 lines)
  - `src/pages/Quoting.tsx` (~1,443 lines)
  - `src/pages/ModernOverview.tsx` (~894 lines)
- **Components:** 70+ files. Largest:
  - `src/components/PdfToolbox.tsx` (~1,706 lines)
  - `src/components/ui.tsx` (~1,263 lines)
  - `src/components/Layout.tsx` (~894 lines)
- **Design system:** Token work has started in `tailwind.config.js` and `src/index.css`, but radius/shadow usage is inconsistent across pages. Dark-mode chart colors are centralized via CSS variables, which is good.
- **Known pain points from recent sessions:**
  - Dashboard chart whitespace / card overflow issues.
  - `useModules` was throwing when used outside `ModulesProvider`.
  - Many pages still mix UI primitives inline instead of using `src/components/ui.tsx`.
  - Sidebar scroll and navigation density need refinement.

---

## Guiding Principles

1. **Consistency over novelty.** Reuse the same primitives everywhere rather than one-off styled blocks.
2. **Information density = useful density.** More whitespace where it helps grouping; compact where users compare data.
3. **At-a-glance first.** Numbers, statuses, and next actions must be scannable without interaction.
4. **Progressive disclosure.** Hide advanced controls behind "More" / accordion / secondary panels; keep primary flows obvious.
5. **Mobile-last but not mobile-never.** All primary flows must be usable on 1280px+ desktops first, then degrade gracefully to tablets and large phones.
6. **Protect document templates.** Print-template markup stays untouched; only chrome changes.

---

## Phase 1 — Consolidate the Design System (Foundation)

### Task 1.1: Audit current tokens and document decisions
**Objective:** Have a single source of truth for colors, radius, shadows, typography, and spacing.

**Files:**
- Read: `tailwind.config.js`, `src/index.css`, `src/components/ui.tsx`
- Modify: `src/index.css` (theme section), `tailwind.config.js`

**Steps:**
1. Read both files and list every custom color, radius, shadow, and font-size token currently in use.
2. Delete unused/one-off tokens (e.g., leftover `#3A3D45` references that were replaced).
3. Group tokens semantically:
   - `--color-canvas`, `--color-surface`, `--color-elevated`, `--color-border`, `--color-ink`, `--color-muted`
   - `--radius-pill`, `--radius-button`, `--radius-card`, `--radius-sheet`, `--radius-input`
   - `--shadow-card`, `--shadow-elevated`, `--shadow-float`
4. Verify no `bg-[#...]` hardcodes remain outside document templates.

**Verification:**
- `npx tsc --noEmit`
- `npm run build`
- Search for remaining `#[0-9A-Fa-f]{3,6}` inside `src/pages` (excluding print-template regions) and `src/components` should return only brand/semantic exceptions.

---

### Task 1.2: Build a typed component primitive library
**Objective:** Reduce the number of one-off className blocks by finishing the shared component set.

**Files:**
- Modify: `src/components/ui.tsx`
- Create: `src/components/primitives/` if `ui.tsx` becomes too large
  - `Button.tsx`, `Card.tsx`, `Input.tsx`, `Select.tsx`, `Badge.tsx`, `EmptyState.tsx`, `Loading.tsx`

**Steps:**
1. Extract the existing `Badge`, `InfoCard`, `Skeleton`, `ErrorBanner`, `Timeline*` primitives into standalone files.
2. Add missing primitives that appear inline on many pages:
   - `PageHeader` (title + actions + back link)
   - `SectionCard` (`InfoCard` without the forced header action)
   - `Stat` (label/value/hint with overflow-safe formatting)
   - `Toolbar` (search + filters + primary action)
   - `QuickFilter` (pill toggle group)
   - `StatusDot`
3. Add `cva` variants for `tone` and `size` so callers can't invent new colors.

**Verification:**
- Every new primitive has a small smoke test in `src/components/primitives/__tests__/*.test.tsx` using Vitest.
- `npm run test` passes (or create one minimal test if no tests exist yet).

---

### Task 1.3: Standardize dark-mode surfaces
**Objective:** Remove the last hardcoded dark surfaces and use semantic tokens.

**Files:**
- Modify: `src/index.css`, any `src/components/*.tsx` / `src/pages/*.tsx` still using `#1A1B1E`, `#2A2C33`, `#24262C`, `#3A3D45`

**Steps:**
1. Replace hardcoded dark hexes with CSS variables (`--surface`, `--surface-elevated`, `--border`).
2. Add a `dark-theme` class hook check: all pages should render correctly when `document.documentElement.classList.contains('dark')`.
3. Update `src/components/Layout.tsx` theme toggle to set the class on `<html>` and persist to `localStorage`.

**Verification:**
- Manual check: open `http://127.0.0.1:5173/` and toggle theme; no flashes of unstyled content, charts readable.

---

## Phase 2 — Navigation & Information Architecture

### Task 2.1: Restructure the sidebar
**Objective:** Make it easy to discover modules and collapse less-used items.

**Files:**
- Modify: `src/components/Layout.tsx`
- Read: `src/lib/modules.tsx`

**Steps:**
1. Add a "Favorites / Recent" section at the top of the sidebar based on navigation history (store last 5 routes in `localStorage`).
2. Group modules by category in collapsible sections:
   - **Sell:** Invoicing, Quoting, Customers, Orders
   - **Buy:** Purchase Orders, Suppliers, Expenses
   - **Stock:** Inventory, Products
   - **Money:** Bank Accounts, Cheques, Reports, Accounting
   - **Settings:** People, Apps, Company, Profile
3. Add a "pin" icon on each nav item to let users keep a module in the Favorites section.
4. Keep the existing scroll fix (`flex flex-col` on the `<aside>`) and add a scrollbar that matches the theme.

**Verification:**
- Sidebar renders all enabled modules.
- Collapse/expand state persists across reloads.
- No `useModules` errors on public portal / landing.

---

### Task 2.2: Add breadcrumbs and page context
**Objective:** Users always know where they are and how to get back.

**Files:**
- Create: `src/components/Breadcrumbs.tsx`
- Modify: `src/components/Layout.tsx`, `src/components/PageHeader.tsx` (or create it in `src/components/primitives/`)

**Steps:**
1. Build `Breadcrumbs` that reads `useLocation()` and maps known routes to human labels (`/invoicing → Invoices`, `/customers/:id → Customer` + customer name from route loader/data).
2. Render breadcrumbs inside `Layout` below the top bar on detail/edit pages.
3. Make `PageHeader` accept `title`, `subtitle`, `backTo`, `primaryAction`, `secondaryActions`, and a `badge` for status.
4. Apply `PageHeader` to list pages: `Customers.tsx`, `Suppliers.tsx`, `Inventory.tsx`, `Orders.tsx`, `Purchase.tsx`.

**Verification:**
- Navigate to `/customers/123`; breadcrumb shows `Customers / Customer`.
- Primary action is visible and reachable via keyboard.

---

### Task 2.3: Improve command palette discoverability
**Objective:** Turn the command palette into a real productivity shortcut.

**Files:**
- Modify: `src/components/CommandPalette.tsx`

**Steps:**
1. Show a visible keyboard hint (`Ctrl K`) in the top bar next to the search trigger.
2. Add default groups: "Go to…", "Create…", "Recent", "Help".
3. Add commands for the most common actions: New invoice, New customer, Go to dashboard, Toggle theme, Sign out.
4. De-duplicate module list logic with `src/lib/modules.tsx`.

**Verification:**
- Press `Ctrl+K`; palette opens.
- Typing "inv" surfaces Invoicing + New invoice.

---

## Phase 3 — Dashboard & Data Visualization

### Task 3.1: Make the dashboard a configurable overview
**Objective:** Let users see what matters to them without clutter.

**Files:**
- Modify: `src/pages/ModernOverview.tsx`
- Create: `src/components/dashboard/KpiCard.tsx`, `src/components/dashboard/TrendChart.tsx`, `src/components/dashboard/ActivityFeed.tsx`

**Steps:**
1. Extract `KpiTile`, `StockBar`, `Mini`, `Tile`, `MoneyRow` from `ModernOverview.tsx` into `src/components/dashboard/`.
2. Add a `KpiCard` variant with compact number formatting (k/M/B for large amounts) and a tooltip that shows the exact value on hover/focus.
3. Convert the "Orders over time" chart into `TrendChart` with a configurable `metric` prop (`orders`, `revenue`, `invoices`).
4. Add a small dashboard preferences panel (via localStorage) so users can hide/show KPI cards and choose the default period.
5. Move the AI summary card to the top-right and make it collapsible.

**Verification:**
- Large amounts (e.g., `AED 12,345,678.90`) display as `AED 12.3M` but exact value shown on hover.
- Chart fills card height (no dead space).
- Preferences persist across reloads.

---

### Task 3.2: Standardize charts across pages
**Objective:** All charts look like they came from the same app.

**Files:**
- Modify: `src/pages/Crm.tsx`, `src/pages/People.tsx`, `src/pages/Reports.tsx`, `src/components/FollowUps.tsx`
- Reuse: `src/components/dashboard/TrendChart.tsx`

**Steps:**
1. Replace hardcoded chart colors in `Crm.tsx`, `People.tsx`, `Reports.tsx`, `FollowUps.tsx` with the CSS variables defined in Phase 1.3.
2. Use `TrendChart` (or a `BarChart` variant) for recurring trend visualizations.
3. Add empty-state messages when a chart has no data instead of rendering a blank area.

**Verification:**
- All charts readable in dark mode.
- No console warnings from Recharts about duplicate gradient IDs.

---

## Phase 4 — Lists, Tables & Search

### Task 4.1: Build a universal data table
**Objective:** One consistent table component with sorting, selection, pagination, and bulk actions.

**Files:**
- Create: `src/components/DataTable.tsx`
- Modify: `src/pages/Customers.tsx`, `src/pages/Suppliers.tsx`, `src/pages/Inventory.tsx`, `src/pages/Orders.tsx`, `src/pages/Purchase.tsx`, `src/pages/Invoicing.tsx` (chrome only)

**Steps:**
1. Design `DataTable<T>` with column definitions:
   - `key`, `header`, `cell`, `sortable`, `width`, `align`
   - Optional row selection with a sticky bulk-action bar.
   - Built-in empty, loading, and error states.
2. Replace ad-hoc tables in the six list pages with `DataTable`.
3. Add keyboard navigation: arrow keys move focus; Enter opens the row.

**Verification:**
- Sorting works on numeric, currency, and date columns.
- Selecting rows shows a floating bulk-action bar.
- Empty state has a clear CTA.

---

### Task 4.2: Unified search + filter bar
**Objective:** Users can find records without learning each page's quirks.

**Files:**
- Create: `src/components/FilterBar.tsx`
- Modify: list pages above

**Steps:**
1. Build a `FilterBar` primitive:
   - Text search with debounced input.
   - Date range popover.
   - Status multi-select dropdown.
   - "Clear all" button.
2. Add an optional `QuickFilter` row for the most common status filters.
3. Persist the last filter state per page in `sessionStorage`.

**Verification:**
- Filter state clears when user clicks "Clear all".
- Debounced search does not refetch on every keystroke.

---

## Phase 5 — Forms & Document Workflows

### Task 5.1: Standardize form layouts
**Objective:** Forms feel predictable and reduce input errors.

**Files:**
- Modify: `src/pages/settings/*.tsx`, `src/pages/ProfileSetup.tsx`, `src/components/CustomFieldsManager.tsx`
- Reuse: `Input`, `Select`, `Textarea`, `Label` primitives

**Steps:**
1. Adopt a two-column form layout on desktop (`lg:grid-cols-2`) with clear section headings.
2. Add consistent helper text and inline validation messages under each field.
3. Use `react-hook-form` where not already used; add `zod` schemas for at least the settings forms.
4. Replace native `<select>` elements with the styled `Select` primitive.

**Verification:**
- Submitting an invalid settings form shows field-level errors.
- Forms are navigable via Tab key.

---

### Task 5.2: Improve document editor chrome
**Objective:** The area around invoice/quote/PO/LPO/receipt/declaration templates is clean and unobtrusive.

**Files:**
- Modify (chrome only): `src/pages/Invoicing.tsx`, `src/pages/Quoting.tsx`, `src/pages/PurchaseOrders.tsx`, `src/pages/DeliveryChallan.tsx`, `src/pages/PaymentReceipt.tsx`, `src/pages/DeclarationLetter.tsx`
- Create: `src/components/DocumentChrome.tsx`

**Steps:**
1. Extract a reusable `DocumentChrome` shell: title bar, status badge, action buttons (Save, Preview, Download, Send), and a tabbed side panel (Details / Notes / History).
2. Apply `DocumentChrome` to each document page, leaving the inner print-template `div` untouched.
3. Add a prominent "Send" primary action and a destructive "Delete/Draft" overflow menu.
4. Ensure the chrome is responsive: on narrow screens actions collapse into a `...` menu.

**Verification:**
- Print/PDF export still produces the same output as before.
- Chrome buttons are keyboard-accessible.

---

## Phase 6 — Feedback, Empty States & Loading

### Task 6.1: Replace generic spinners with contextual loading
**Objective:** Users understand what is loading and why.

**Files:**
- Create: `src/components/Loading.tsx`
- Modify: all list/detail pages

**Steps:**
1. Build three loading patterns:
   - `SkeletonList` — for tables/lists.
   - `SkeletonCard` — for dashboard cards.
   - `InlineSpinner` — for button/async actions.
2. Replace `FileyLoader` usage inside authenticated routes with page-specific skeletons.
3. Keep `FileyLoader` only for the initial app bootstrap.

**Verification:**
- Navigating between authenticated routes shows a skeleton, not the full-screen loader.

---

### Task 6.2: Add meaningful empty states
**Objective:** Empty screens guide the user to the next action.

**Files:**
- Create: `src/components/EmptyState.tsx`
- Modify: `src/pages/Customers.tsx`, `src/pages/Suppliers.tsx`, `src/pages/Inventory.tsx`, `src/pages/Orders.tsx`, `src/pages/MyFiles.tsx`

**Steps:**
1. Build `EmptyState` with illustration icon, title, description, and primary + secondary actions.
2. Apply it whenever `data.length === 0`.
3. Show contextual suggestions based on the current module (e.g., "Create your first invoice" on Invoicing, "Add a product" on Inventory).

**Verification:**
- Empty states have a clear primary CTA that navigates to the create flow.

---

### Task 6.3: Improve error handling
**Objective:** Errors are recoverable and not scary.

**Files:**
- Modify: `src/components/ErrorBoundary.tsx`, API hooks in `src/lib/api.ts` or query functions, list/detail pages

**Steps:**
1. Add a `retry` action to `ErrorBoundary` and `ErrorBanner`.
2. Convert API failures to toast messages with a "Retry" button using `sonner`.
3. Add network-offline detection: show a subtle banner when `navigator.onLine === false`.

**Verification:**
- Disconnect internet; a non-blocking offline banner appears.
- Reconnect; banner disappears and data refreshes.

---

## Phase 7 — Mobile & Accessibility

### Task 7.1: Responsive pass on major pages
**Objective:** Core flows work down to 768px without horizontal scroll.

**Files:**
- Modify: `src/components/Layout.tsx`, `src/pages/ModernOverview.tsx`, `src/pages/Customers.tsx`, `src/pages/Invoicing.tsx` (chrome)

**Steps:**
1. Collapse the sidebar into a bottom sheet on screens below `lg` instead of the current overlay drawer.
2. Convert multi-column KPI grids to 2-col on mobile.
3. Ensure document chrome action buttons collapse into a single "Actions" dropdown on mobile.
4. Add `min-w-0` / `overflow-hidden` to every flex parent that holds long text.

**Verification:**
- Use browser devtools responsive mode at 768px; no horizontal scroll on Customers list.

---

### Task 7.2: Accessibility basics
**Objective:** Meet WCAG 2.1 AA for keyboard navigation and screen-reader support.

**Files:**
- Modify: `src/components/ui.tsx`, `src/components/Dialog.tsx`, `src/components/Layout.tsx`, form pages

**Steps:**
1. Add `aria-label` / `aria-describedby` to icon-only buttons.
2. Trap focus inside open modals and side panels.
3. Ensure color contrast passes for `text-brand-500` on `bg-canvas` and `text-ink` on primary buttons.
4. Add skip-link to main content in `Layout`.

**Verification:**
- Run an automated a11y scan (e.g., `@axe-core/react` or Lighthouse) on Dashboard and Customers pages; no critical violations.

---

## Phase 8 — Performance & Quality

### Task 8.1: Code-split oversized pages
**Objective:** Initial bundle loads fast; heavy features are lazy.

**Files:**
- Modify: `src/App.tsx`, `src/pages/Invoicing.tsx`, `src/pages/PurchaseOrders.tsx`, `src/pages/Quoting.tsx`

**Steps:**
1. Lazy-load the document template preview components inside the large pages.
2. Split the PDF toolbox into per-tool chunks.
3. Add a `Suspense` boundary with a skeleton fallback for each lazy section.

**Verification:**
- `npm run build` does not exceed the default chunk warning for the main entry.

---

### Task 8.2: Add component-level tests
**Objective:** Prevent regressions in the primitives used everywhere.

**Files:**
- Create: `src/components/__tests__/Button.test.tsx`, `__tests__/DataTable.test.tsx`, `__tests__/PageHeader.test.tsx`
- Ensure: `vitest` is configured in `vite.config.ts` or `vitest.config.ts`

**Steps:**
1. Add tests for `Button`, `DataTable`, `PageHeader` rendering and interactions.
2. Add a visual regression test setup instruction using Playwright (or the existing `agent-browser` once its socket issue is fixed).
3. Run `npm test` in CI-style mode.

**Verification:**
- `npm test` passes with at least the new tests.

---

## Phase 9 — Polish & Final Verification

### Task 9.1: Run a full design audit
**Objective:** Catch visual inconsistencies before shipping.

**Steps:**
1. Open every route in the app in both light and dark modes.
2. Screenshot each route (use Playwright or a working browser daemon).
3. Compare screenshots against a checklist:
   - Buttons use the same radius/padding.
   - Card shadows/borders are consistent.
   - No orphaned truncation dots on numbers.
   - Chart axes readable.

**Verification:**
- A markdown audit report is saved to `.hermes/plans/frontend-audit-<date>.md` with before/after notes.

---

### Task 9.2: Final build & typecheck
**Objective:** Shipping code is clean.

**Commands:**
```bash
npx tsc --noEmit
npm run build
npm run test
npx prettier --check "src/**/*.{ts,tsx}"
```

**Expected:** All pass.

---

## Risks & Tradeoffs

- **Scope creep:** The large document pages are tempting to rewrite. Limit changes to chrome only; print-template bodies are off-limits.
- **Visual churn:** Users may need time to adapt. Provide the theme toggle and sidebar pinning so they can customize.
- **Bundle size:** Adding `cva`, `zod`, and lazy chunks is safe, but monitor `npm run build` output.
- **Browser daemon:** Per-route screenshots are currently blocked by the local `agent-browser` socket failure. Fix that separately or use Playwright for visual regression.

## Open Questions

1. Should the dashboard support drag-and-drop card reordering, or is a static preferences panel enough?
2. Does the user want a collapsed sidebar by default on desktop, or keep it expanded?
3. Are there existing analytics/telemetry requirements for measuring which modules are used most?

---

## Suggested First 3 Tasks to Execute

1. **Task 1.1** — Token audit/cleanup (unblocks every other phase).
2. **Task 2.1** — Sidebar restructure (biggest daily-impact UX win).
3. **Task 3.1** — Dashboard extraction + compact number formatting (directly addresses recent dashboard complaints).
