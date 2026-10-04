import { beforeEach, afterEach, expect, it, vi } from "vitest";
const sentry = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@sentry/react", () => ({ init: sentry.init }));
import { initMonitoring } from "../monitoring";

beforeEach(() => {
  localStorage.clear(); sentry.init.mockReset();
  vi.stubEnv("PROD", true);
  vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/1");
});
afterEach(() => vi.unstubAllEnvs());

it("never initializes configured telemetry for local data mode", async () => {
  localStorage.setItem("filey_data_mode", "local");
  initMonitoring();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(sentry.init).not.toHaveBeenCalled();
});

it("rechecks local mode after dynamic import before initialization", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  initMonitoring();
  localStorage.setItem("filey_data_mode", "local");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(sentry.init).not.toHaveBeenCalled();
});

it("drops exceptions, breadcrumbs and performance data after changing from cloud to local", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  initMonitoring();
  await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(1));
  const options = sentry.init.mock.calls[0][0];
  const event = { message: "Customer invoice failed" }, breadcrumb = { message: "Opened private.pdf" };
  expect(options.beforeSend(event)).toEqual({ level: "error", platform: "javascript", environment: "production", message: "Application error" });
  expect(options.beforeBreadcrumb(breadcrumb)).toBeNull();
  expect(options.beforeSendTransaction(event)).toBeNull();
  localStorage.setItem("filey_data_mode", "local");
  expect(options.beforeSend(event)).toBeNull();
  expect(options.beforeSendTransaction(event)).toBeNull();
  expect(options.beforeBreadcrumb(breadcrumb)).toBeNull();
});

it("removes cloud credentials, documents, customer data and raw diagnostic fields", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  initMonitoring();
  await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(1));
  const options = sentry.init.mock.calls[0][0];
  const privateValue = "synthetic-private-customer-and-provider-key";
  const event = {
    event_id: "a".repeat(32), timestamp: 123,
    message: privateValue, logentry: { message: privateValue, params: [privateValue] },
    user: { email: privateValue }, request: { url: privateValue, headers: { Authorization: privateValue }, data: privateValue },
    extra: { document: privateValue }, contexts: { company: { name: privateValue } }, tags: { customer: privateValue },
    breadcrumbs: [{ message: privateValue }], transaction: privateValue, fingerprint: [privateValue],
    exception: { values: [{ type: "TypeError", value: privateValue, mechanism: { data: { secret: privateValue } },
      stacktrace: { frames: [
        { filename: `${window.location.origin}/assets/index-abcdefgh.js?key=${privateValue}#${privateValue}`, lineno: 17, colno: 3,
          function: privateValue, vars: { secret: privateValue }, context_line: privateValue, pre_context: [privateValue], post_context: [privateValue] },
        { filename: `https://outside.test/${privateValue}.js`, lineno: 1 },
        { filename: `${window.location.origin}/documents/${privateValue}.js`, lineno: 2 },
      ] },
    }] },
  };
  const diagnostic = options.beforeSend(event);
  expect(JSON.stringify(diagnostic)).not.toContain(privateValue);
  expect(diagnostic).toEqual({
    event_id: "a".repeat(32), timestamp: 123, level: "error", platform: "javascript", environment: "production", message: "Application error",
    exception: { values: [{ type: "TypeError", value: "Application error", stacktrace: { frames: [{ filename: `${window.location.origin}/assets/index-abcdefgh.js`, in_app: true, lineno: 17, colno: 3 }] } }] },
  });
  expect(event.message).toBe(privateValue);
  expect(options.beforeBreadcrumb({ message: privateValue })).toBeNull();
  expect(options.beforeSendTransaction(event)).toBeNull();
  expect(options.tracesSampleRate).toBe(0);
  expect(options.integrations([{ name: "Breadcrumbs" }, { name: "BrowserSession" }, { name: "GlobalHandlers" }])).toEqual([{ name: "GlobalHandlers" }]);
});

it("does not retain private text disguised as an event ID or error type", async () => {
  localStorage.setItem("filey_data_mode", "cloud");
  initMonitoring();
  await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(1));
  const result = sentry.init.mock.calls[0][0].beforeSend({ event_id: "customer@example.test", exception: { values: [{ type: "Private customer", value: "Private invoice" }] } });
  expect(JSON.stringify(result)).not.toMatch(/customer|invoice|example/i);
  expect(result.exception.values[0].type).toBe("Error");
});
