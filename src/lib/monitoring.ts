/* Optional error monitoring. No-op unless VITE_SENTRY_DSN is set and we're in
 * a production build — so it costs nothing in dev or for self-hosters who
 * don't configure it. Sentry is dynamically imported so it's code-split out of
 * the main bundle when unused. */
export function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn || !import.meta.env.PROD) return;
  import("@sentry/react")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: "production",
        tracesSampleRate: 0.1,
        // Don't capture PII; keep it lightweight.
        sendDefaultPii: false,
      });
    })
    .catch(() => {
      /* monitoring is best-effort — never break the app over it */
    });
}
