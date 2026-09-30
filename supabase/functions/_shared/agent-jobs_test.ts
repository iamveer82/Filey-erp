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
        data: rpcError ? null : [{ number: "PO-1", supplier_name: "Supplier" }],
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
        bot: "fixture",
        chat: "42",
      })
    );
  } finally {
    globalThis.fetch = old;
  }
  assertEquals(
    await tell(fixture().client, "briefing", { owner: "OWNER", bot: "", chat: "" }),
    "unconfigured"
  );
});
