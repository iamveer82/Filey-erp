# Filey ERP

> An open-source, offline-friendly desktop ERP for small businesses —
> inventory, orders, FTA-compliant invoicing & quotations, CRM, purchasing,
> reporting and a local PDF toolkit. Open source under the AGPL-3.0 license.

**Status:** active beta. Core flows work end-to-end against Supabase; it is
not yet a fully hardened, signed, multi-tenant product (see _Status &
roadmap_). Small businesses can self-host it today for free.

---

## Features

- **Overview** — KPI dashboard (items, suppliers, low stock, activity).
- **Inventory** — products, stock levels, reorder alerts.
- **Orders** — sales orders & fulfilment status.
- **Invoicing** — FTA-compliant tax invoices, 10 templates, live preview,
  optional VAT, auto-filled company branding, print/PDF.
- **Quoting** — quotation builder with per-line discount/tax, import from
  inventory, saved templates.
- **CRM** — customer dashboard + drag-and-drop sales pipeline + tasks.
- **Suppliers / Purchase / Reports** — sourcing, spend, financial reporting.
- **Tools** — a 100% local PDF toolkit (merge, split, compress, convert,
  watermark, page numbers…). Files never leave the device.
- **Settings** — company profile, account, users & roles, security,
  activity log, and an **Apps & Modules** screen to enable/disable modules
  (an Odoo-style module registry).

## Tech stack

Tauri 2 (Rust shell) · React 19 · TypeScript · Vite · Tailwind CSS ·
Recharts · React Router · Supabase (auth + Postgres, row-level secured) ·
pdf-lib (MIT) + pdfjs-dist (Apache-2.0) for local PDF tools.

### UI components

[shadcn/ui](https://ui.shadcn.com/docs) is configured for the shared desktop and
responsive web frontend, using Tailwind 4, Radix, Lucide, and Filey's existing
light/dark theme. The utility alias points to Filey's existing `cn` helper in
`src/lib/format.ts`; newer registry components may install their own `cn` package.

```bash
npm run ui -- info
npm run ui -- add <component> --dry-run
npm run ui -- add <component>
```

New components go in `src/components/ui/` and use the `@/` source alias.
Reuse the existing Filey components (`Button.tsx`, `Dialog.tsx`, `Select.tsx`,
and the `primitives` barrel) before adding an equivalent. Review generated
styles to retain Filey's pill buttons. Keep the configured theme when adding
components; do not reinitialize it over the existing CSS.

Charts use the shared `ChartFrame` with shadcn tooltips and legends. Supply
`ChartConfig` for named series and `valueFormatter` for currency values. Keep
invoice totals, dated payments and receipt documents separate to avoid double
counting; the monthly sales stack groups whole invoices by current paid/open status.

## Quick start

### Prerequisites

- Node.js 20+
- A free [Supabase](https://supabase.com) project
- (Desktop build only) Rust toolchain + your OS's WebView build deps —
  see the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

### 1. Database

In your Supabase project → **SQL Editor → New query**, paste the entire
contents of [`supabase/schema.sql`](supabase/schema.sql) and run it. It is
idempotent and row-level-secured per signed-in user. Re-run it any time you
pull updates that change the schema.

In **Authentication → Providers → Email**, enable email sign-in (turn off
"Confirm email" for the fastest local testing).

### 2. Configure

```bash
cp .env.example .env
```

Fill `.env` with your project's **URL** and **anon / publishable key**
(Project Settings → API). Never commit `.env` or use the `service_role`
key in the app.

### 3. Run

```bash
npm ci
npm run dev          # browser preview (fastest)
npm run tauri dev    # the desktop app
```

Sign up with any email/password and you're in.

### 4. Build desktop installers

```bash
npm run tauri build  # outputs to src-tauri/target/release/bundle/
```

Or push a `vMAJOR.MINOR.PATCH` tag matching the application version to build
macOS/Windows/Linux installers as a draft in the GitHub Actions release workflow.

### 5. Build & deploy the web app

```bash
npm run build      # static SPA → dist/
npm run preview     # serve dist/ locally to verify
```

`dist/` is a self-contained static site (root-hosted, no server needed).
Deploy it to any static host:

- **Cloudflare Pages** — build command `npm run build`, output dir
  `dist`. Client-side routing works via the bundled `public/_redirects`
  (`/* /index.html 200`).
- **AWS S3 + CloudFront** — upload `dist/`, set the S3 error document
  (and a CloudFront 403/404 custom error response) to `/index.html` for
  SPA routing, and ensure `.wasm` is served as `application/wasm`.

The web build runs entirely against your Supabase project. Gmail SMTP
"Save & Send" is desktop-only (no Rust backend on the web) and is
hidden/disabled automatically in the browser; everything else —
including the local PDF/SVG/image tools — works.

## Module system

Every screen is a module declared in `src/modules/registry.tsx`. Toggle
modules per user from **Settings → Apps & Modules** (Overview & Settings
are core and always on). Adding a new mini-app is a single registry entry.

## Scripts

| Command               | What it does                     |
| --------------------- | -------------------------------- |
| `npm run dev`         | Vite dev server (browser)        |
| `npm run tauri dev`   | Desktop app in dev               |
| `npm run build`       | Typecheck + production web build |
| `npm test`            | Unit & component tests (Vitest)  |
| `npm run typecheck`   | TypeScript only                  |
| `npm run tauri build` | Desktop installers               |

## Status & roadmap

Working: auth, all modules above, dual local/cloud persistence (offline-first
desktop with local SQLite, or Supabase cloud with org multi-tenancy + RBAC),
double-entry accounting with VAT & COGS, signed auto-updating desktop builds,
local PDF tools, module enable/disable. AGPL-licensed.

Not done yet (contributions welcome — see [ROADMAP.md](ROADMAP.md)):

- Warehouse inventory valuation & full procure-to-pay depth.
- UAE e-invoice XML submission (fields captured; serializer awaits the mandate).
- Broader automated test coverage (Playwright e2e) and a systematic QA pass.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GNU AGPL-3.0](LICENSE) © Filey. Free to use, self-host and modify —
including commercially. If you distribute a modified version or offer it
to others as a network service, you must make your modified source
available under the same license.

## Acknowledgements

[Tauri](https://tauri.app) · [Supabase](https://supabase.com) ·
[pdf-lib](https://pdf-lib.js.org) · [pdf.js](https://mozilla.github.io/pdf.js/) ·
[Recharts](https://recharts.org) · [Lucide](https://lucide.dev).
