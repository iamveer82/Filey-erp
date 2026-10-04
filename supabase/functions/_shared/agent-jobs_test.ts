import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runDigest, runLowStockPo, tell } from "./agent-jobs.ts";

function fixture(failTable = "", rpcError = false) {
  const filters: unknown[] = [];
  const client = {
    from(table: string) {
      let rangeStart = 0;
      const q = {
        select: () => q,
        eq: (key: string, value: unknown) => {
          filters.push([table, key, value]);
          return q;
        },
        order: () => q,
        returns: () => q,
        range: (start: number) => {
          rangeStart = start;
          return q;
        },
        or: () => q,
        lt: () => q,
        not: () => q,
        limit: () => q,
        insert: () => Promise.resolve({ error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data:
              table === "accounts"
                ? rangeStart === 0
                  ? Array.from({ length: 1000 }, () => ({
                      name: "Cash",
                      account_type: "asset",
                      balance: 1,
                    }))
                  : [{ name: "Cash", account_type: "asset", balance: 1 }]
                : [],
            count: table === "invoice_docs" ? 25 : null,
            error: table === failTable ? { message: "unavailable" } : null,
          }).then(resolve),
      };
      return q;
    },
    rpc: (name: string, args: unknown) => {
      filters.push([name, args]);
      return Promise.resolve({
        data: rpcError ? null : name === "filey_agent_workspace_allowed" ? true : [{ number: "PO-1", supplier_name: "Supplier" }],
        error: rpcError ? {} : null,
      });
    },
  };
  return { client: client as unknown as SupabaseClient, filters };
}
Deno.test(
  "scheduled digest rejects any unavailable dataset instead of reporting zero",
  async () => {
    for (const table of ["accounts", "invoice_docs", "products"])
      await assertRejects(() => runDigest(fixture(table).client, "ORG"));
  }
);
Deno.test("briefing includes every account page and exact overdue count", async () => {
  const f = fixture();
  const text = await runDigest(f.client, "ORG");
  assertStringIncludes(text, "Assets AED 1,001");
  assertStringIncludes(text, "Overdue: 25");
  const orgFilters = f.filters.filter(
    (f) => Array.isArray(f) && f[1] === "org_id"
  ) as unknown[][];
  assertEquals(orgFilters.length, 5);
  assertEquals(
    orgFilters.every((f) => f[2] === "ORG"),
    true
  );
});
Deno.test(
  "scheduled PO uses one scoped atomic RPC and errors never become nothing to reorder",
  async () => {
    const f = fixture();
    assertStringIncludes(await runLowStockPo(f.client, "ORG", "OWNER"), "PO-1");
    assertEquals(f.filters, [
      ["filey_agent_lowstock_po", { p_owner: "OWNER", p_org: "ORG" }],
    ]);
    await assertRejects(() => runLowStockPo(fixture("", true).client, "ORG", "OWNER"));
  }
);
Deno.test("scheduled Telegram HTTP-200 rejection is not a sent message", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"ok":false}');
  try {
    await assertRejects(() =>
      tell(fixture().client, "Private briefing", {
        owner: "OWNER",
        org: "ORG",
        bot: "fixture",
        chat: "42",
      })
    );
  } finally {
    globalThis.fetch = old;
  }
  assertEquals(
    await tell(fixture().client, "briefing", { owner: "OWNER", org: "ORG", bot: "", chat: "" }),
    "unconfigured"
  );
});

Deno.test("scheduled private delivery refuses revoked, changed or unreadable workspace authority before sending or logging", async () => {
  const old = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async () => { sends++; return new Response('{"ok":true}'); };
  try {
    for (const result of [
      { data: false, error: null }, // changed org/role or removed membership
      { data: null, error: null },
      { data: "true", error: null },
      { data: true, error: { message: "private internal fixture" } },
    ]) {
      const calls: unknown[] = [];
      const client = {
        rpc: (name: string, args: unknown) => { calls.push([name, args]); return Promise.resolve(result); },
        from: () => { throw new Error("Denied delivery must not create a log"); },
      } as unknown as SupabaseClient;
      await assertRejects(() => tell(client, "Private customer briefing", { owner: "OWNER", org: "ORIGINAL", bot: "fixture", chat: "42" }),
        Error, "Scheduled delivery no longer has workspace access.");
      assertEquals(calls, [["filey_agent_workspace_allowed", { p_owner: "OWNER", p_org: "ORIGINAL" }]]);
    }
    assertEquals(sends, 0);
  } finally { globalThis.fetch = old; }
});

Deno.test("scheduled send captures the original identity and destination before awaited authority check", async () => {
  const old = globalThis.fetch;
  const config = { owner: "OWNER", org: "ORIGINAL", bot: "original-bot", chat: "42" };
  const observed: unknown[] = [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      observed.push([name, args]);
      await Promise.resolve();
      Object.assign(config, { owner: "OTHER", org: "OTHER", bot: "other-bot", chat: "99" });
      return { data: true, error: null };
    },
    from: () => ({ insert: async (row: unknown) => { observed.push(row); return { error: null }; } }),
  } as unknown as SupabaseClient;
  globalThis.fetch = async (url, init) => {
    observed.push([String(url), JSON.parse(String(init?.body))]);
    return new Response('{"ok":true,"result":{"message_id":1}}');
  };
  try {
    assertEquals(await tell(client, "Private briefing", config), "sent");
    assertEquals(observed[0], ["filey_agent_workspace_allowed", { p_owner: "OWNER", p_org: "ORIGINAL" }]);
    assertStringIncludes(String((observed[1] as unknown[])[0]), "original-bot");
    assertEquals(((observed[1] as unknown[])[1] as { chat_id: string }).chat_id, "42");
    assertEquals((observed[2] as { user_id: string; external_id: string }).user_id, "OWNER");
    assertEquals((observed[2] as { external_id: string }).external_id, "42");
  } finally { globalThis.fetch = old; }
});
