# Billing and wallet verification — September 21, 2026

The reported Ultra checkout was a duplicate purchase rejection, not a missing function. Read-only Supabase inspection found a `checkout` audit event at 07:27:47 UTC for an account with an active Ultra entitlement. The corresponding invocation returned HTTP 409; a later `license_activate` request at 07:30:54 UTC returned 200. No customer records were changed during diagnosis.

Billing previously displayed Ultra only when a local activation token was present, ignoring account ownership. It now reads account ownership as well, hides duplicate purchase controls and waits for ownership loading before checkout. Shared billing calls require a signed-in account, never automatically retry a financial action, validate payment destinations and translate service errors into customer messages. Account changes invalidate returned billing results.

The AI wallet is linked from the account menu, Account & Profile, Billing and the chat funding menu. Settings labels it AI Wallet. Users without an online account session see a connection action and can still use their own model keys.

The Desktop License page is replaced by Settings → Devices, also linked from Billing. Ordinary legacy links route to Devices; Ultra checkout returns go to Billing and wait for the Ultra entitlement rather than a Pro subscription. Device controls load only when that tab is opened, without refetching on unchanged sign-in events. Eligible new devices activate automatically within the two-device allowance; deliberately removed devices do not silently reclaim a slot. Signed offline verification remains in place.

Activity Log and Diagnostics are removed from customer Settings, along with their unreachable UI components. The underlying audit records and diagnostic collection are preserved.

Invoice, quotation, purchase-order and receipt dialogs now use the existing A4 fit component instead of reflowing print content into a narrow phone column. Preview dimensions and margins match the export layout, with fit-width, zoom and horizontal scrolling controls. Stamps/signatures follow the final-page export placement; purchase-order previews now include their bank details. A browser check at 390×844 confirmed all invoice columns fit with no horizontal overflow at the default zoom; zooming enables horizontal scrolling, and the dialog stays within an 844×390 landscape viewport. These are responsive browser checks, not a physical Safari-device test. Customer records were not edited.

Hosted secret names were checked through the signed-in Supabase dashboard. Dodo payment and product secrets exist. No Higgsfield credentials, shared OpenRouter key or AI credit-pack configuration was present. Shared AI activation and wallet sales remain separate from the working BYOK media path. The OpenRouter secret step still requires the confirmation requested after the earlier automatic approval rejection; no key was added during this diagnosis.

The existing Dodo $5 credit-product draft was corrected to a $5.50 pre-tax price and explicitly describes the $0.50 Filey service fee. It remains a saved draft, not a published product or enabled wallet checkout.

The v2.12.0 auto-update build was cancelled at the user's request before installers were uploaded. The release remains an unpublished draft. A corrected build must pass before publication; existing customers remain on the prior release.

Validation: all 1,657 app tests across 259 files passed, including billing, wallet, media, account, navigation and mobile-preview checks. TypeScript, production build, route-bundle checks and changed shared-component/settings lint passed. Browser checks confirmed the friendly signed-out checkout response, direct wallet navigation, legacy license-link redirect, and no horizontal overflow at 390px. No paid checkout or customer generation was executed.
