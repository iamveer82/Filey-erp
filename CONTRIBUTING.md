# Contributing to Filey ERP

Thanks for your interest in improving Filey ERP! It's MIT-licensed and
built for small businesses to use and extend freely.

## Getting set up

See the [README quick start](README.md#quick-start). In short: create a
free Supabase project, run `supabase/schema.sql`, copy `.env.example` to
`.env`, then `npm ci && npm run dev`.

## Before you open a PR

Run the same checks CI runs:

```bash
npm run typecheck   # must pass
npm test            # must pass
npm run build       # must pass
```

- Keep changes focused; one feature/fix per PR.
- Match the existing design system (Tailwind tokens, the `card` / `btn-*`
  / `chip` classes, Lucide line icons).
- New screens should be added as a **module** in
  `src/modules/registry.tsx` (see the existing entries).
- Don't commit secrets. `.env` is gitignored — never add real keys.
- Be honest in code and PRs about what is real vs. placeholder.

## Good first contributions

- Flesh out a placeholder Settings section (Preferences, Notifications…).
- Add tests (pure logic in `src/lib`, components via Testing Library).
- New invoice/quotation templates.
- Accessibility and i18n improvements.

## Bigger initiatives (discuss in an issue first)

- Org/team multi-tenancy + role-based access control.
- Deeper accounting / procure-to-pay / warehouse inventory.
- A third-party plugin SDK on top of the module registry.

## Reporting issues

Open a GitHub issue with steps to reproduce, expected vs. actual
behaviour, and your OS / build (`dev` vs. desktop).
