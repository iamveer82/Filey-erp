/** Use WhatsApp's HTTPS response time for live-message checks. A wrong desktop
 * clock must not make a new phone message look hours old or in the future.
 * Monotonic elapsed time also avoids jumps when Windows corrects its clock. */
export async function whatsappClock(send = fetch) {
  const started = performance.now();
  const local = Date.now();
  let anchor = local;
  let sampled = started;
  try {
    const response = await send("https://web.whatsapp.com/", {
      method: "HEAD", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4000),
    });
    const server = Date.parse(response.headers.get("date") || "");
    if (Number.isFinite(server)) {
      anchor = server;
      sampled = performance.now();
    }
  } catch { /* Offline / blocked time check: retain the conservative local guard. */ }
  return {
    startedAtSeconds: Math.floor((anchor - (sampled - started)) / 1000),
    nowSeconds: () => Math.floor((anchor + performance.now() - sampled) / 1000),
  };
}
