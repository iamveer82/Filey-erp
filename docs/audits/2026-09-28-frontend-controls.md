# Frontend controls audit — 28 September 2026

Scope: shared menus, date fields, search, form feedback, AI assistant settings (including image/video settings), and the custom-field selector. Searched page/component sources for native controls and browser dialogs; inspected the shared implementations and verified AI settings in an isolated demo. This is a focused controls audit, not a claim that every application workflow was tested.

## Assessment

The existing Filey design is restrained and consistent enough to retain. The problems were mixed control implementations and interaction details, not a need for a new visual language. Reused existing React, Radix and Filey components; added no dependencies.

| Dimension | Reviewed scope after fixes | Evidence / limit |
| --- | --- | --- |
| Accessibility | 3/4 | Linked hints/errors, preserved search focus, keyboard menu checks; no full assistive-technology certification |
| Performance | 3/4 | Existing lazy Settings panels retained; no new dependencies; production build passes, existing asset warnings remain |
| Responsive design | 3/4 | Provider menu checked at 390 × 844; menu now respects available viewport height; no physical-phone test |
| Theming | 3/4 | AI menu checked in light/dark; custom-field select now uses surface/foreground tokens |
| Visual consistency | 3/4 | Filey controls replace native AI dropdowns; some other sections still use native selects |
| Total | 15/20 — good within this scope | Further page-specific review remains useful |

## Findings and fixes

Eight findings: 0 P0, 1 P1, 5 P2, 2 P3. Seven addressed in this pass; one remaining consistency item below.

| Severity | Location | User impact | Resolution |
| --- | --- | --- | --- |
| P1 | `src/components/ui.tsx`, `FormField` | Screen readers did not associate validation errors or hints with the affected field (WCAG 1.3.1 / 3.3.1). | Link the visible message with `aria-describedby`, set invalid state, announce errors, preserve existing descriptions. |
| P2 | `src/components/AiSettings.tsx`, `MediaSettings.tsx` | Native provider/model/format/size lists looked different; long provider/model lists required scrolling. | Use Filey SelectMenu, with provider groups and searchable provider/discovered-model lists. Selection and credential logic preserved. |
| P2 | `src/components/ui-menu.tsx`, `MenuPopover` | At 390 × 844 the menu bottom measured 864px, beyond the screen. | Cap height to Radix's available space. Verified corrected bottom at 836px; long lists scroll internally. |
| P2 | `src/components/ui.tsx`, `SearchInput` | Clear removed the focused button and left users unable to immediately type another search; its target was only 20px. | Restore input focus, enlarge the target, and clear with Escape before closing an enclosing dialog. |
| P2 | `src/components/ui-menu.tsx` | Arrow keys did not open select triggers; ArrowUp with focus outside the option list skipped the last item. | Open via arrows and enter the first/last option correctly. Home/End remain usable for editing menu search text. |
| P2 | `src/components/Select.tsx` | The custom-field type selector hard-coded a white panel in dark mode and lacked an available-height cap. | Use Filey surface/text/hover tokens and viewport-aware sizing. |
| P3 | `src/components/Toolbar.tsx` | A duplicate search implementation lacked the shared clear behaviour; the primary button could submit a surrounding form. | Reuse SearchInput and declare the action button type. |
| P3 | Remaining native selects in CRM, expenses, and individual tool panels | These controls still use the OS dropdown appearance. | Retained in this pass. They are functional; migrate with their page-specific interaction checks in a later consistency pass. |

The earlier date-field correction remains in this working tree: unmasked editing, stable drafts during parent renders, valid-date checks, and one commit on Enter. The earlier Add field dialog changes also remain.

## Validation and boundaries

- AI connection tests cover provider switching, credential separation, local model discovery, hosted model discovery and errors. Requests use mocked providers; no paid model calls.
- Shared-control regression checks cover search focus, hints/errors, grouped filtering, empty results, keyboard movement, Escape and menus inside dialogs.
- Browser verification uses fictional demo data, with customer writes disabled. No customer records were edited.
- Production build succeeded. It still reports existing warnings around the vectorizer WASM URL, third-party browser externals and large tool chunks. The HEIC converter is already loaded dynamically; its bundle size alone does not establish initial-page slowness.
- No release, deployment or live credential changes were made.

Next: continue with page-specific `$impeccable harden` checks for remaining controls, then `$impeccable polish`. Re-run the focused audit after those changes.
