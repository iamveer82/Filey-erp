// serve() shim for vitest — the webhook's server bootstrap is a no-op under
// test; nothing here needs to listen. Under real Deno this file isn't used.
export function serve(_handler: unknown): void {
  /* no-op */
}
