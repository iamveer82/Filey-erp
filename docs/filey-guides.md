# Filey Guides

The header's **How it works** button opens optional instructions beside the current section. Help Center and Documentation also expose **Watch guide**. Both use the same guide catalogue, so written instructions and guided steps stay consistent.

The first document walkthroughs cover company setup and creating an invoice. All registered sections and Settings tabs have a contextual guide. The guide selector offers further workflows, including local storage, AI setup, Coin, team chat, letters, packing lists and file tools.

## Interaction

- Desktop: a nonmodal side panel. Mobile: a scrollable bottom sheet with fixed Back/Next controls and safe-area padding.
- Opening starts in manual mode. Explicit Play advances the text at a reading pace; Pause, Replay, Back and Next remain available. Playback stops when hidden, minimized, navigating away or switching identity.
- Minimize keeps the document usable. Resume loads the reading position saved on this device.
- Find this control highlights a known, visible control and minimizes the panel. It never opens an editor, changes a field or clicks a business action. Missing/hidden controls explain which editor/tab to open.
- Finish guide means **Guide reviewed**. Actual setup/document completion requires its own successful save and confirmation.
- All instructions remain readable without animation or network access to the illustration. Reduced-motion preferences are passed to the animation engine.
- The panel supports keyboard focus restoration and Escape. While focused on the illustration, Escape returns the drawing to rest; elsewhere it closes the guide.

## Data and permissions

Guides contain static instructions and a sample illustration. They read no customer, company, chat, document, payment or credential payloads and call no business APIs. Opening a guide, playing it or finishing it cannot send a message, save a document, pay or use AI Coin. Section links only navigate after an explicit click and respect module availability.

Reading position is stored as `{ step, finished }` under `filey.guides.v1:<encoded account/workspace/mode scope>`. It is never uploaded. Progress from a different scope cannot be read or saved. Invalid source data or failed storage reads are not overwritten; the UI reports a generic persistence failure without exposing source data.

## Source map

- `src/lib/fileyGuides.ts`: stable IDs, static wording, destinations, optional step titles and known control targets.
- `src/lib/guideRoutes.ts`: lightweight route lookup, including Settings query sections. The catalogue, guide panel and drawing are loaded on demand.
- `src/components/GuideLauncher.tsx`: persistent entry point, device identity boundaries, minimizing, highlights and focus restoration.
- `src/components/FileyGuidePanel.tsx`: chapter controls, nonmodal dialog, permission-aware links and reading progress.
- `src/lib/guideProgress.ts`: validated device-only storage.
- `src/lib/hairline/document-tray.js`: one custom Hairline figure with six folded sheets in a desk tray, stable resting-edge hit regions and staggered selection.
- `src/lib/hairline/host.ts`: only bundled external script URLs; no eval, inline script, remote provider or weakened CSP. Pending mounts are canceled before they can attach to a closed panel.
- `src/vendor/hairline/kernel.js` and `LICENSE`: unchanged MIT-licensed Hairline engine. Do not modify the vendor engine to adjust the figure.

## Adding a guide

Use a stable lowercase ID, an existing internal destination, its module ID and three to six practical steps where possible. Destinations may select a tab/Settings section but must not include a create/action flag. Use actual control labels and explain how the user verifies the result. Do not treat viewing or previewing as completion, and do not promise unsupported functionality.

Optional targets refer to `data-guide` attributes on existing controls. Empty targets are allowed. Target lookup must not synthesize clicks or writes. Keep illustration inputs generic: chapter index and bounded motion intensity only.

## Verification

Regression coverage includes every active module and Settings destination, stable catalogue IDs, passive links, permission filtering, progress isolation/corruption, visibility/navigation playback cleanup, focus restoration, persistent highlights, Escape behavior, script-load failures, reduced motion and deferred StrictMode teardown.

Visual checks use fictional data at a 390 × 844 mobile viewport in light and dark themes. The standalone drawing is checked at rest, selection, thumbnail size, low/high lift and both themes. These disposable previews and screenshots live in `output/` and are not shipped.
