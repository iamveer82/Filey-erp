/* Fresh HTML discovers each deployment. Content-hashed assets are immutable,
 * so revisiting a route can read them locally without a network round trip.
 * Business/API responses and cross-origin requests are never stored here. */

const CACHE = "filey-v2";
const SHELL = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("filey-") && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only handle same-origin GETs; let Supabase / AI / font requests pass through.
  if (url.origin !== self.location.origin) return;
  const asset = /^\/assets\/.+-[\w-]{8,}\.(js|css|woff2?|svg|png|webp|wasm)$/.test(url.pathname) && !url.search;
  const shell = req.mode === "navigate" || SHELL.includes(url.pathname);
  if (!asset && !shell) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (asset) {
        const cached = await cache.match(req);
        if (cached) return cached;
      }
      try {
        const fresh = await fetch(req);
        // A deployment error must not replace a usable offline shell/asset.
        if (fresh.ok && fresh.type === "basic") cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        if (req.mode === "navigate") {
          const shell = await cache.match("/index.html");
          if (shell) return shell;
        }
        throw new Error("offline");
      }
    })()
  );
});
