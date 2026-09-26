# Password recovery

From sign-in, choose **Forgot password?**, enter the account email and choose
**Send reset link**. Open the email, enter a new password twice, and submit.
Accounts with an authenticator must provide its code. Expired or incomplete
links offer a fresh reset request; going offline pauses the form until connected.

## Delivery and security

Filey calls Supabase Auth's `resetPasswordForEmail` with an isolated client.
Supabase creates the one-time token and applies its native recovery rate limits.
Resend delivers the email through Supabase's custom SMTP configuration. The old
public `send-email/password_recovery` action and its manual token generation
have been removed. Invoice email continues to use the authenticated Edge Function.

Recovery requests are not automatically retried: retrying an uncertain send can
replace a link already in transit. The form reports request errors and uses a
60-second resend cooldown in addition to Supabase's server limits. It shows a
neutral success message for valid requests without confirming account existence.

The recovery token is captured in memory and removed from the address bar.
Refreshing this page requires reopening the original email link, or requesting
another link. Monitoring is not initialized on a recovery-page load. Recovery
renders outside the app's AuthProvider and verifies the token only when the user
submits a valid new password, so email link previews do not consume it.

The recovery session never persists or replaces the app's session. Supabase
identity and MFA checks must succeed before updating the password. Failed or
abandoned requests do not change device credentials. A successful reset refreshes
the offline password only for the same remembered account on that device.
Other devices need an online password sign-in to refresh their local credential.

## Hosted configuration

Deploy the updated frontend before enabling this email template on the hosted
project. The email opens the hosted Filey URL, including when requested from
the desktop app; after resetting there, sign in online in the desktop app.

1. In Supabase Authentication → URL Configuration, set **Site URL** to the HTTPS
   address serving this Filey build, without a trailing slash.
2. In Authentication → Emails → SMTP Settings, enable custom SMTP with:
   host `smtp.resend.com`, port `465`, username `resend`, password set privately
   to the Resend API key, a verified sender address, and sender name `Filey`.
   Keep credentials out of the frontend and repository.
3. Under Emails → Templates → Reset password, use subject **Reset your Filey
   password** and the complete [recovery template](../supabase/templates/recovery.html).
   Its link sends `TokenHash` and the URL-encoded email to Filey's isolated form.
   Do not substitute `ConfirmationURL`, which consumes the token before this form.
4. Keep Supabase's recovery rate limits enabled. Disable link tracking for auth
   email in Resend so tracking redirects do not alter security links.
5. Deploy `send-email` from this tree to remove the old custom recovery action
   if that version was ever deployed. Invoice sending remains authenticated.
6. Verify with a test account you control: request a link, reset once, sign in
   using the new password, check an expired/used link, and test MFA if enabled.

The template in `supabase/config.toml` configures local Supabase development.
Hosted template and SMTP settings must be configured separately in the dashboard.

## Verification status — September 7, 2026

The configured Resend API key could read the verified `gofiley.com` domain.
That check did not send an email and does not prove Supabase SMTP is configured.
The saved Supabase management token returned HTTP 401; the dashboard requires
sign-in. Hosted SMTP/template changes and Edge Function deployment are pending.
No real account password was changed and no live recovery email was sent.

Automated checks cover the native Auth request, validation and error handling,
isolated sessions, token removal, recovery retries, MFA, connection changes, and
protection of another account's local credentials. Browser checks cover pill
buttons, the recovery form, and returning to the existing signed-in workspace.
The final focused suite passed 61 tests across six files; TypeScript, the
production build and Deno's check of the email function passed. Focused ESLint
reported no errors, with existing warnings in shared files.

References: [Resend SMTP](https://resend.com/docs/send-with-supabase-smtp),
[Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates),
[Supabase password recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail).
