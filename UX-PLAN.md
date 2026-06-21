# Filey — UX Enhancement Plan (2026-06-20)

Written autonomously overnight. Items marked **[DONE]** were implemented + verified
(tsc + tests + build) tonight. Items marked **[PROPOSED]** are scoped but left for
review because they need visual judgment or change behavior — I didn't want to ship
unverifiable UI changes unattended.

## Shipped tonight

- **[DONE] Dark mode — bare `bg-white` islands.** Modals, dropdowns, popovers,
  sheets and panels using a raw `bg-white` (no `dark:` sibling) stayed blinding
  white in dark mode. Added a central unlayered remap in `index.css`
  (`.dark .bg-white → #24262C`, hover variant too), excluding the invoice/quote
  print sheet + paper texture (must stay white paper). Fixes ~57 files at once.
- **[DONE] Animated calendar** (earlier today) now the date popup app-wide; manual
  type + arrow on every date field.
- **[DONE] Accounting correctness** (earlier): double-entry contra legs, VAT split,
  COGS, repair tool, idempotent re-finalize.

## Proposed (need your eye / a decision)

### Tier 1 — high value, low risk
1. **Calendar palette → brand.** The new `FancyCalendar` self-themes black/white
   (its own palette), not Filey's slate/yellow. Map its palette vars to brand
   tokens so it matches the app. ~30 min, contained to `FancyCalendar.tsx`.
2. **Consistent empty states.** Audit list pages (Orders, Customers, Suppliers,
   Cheques, Bank Accounts) for a uniform `EmptyState` with icon + one-line hint +
   primary action. Some have ad-hoc text.
3. **Sticky table headers + zebra on long lists.** Inventory, Orders, Reports
   tables get hard to scan past ~20 rows. `.th` is styled; add `position: sticky`.
4. **Loading skeletons over spinners** on the data-heavy pages (Reports, Overview,
   Accounting) so layout doesn't jump.

### Tier 2 — workflow speed
5. **Keyboard: `n` to create** on each module (new invoice/order/PO/customer),
   `/` already focuses search, `⌘K` palette exists. Add per-page `n` shortcut.
6. **Inline row actions consistency.** Some lists use a kebab menu, some inline
   icons. Standardize on inline icon row (Edit/Share/Delete) like MyFiles.
7. **Document status as colored pills everywhere** (draft/sent/paid/overdue) —
   already in invoices; extend to quotes/POs lists for at-a-glance scanning.
8. **"Recently used" customers/products** at the top of pickers — cuts typing on
   repeat entry (the common ERP case).

### Tier 3 — polish
9. **Number formatting** — ensure AED amounts are tabular-nums + right-aligned in
   every table (mostly done; a few raw `<td>` lag).
10. **Toast affordances** — clickable toasts navigate to the relevant record
    (notifications already pass `to:`; extend success toasts on save → open record).
11. **Form autosave drafts** for long editors (invoice/quote) to localStorage so a
    crash/reload doesn't lose work.
12. **Reduce motion** respected globally — the gradient/calendar animations honor
    `prefers-reduced-motion`; audit the rest.

### Tier 4 — bigger bets (discuss first)
13. **Global "Quick create" (`⌘K` → New …)** that opens the right editor modal
    from anywhere.
14. **Dashboard customization persistence** already exists (card toggles) — extend
    to reorder.
15. **Onboarding checklist** for first run (company profile → first product →
    first invoice) to reduce empty-app friction.

## Notes
- Dark mode is now cohesive; if any specific screen still looks off, screenshot it
  and it's a 1-line fix (likely a hardcoded hex that needs a `dark:` sibling).
- I avoided sweeping visual rewrites unattended — everything above Tier 1 wants a
  human glance before shipping.
