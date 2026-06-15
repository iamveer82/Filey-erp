# Filey ERP — Production Deployment Guide

## Prerequisites

- Node.js 20+
- npm or pnpm
- A Supabase project (free tier works)
- A static hosting provider (Cloudflare Pages, Vercel, Netlify, or S3)

## 1. Database Setup

1. Go to [supabase.com](https://supabase.com) → create a new project
2. Open SQL Editor → New query
3. Copy everything from `supabase/schema.sql` and run it
4. Go to Authentication → Providers → Email → enable Email sign-in
5. Turn off "Confirm email" for faster onboarding (optional)

## 2. Environment Variables

Copy `.env.example` to `.env` and fill in:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SENTRY_DSN=          # optional — leave blank to disable
```

> Never commit `.env` to git. It's already in `.gitignore`.

Get your Supabase values from: Project Settings → API

## 3. Build

```bash
npm ci
npm run build
```

Output goes to `dist/` — a self-contained static SPA.

## 4. Deploy

### Cloudflare Pages (recommended)

1. Connect your GitHub repo
2. Build command: `npm run build`
3. Output directory: `dist`
4. Add environment variables in Settings → Environment variables
5. SPA routing works automatically via `public/_redirects`

### Vercel

1. Import repo
2. Framework preset: Vite
3. Build command: `npm run build`
4. Output: `dist`
5. Add `vercel.json` for SPA routing (see below)

### Netlify

1. Connect repo
2. Build: `npm run build`
3. Publish: `dist`
4. Add `_redirects` file is already in `public/`

### AWS S3 + CloudFront

1. Upload `dist/` contents to S3 bucket
2. Enable static website hosting
3. Set error document to `index.html`
4. CloudFront: set 403/404 errors to return `index.html`
5. Ensure `.wasm` files serve with `application/wasm` MIME type

## 5. Post-Deploy Checks

- [ ] Sign up works
- [ ] Login works
- [ ] All modules load without errors
- [ ] PDF tools work in browser
- [ ] Dark mode toggle works
- [ ] PWA install prompt appears (Chrome/Edge)
- [ ] Offline mode loads cached shell

## 6. Optional: Error Monitoring

To enable Sentry:

1. Create project at [sentry.io](https://sentry.io)
2. Copy DSN to `VITE_SENTRY_DSN`
3. Rebuild and redeploy

## 7. Desktop App (optional)

```bash
npm run tauri build
```

Outputs installers to `src-tauri/target/release/bundle/`

## Security Notes

- Row Level Security (RLS) is enabled on all tables — users can only access their own data
- The `service_role` key must NEVER be used in the frontend
- PDF processing is 100% local — files never leave the device
- `.env` is in `.gitignore` — verify it's never committed
