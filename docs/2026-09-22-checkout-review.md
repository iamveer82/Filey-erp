# Payment review and sync audit

Plan buttons in Billing and the invoice-limit upgrade prompt now open an order review before creating a hosted checkout. Configured AI credit packs use the same review, itemizing spendable credit and the separate service fee. Credit sales remain disabled when server configuration is incomplete.

All three purchases use the same validated Dodo URL opener: the system browser on desktop, same-tab navigation on mobile/web. Desktop users can check payment from the review without starting another checkout. Only server-confirmed entitlements or wallet ledger entries confirm a purchase; return URL parameters never grant access or credit. The upgrade prompt keeps its review inside the existing dialog so unsaved invoice work stays mounted.

New app-origin plan requests return to the hosted app's Billing route after success or cancellation. Marketing-site and older client return behavior is preserved. `FILEY_APP_URL` is server-configured and defaults to `https://app.gofiley.com`; arbitrary client redirect URLs are not accepted. Deploy the updated `dodo` function together with `_shared/checkout-return.ts` before shipping the client.

## Verified locally

- 23 focused app tests cover review-before-checkout, fee display, unavailable packs, duplicate clicks, errors, account changes, desktop opener, web navigation, and verified return behavior.
- Three Deno checks cover credit-product pricing, payment/refund reconciliation, and safe app return URLs. The Dodo handler type-checks.
- TypeScript, production build and changed-source ESLint passed.
- A 390px browser check of the real Billing screen shows the complete review and friendly signed-out error without horizontal page overflow. No paid transaction was made. Physical iOS and installed desktop checkout are not yet verified.

## Production blockers

The signed-in Supabase dashboard still lists the Dodo plan/payment secrets but has no `FILEY_AI_OPENROUTER_KEY` or `DODO_AI_CREDIT_PACKS`. Previous deployment notes identify the $5 credit product as a draft. Do not enable credit sales until a funded provider, published products, webhook setup and test-mode payment verification are complete. No provider credentials were added and no production function was deployed during this patch.

## Sync audit

Fresh live metadata matches the column names/types in the audited snapshot for all 17 failing collections. Validation of 4,883 non-null local values found only ten local file-owner placeholders, already converted to the authenticated UUID before upload. No missing column/type migration was established for these failures. Legacy records without revisions, mixed company ownership and missing parent invoice links remain the recovery issues. No customer records, workspace assignments or schema were modified.
