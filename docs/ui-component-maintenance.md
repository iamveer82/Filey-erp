# Maintaining Filey's UI components

Filey's shadcn components are application-owned source in `src/components/ui`
and `src/components/ui.tsx`. They continue to build and run without the shadcn
generator CLI. `components.json` preserves the registry/theme/alias configuration.
The previously imported `shadcn/tailwind.css` is preserved verbatim from the
installed 4.21.0 release in `src/styles/shadcn-tailwind.css`, with its MIT license
beside it. This keeps the existing variants, animations and utilities while
removing the vulnerable generator dependency from the build.

The installed development CLI and its unused `npm run ui` alias were removed on
4 October 2026. Its generator-only dependency chain installed vulnerable `braces`
and there was no patched upstream release. This removes the affected dependency
instead of suppressing npm audit or downgrading the design components. See the
[upstream advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

Edit existing components directly and review/test changes like other application
code. For a new component, review its official registry source, copy it into the
configured component directory, adapt its imports/tokens, and install only the
runtime dependencies actually required. Generated remote code requires review
before use. Do not reintroduce the vulnerable CLI chain through an unpinned
`npx shadcn` command; a future restored CLI must pass the full dependency audit.
