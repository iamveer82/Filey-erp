import { isLocalMode } from "./dataMode";
import type { ErrorEvent, StackFrame } from "@sentry/react";

function privateDiagnostics(event: ErrorEvent): ErrorEvent {
  const values = event.exception?.values?.slice(0, 5).map(value => ({
    type: /^(Error|TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError|DOMException)$/.test(value.type ?? "") ? value.type : "Error",
    value: "Application error",
    stacktrace: { frames: (value.stacktrace?.frames ?? []).slice(-30).flatMap(frame => {
      try {
        const file = new URL(frame.filename ?? "", window.location.origin);
        if (file.origin !== window.location.origin || !/^\/assets\/[\w.-]+-[\w-]{8,}\.js$/.test(file.pathname)) return [];
        const safe: StackFrame = { filename: `${file.origin}${file.pathname}`, in_app: true };
        if (Number.isSafeInteger(frame.lineno) && frame.lineno! >= 0) safe.lineno = frame.lineno;
        if (Number.isSafeInteger(frame.colno) && frame.colno! >= 0) safe.colno = frame.colno;
        return [safe];
      } catch { return []; }
    }) },
  }));
  // An allowlist avoids relying on PII defaults: provider/SQL messages, URLs,
  // headers, console data and attached component state can contain business data.
  return {
    type: undefined,
    ...(event.event_id && /^[a-f\d]{32}$/i.test(event.event_id) ? { event_id: event.event_id } : {}),
    ...(typeof event.timestamp === "number" && Number.isFinite(event.timestamp) && event.timestamp >= 0 ? { timestamp: event.timestamp } : {}),
    level: "error", platform: "javascript", environment: "production", message: "Application error",
    ...(values?.length ? { exception: { values } } : {}),
  };
}

/* Optional error monitoring. No-op unless VITE_SENTRY_DSN is set and we're in
 * a production build — so it costs nothing in dev or for self-hosters who
 * don't configure it. Sentry is dynamically imported so it's code-split out of
 * the main bundle when unused. */
export function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn || !import.meta.env.PROD || isLocalMode()) return;
  import("@sentry/react")
    .then((Sentry) => {
      if (isLocalMode()) return;
      Sentry.init({
        dsn,
        environment: "production",
        tracesSampleRate: 0,
        integrations: defaults => defaults.filter(integration => !["Breadcrumbs", "BrowserSession"].includes(integration.name)),
        // Don't capture PII; keep it lightweight.
        sendDefaultPii: false,
        // No local telemetry. Cloud errors retain only generic diagnostics and
        // trusted build locations; console/network/transaction payloads are private.
        beforeSend: event => isLocalMode() ? null : privateDiagnostics(event),
        beforeSendTransaction: () => null,
        beforeBreadcrumb: () => null,
      });
    })
    .catch(() => {
      /* monitoring is best-effort — never break the app over it */
    });
}
