# Coin checkout repair

The private Coin test checkout supplied its server-selected coupon while setting `allow_discount_code: false`. The live provider rejected the request with HTTP422 before returning a session. The fix enables that flag only when Filey's exact private promotion is applied. Ordinary Coin checkouts still disable discount entry.

An acknowledged private checkout now saves its validated HTTPS provider URL and session atomically before returning it. Its verified owner can reopen that saved checkout without creating another order or session. An order whose provider outcome remains unknown is never automatically recreated. Completed, disputed, reversed, mismatched or unsafe-link orders cannot be resumed.

The pinned Dodo dependency now uses Deno's supported native npm runtime. The previous ESM build imported an obsolete Node process shim that caused errors in live Edge logs. Unexpected billing errors log only the action category and numeric provider status; callers continue to receive sanitized errors.

Deploy `supabase/2026-10-04-ai-credit-checkout-resume.sql` before the matching `dodo` and `ai-credits` functions. Existing claims are preserved. This migration adds private checkout storage and does not credit a wallet.

Validation: 2,906 frontend tests,249 Edge tests, production build, endpoint type checks, focused lint, and disposable PostgreSQL fresh/repeated/upgrade/rollback checks passed. A read-only live provider preview verified the corrected private request returns USD0 with the entire550-cent price discounted.

Opening checkout and returning to the app do not grant Coin. A real signed payment receipt must match the saved order, session, customer, product and exact single discount before the existing atomic wallet reconciliation can grant5Coin once. The owner must complete checkout to verify that final delivery. A zero-value test does not demonstrate cash collection or bank payout.
