# Filey Mobile

The phone companion to the Filey desktop ERP — React + Vite + Tailwind 4,
wrapped for iOS/Android with Capacitor. **It imports the desktop app's entire
brain** (`../src/lib`: API, auth, agent, formats, tax regimes) through the
`@shared` alias, so business logic is written once.

## Run it

```bash
cd mobile
npm install
npm run dev            # http://localhost:5173  (add -- --host for phone testing)
```

The dev server talks to the same Supabase project as the desktop — sign in
with your Filey account.

## Ship to a phone

```bash
npm run build
npx cap add android    # once
npx cap add ios        # once
npm run cap:sync
npx cap open android   # or: cap open ios — build from the IDE
```

## What's on the phone today

- **Bottom tabs**: Dashboard · Invoices · Stock · Customers · Settings
- **Dashboard**: revenue, outstanding, customers, open orders + recent invoices
- **Invoices**: search/filter list, detail with items & totals, share sheet,
  draft creation (numbering follows the saved format)
- **Customers**: search list, profile with billed/outstanding, add customer
- **Inventory**: stock value, low/out flags, search
- **Settings**: company details, theme + accent (same stores as desktop),
  display currency (drives totals + tax regimes), sign out
- **Filey AI**: full agent — same brain, tools, confirm gates

## Architecture notes

- `@shared` → `../src/lib`. The shared layer's Tauri branches are runtime-
  guarded and never activate here; the tauri packages are installed only to
  satisfy imports.
- Design tokens are copied verbatim from the desktop `index.css` — same
  accent ramp (`applyAccent`), same dark mode contract, plus safe-area
  utilities (`tab-safe`, `top-safe`).
- Desktop-first features (WhatsApp bridge sidecar, PDF tool workspaces,
  wide editors) are listed in **All modules** and labelled honestly.
