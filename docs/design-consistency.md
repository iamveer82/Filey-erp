# Filey design consistency update

Prepared 6 September 2026. This is an incremental polish of Filey's existing Inter, zinc and amber interface, with selectable accents retained. It does not change the document brand or replace working workflows.

## Audit and changes

The source audit covered the 61 page/panel files and 130 component files, with particular attention to button definitions, color utilities, typography, page gutters, filters, calendar controls and responsive wrappers. This is source coverage, not a claim that every interaction was manually exercised.

| Area | Resolution |
| --- | --- |
| Buttons | React Button and native actions use the same CSS variants: 32px height, 6px corners, 13px labels, focus rings and disabled states. Toolbar, empty-state, record-panel, storage and backup actions use them. Authentication keeps a 44px touch target with the same styling. |
| Accent | Removed fixed amber secondary aliases and blue loading color. Customer/supplier identity icons follow the chosen accent. Login and two-factor actions no longer use a fixed gradient. |
| Filters | FilterChip uses the shared rectangular chip and neutral selected state. Status text retains its meaning. Integration and communication tabs use the same selection treatment. |
| Calendars | Both calendar implementations follow shared colors. The date picker inherits Inter, root light/dark mode and selected accent, without its former independent OS override, gradients, blur or hover lift. Small labels are larger and flyouts fit narrow screens. |
| Typography and layout | Unified divergent page titles, settings section titles and Team/Comms gutters. PageHeader lets long subtitles share the row with actions on desktop and wraps on narrow screens. |
| Record panels | Replaced nonexistent border-line, bg-bg and text-bg utilities with real tokens and shared fields/actions. Corrected inverted surfaces that lost contrast in dark mode. |
| Charts and metrics | Chart axes use readable zinc colors in light and dark mode, including legacy chart tokens. Descriptive metric metadata defaults to neutral, with explicit status/change colors retained. |
| Forms and feedback | Shared search fields use the input primitive and an accessible name. Duplicate shimmer skeletons reuse the shared quiet skeleton. Multi-line PDF result messages use rectangular banners. |
| Motion | Removed calendar bounce, staggered entrance and floating hover effects. Framer Motion respects the OS reduced-motion preference at the application root. |
| Session recovery | Browser review exposed an expired JWT that the profile retry could not recover. Profile reads now refresh once and retry, retain the same identity check and never treat a failed read as new-account setup. Successful recovery was observed in the live preview; regressions cover success and bounded failure. |

### Button preference update — 7 September 2026

The user requested Apple-like pill buttons. This supersedes the 6px button and filter corners recorded in the original audit above. Shared `.btn-*` and `.chip` classes now use full pill radii, so authentication, ERP/CRM actions and filters inherit the same shape. Login segments, header controls, modal and row-action icons follow this treatment. Both calendars use round day buttons; month/year choices and date-clearing actions use pills, while range interiors remain joined. Fields, cards, navigation/menu rows and document templates retain their existing geometry.

## Intentional differences

Print/PDF templates, annotation colors, user-chosen folder colors, file-type icons, integration logos and the independently configurable Filey AI mascot retain their own colors. Status colors indicate success, warnings and errors. Avatars, badges, toggles and chat-composer controls may remain circular. These carry meaning rather than incidental section styling.

## Verification

- Full suite: 137 files, 963 tests passed.
- Production build passed; lint completed with zero errors and existing warnings.
- Browser review at 1280px: Settings/Appearance, quotation list/editor/calendar, CRM, reports, inventory, integrations, Help Center and customer charts. Calendar verified in light and dark with blue accent; amber/light restored afterward.
- Browser review at 319px: CRM, Appearance and Data & Storage. Appearance and storage document widths stayed at 319px; storage actions measured 32px high. Desktop quote actions measured 32px high, 6px corners and 13px labels. Calendar computed Inter with no background gradient.
- Customer charts displayed the existing two records. The unsaved quotation used for calendar inspection was not saved or sent. No business records or integration settings were changed by the visual review.

No update was published. Packaged desktop visual and upgrade testing remains part of the release check documented in storage-design-update.md.

## Follow-up polish and invoice messaging

- Applied the requested Taste skill within its scope, preserving Filey's existing product design. CRM selection controls and filter copy now use consistent neutral states and clearer labels.
- Theme and accent changes synchronize across already-open tabs. Native controls use the selected theme and checkbox accent. Verified a theme change from the narrow CRM window updating the open desktop invoice dialog.
- Shared modals use the dynamic viewport height, tighter mobile gutters and a nonshrinking header. CRM form actions remain visible in a sticky footer; verified the new-company form at 319px without saving it.
- Bulk actions and pagination wrap, OTP slots shrink to fit, and invoice identifiers, amounts and dates stay together rather than splitting across several lines.
- The invoice message review uses the same fields, chips, buttons, borders and light/dark tokens. It prepares a real saved-invoice PDF and exposes only the sending options supported by the current device. See invoice-messaging.md for setup and delivery limits.

Final validation: production build passed; lint has zero errors and 525 existing warnings. The suite contains 970 tests across 140 files. An initial full run passed all 970; the final parallel run passed 969 with one 5-second ModernOverview smoke timeout. Rerunning the page smoke file with two workers passed all 37 tests. No business records were edited and no messages were sent during browser review.
