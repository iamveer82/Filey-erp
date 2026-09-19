import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cachedCatalog } from "./catalog-cache.ts";

Deno.test("catalog cache isolates keys, expires entries, coalesces loads and survives Redis failure", async () => {
  const originalFetch = globalThis.fetch;
  const env = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
  const previous = env.map(key => Deno.env.get(key));
  Deno.env.set(env[0], "https://redis.example.test");
  Deno.env.set(env[1], "server-only-test-token");
  const stored = new Map<string, string>();
  const commands: unknown[][] = [];
  let calls = 0;
  const load = () => {
    calls++;
    return Promise.resolve({ status: 200, body: { items: [{ slug: "calendar" }] } });
  };
  try {
    globalThis.fetch = async (_url, init) => {
      const command = JSON.parse(String(init?.body));
      commands.push(command);
      assertEquals(new Headers(init?.headers).get("Authorization"), "Bearer server-only-test-token");
      assert(init?.signal instanceof AbortSignal);
      if (command[0] === "SET") {
        assertEquals(command.slice(3), ["EX", 300]);
        stored.set(command[1], command[2]);
        return Response.json({ result: "OK" });
      }
      return Response.json({ result: stored.get(command[1]) ?? null });
    };
    const url = "https://provider.test/toolkits?limit=20";
    await Promise.all(Array.from({ length: 5 }, () => cachedCatalog(url, "key-a", load)));
    assertEquals(calls, 1);
    await cachedCatalog(url, "key-a", load);
    assertEquals(calls, 1);
    await cachedCatalog(url, "key-b", load);
    await cachedCatalog(url + "&search=mail", "key-a", load);
    assertEquals(calls, 3);
    assert(!JSON.stringify(commands).includes("key-a"));
    stored.set(String(commands[0][1]), "invalid-json");
    await cachedCatalog(url, "key-a", load);
    assertEquals(calls, 4);

    const before = stored.size;
    await cachedCatalog(url + "&error=1", "key-a", () => Promise.resolve({ status: 401, body: { error: "revoked" } }));
    assertEquals(stored.size, before);
    globalThis.fetch = () => Promise.reject(new Error("Redis is unavailable"));
    assertEquals((await cachedCatalog(url, "key-a", load)).status, 200);
    assertEquals(calls, 5);
    Deno.env.delete(env[0]);
    await cachedCatalog(url, "key-a", load);
    assertEquals(calls, 6);
  } finally {
    globalThis.fetch = originalFetch;
    env.forEach((key, index) => previous[index] === undefined ? Deno.env.delete(key) : Deno.env.set(key, previous[index]!));
  }
});
