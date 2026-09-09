# Product

## Register

product

## Users

Owners, operators, accountants, sales teams, purchasing staff, and administrators at small businesses. UAE workflows remain established, with country-aware document foundations for India and EU markets. They use Filey throughout the working day to move between sales, inventory, purchasing, accounting, people, documents, and operational follow-ups, including when connectivity is limited. Country-aware fields do not imply complete statutory accounting or payroll localization.

## Product Purpose

Filey is an open-source, offline-friendly desktop ERP and CRM with free core local workflows and optional paid desktop benefits. It combines invoicing and tax-aware document workflows with inventory, CRM, procurement, reporting, local document tools, and configurable modules. Success means users can complete core business workflows end to end without exporting data to a collection of disconnected tools. Cloud storage is separate from device storage; switching workspace must preserve identity and must not silently transfer records. Hosted services, messaging providers and external AI may require configuration and incur their own costs.

## Brand Personality

Calm, professional, and practical. Filey should feel like a well-set ledger: trustworthy, direct, and quietly capable, with the user's business data taking priority over decoration.

## Shared Visual Language

The workspace uses warm white page surfaces, white cards and charcoal text in light mode, with charcoal page/card surfaces and light text in dark mode. Filey yellow is the default accent; a selected accent applies consistently across shared controls and charts. Keep status colors semantic.

Use the existing shared primitives: 40px pill buttons, 40px inputs/selects with 8px corners, 24px semibold page titles, 13px working text and 12px card corners. Standard icon buttons are 40×40px circles; authentication and large actions may use the existing 44px variant. Reuse the exact tokens and spacing in [design.md](design.md), including the 12px gaps between KPI cards. Keep tables compact, labels clear and primary actions obvious without giving each section a different control style.

The user explicitly prefers horizontal section tabs in Settings. Preserve the existing animated Filey AI mascot in the app sidebar; it is part of Filey's identity, with reduced-motion and hidden-view handling retained. Do not replace it with a static icon during consistency cleanups. Appearance uses aligned setting rows and compact pill colour choices.

## Anti-references

Avoid ornamental SaaS dashboards, oversized vanity metrics, multi-accent interfaces, glassmorphism, decorative gradients, gratuitous animation, playful consumer-app styling, and dense enterprise software that hides ordinary actions behind unfamiliar controls.

## Design Principles

- Keep the user oriented across connected business workflows.
- Make the common action obvious and the next state predictable.
- Prefer familiar, consistent controls over novel interaction patterns.
- Present dense business data with calm hierarchy and useful context.
- Treat offline operation, printing, and document accuracy as first-class product behavior.
- Put section Insights in Reports and connected charts in Overview. Operational sections prioritize their records, forms and next actions.
- Report real loading, empty, failure and busy states. A canceled save is not a successful download, and an unavailable provider is not a working connection.

## Accessibility & Inclusion

Meet WCAG AA contrast and keyboard-operability expectations. Preserve visible focus, label every control, maintain 40px minimum action targets, support reduced motion, never rely on color alone for status, support light and dark themes, and keep layouts usable for English and right-to-left Arabic content.

Current implementation coverage and release limitations are recorded in [Desktop workspace update](docs/desktop-workspace-update.md). This product direction is not a certification of full competitor parity, national tax compliance or completed native release testing.
