/** Return to the app's hash router, using only the server-configured origin. */
export function appCheckoutReturn(params: Record<string, string>): string {
  const base = new URL(Deno.env.get("FILEY_APP_URL") || "https://app.gofiley.com");
  const local = ["127.0.0.1", "localhost"].includes(base.hostname);
  if (
    (base.protocol !== "https:" && !(local && base.protocol === "http:")) ||
    base.username ||
    base.password
  )
    throw new Error("Invalid app return URL");
  return `${base.origin}/#/settings?${new URLSearchParams(params)}`;
}
