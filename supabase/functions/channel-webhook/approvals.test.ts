// Runnable check for the approval engine:
//   deno test supabase/functions/channel-webhook/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleApproval, type ApprovalIO } from "./approvals.ts";

/**
 * Stateful fake modelling exactly what handleApproval touches.
 *
 * The candidate SELECT keeps returning the row (as it does for two concurrent
 * APPROVEs that both read "pending" before either writes); the CONDITIONAL
 * update is where exclusivity lives: its .select() reports the row for the
 * FIRST caller and zero rows for everyone after — PostgREST reports only
 * what it actually wrote, which is the property the race guard relies on.
 */
function fakeClient(
  initialRow: Record<string, unknown> | null,
  invoice?: Record<string, unknown>,
) {
  const inv = invoice ? { ...invoice } : null;
  let claimed = false;
  let invoiceFlipped = false;
  const auditRows: Record<string, unknown>[] = [];
  const upserts: Record<string, unknown>[] = [];
  // patch.payload is typed `unknown` off Record<string, unknown>, so the
  // collected patches are unknown too; assertions below narrow as needed.
  const scrubPatches: unknown[] = [];

  function pendingActionsUpdate(patch: Record<string, unknown>) {
    const builder: Record<string, unknown> = {};
    builder.eq = () => builder;
    // Terminal transitions end .eq("status","pending").select(); the scrub
    // follow-up ends bare (awaited without select).
    builder.select = () => {
      if (patch.payload && !patch.status) {
        scrubPatches.push(patch.payload);
        return Promise.resolve({ data: [], error: null });
      }
      if (!claimed) {
        claimed = true;
        return Promise.resolve({ data: [{ id: initialRow?.id }], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    };
    builder.then = (resolve: (x: unknown) => void) => {
      // Bare-awaited updates (the scrub follow-up has no .select()).
      if (patch.payload && !patch.status) scrubPatches.push(patch.payload);
      resolve({ error: null });
    };
    return builder;
  }

  return {
    client: {
      from(table: string) {
        if (table === "agent_pending_actions") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    gt: () => ({
                      order: () => ({
                        limit: () => ({
                          maybeSingle: () =>
                            Promise.resolve({
                              data: initialRow ? { ...initialRow } : null,
                              error: null,
                            }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
            update: pendingActionsUpdate,
          };
        }
        if (table === "audit_log") {
          return {
            insert: async (row: Record<string, unknown>) => {
              auditRows.push(row);
              return { error: null };
            },
          };
        }
        if (table === "agent_channels") {
          return {
            // deno-lint-ignore no-explicit-any
            upsert: async (row: Record<string, unknown>, _o?: any) => {
              upserts.push(row);
              return { error: null };
            },
          };
        }
        if (table === "invoice_docs") {
          return {
            select: () => {
              const q: Record<string, unknown> = {};
              q.eq = () => q;
              q.maybeSingle = () => Promise.resolve({ data: inv, error: null });
              return q;
            },
            update: (patch: Record<string, unknown>) => {
              const q: Record<string, unknown> = {};
              q.eq = () => q;
              q.neq = () => q;
              q.select = () => {
                if (inv && !invoiceFlipped && patch.status === "paid" && inv.status !== "paid") {
                  invoiceFlipped = true;
                  Object.assign(inv, patch);
                  return Promise.resolve({ data: [{ id: inv.id }], error: null });
                }
                return Promise.resolve({ data: [], error: null });
              };
              return q;
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    },
    state: {
      get claimed() {
        return claimed;
      },
      get invoice() {
        return inv;
      },
      get invoiceFlipped() {
        return invoiceFlipped;
      },
      auditRows,
      upserts,
      scrubPatches,
    },
  };
}

const io: ApprovalIO = {
  env: (k) => ({ RESEND_API_KEY: "re_test", SUPABASE_URL: "" })[k],
  forgetCreds: () => {},
  sendTelegram: async () => {},
  sendWhatsApp: async () => {},
  sendSlack: async () => {},
  logOutbound: async () => {},
};

const reminderRow = {
  id: "pa-1",
  code: "1234",
  action: "send_payment_reminder",
  user_id: "OWNER",
  org_id: "ORG",
  status: "pending",
  created_at: new Date().toISOString(),
  payload: { invoice_id: 9, number: "INV-1", customer_email: "c@x.test", customer_name: "C" },
};

Deno.test("APPROVE executes exactly once — the losing duplicate is refused", async () => {
  const posts: { headers: Record<string, string>; body: unknown }[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    posts.push({ headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ id: "em-1" }), { status: 200 });
    // deno-lint-ignore no-explicit-any
  }) as any;
  try {
    const f = fakeClient(reminderRow);
    const first = await handleApproval(f.client, "OWNER", "APPROVE 1234", io);
    assertEquals(first?.startsWith("✅ Sent"), true);
    assertEquals(posts.length, 1, "executor must run once");
    // Second APPROVE of the same code (concurrent-reader simulation): the
    // conditional update reports zero rows → already handled, never executed.
    const second = await handleApproval(f.client, "OWNER", "APPROVE 1234", io);
    assertEquals(second?.includes("already handled"), true);
    assertEquals(posts.length, 1, "side effect must not fire twice");
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("Resend POST carries the pending-action id as Idempotency-Key", async () => {
  const posts: { headers: Record<string, string> }[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    posts.push({ headers: init?.headers as Record<string, string> });
    return new Response(JSON.stringify({}), { status: 200 });
    // deno-lint-ignore no-explicit-any
  }) as any;
  try {
    const f = fakeClient(reminderRow);
    await handleApproval(f.client, "OWNER", "APPROVE 1234", io);
    assertEquals(posts[0].headers["Idempotency-Key"], "pa-1");
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("CANCEL rejects without executing and an APPROVE after it is inert", async () => {
  const posts: unknown[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    posts.push(1);
    return new Response(JSON.stringify({}), { status: 200 });
    // deno-lint-ignore no-explicit-any
  }) as any;
  try {
    const f = fakeClient(reminderRow);
    const cancelled = await handleApproval(f.client, "OWNER", "CANCEL 1234", io);
    assertEquals(cancelled, "Canceled — nothing was sent.");
    assertEquals(posts.length, 0, "cancel must not send anything");
    const approved = await handleApproval(f.client, "OWNER", "APPROVE 1234", io);
    assertEquals(approved?.includes("already handled"), true);
    assertEquals(posts.length, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("a code with no live matching row answers 'expired or already run'", async () => {
  const f = fakeClient(null);
  const reply = await handleApproval(f.client, "OWNER", "APPROVE 9999", io);
  assertEquals(reply?.includes("may have expired or already run"), true);
});

Deno.test("connect_channel approval scrubs parked credentials from the row", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  try {
    const f = fakeClient({
      id: "pa-2",
      code: "2345",
      action: "connect_channel",
      user_id: "OWNER",
      org_id: "default",
      status: "pending",
      created_at: new Date().toISOString(),
      payload: { provider: "whatsapp", token: "EAAG-secret", phone_number_id: "pnid-1", signing_secret: null },
    });
    const reply = await handleApproval(f.client, "OWNER", "APPROVE 2345", io);
    assertEquals(reply?.startsWith("✅ whatsapp is wired up"), true);
    const scrubbed = f.state.scrubPatches.at(-1) as Record<string, string>;
    assertEquals(scrubbed.token, "[scrubbed]");
    assertEquals(Object.values(scrubbed).includes("EAAG-secret"), false);
    assertEquals(f.state.upserts.length, 1, "channel must be configured");
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("mark_invoice_paid executor flips the invoice and audits owner approval", async () => {
  const f = fakeClient(
    {
      id: "pa-3",
      code: "3456",
      action: "mark_invoice_paid",
      user_id: "OWNER",
      org_id: "ORG",
      status: "pending",
      created_at: new Date().toISOString(),
      payload: { invoice_id: 77, invoice_number: "INV-2026-0077" },
    },
    { id: 77, number: "INV-2026-0077", status: "sent" },
  );
  const reply = await handleApproval(f.client, "OWNER", "APPROVE 3456", io);
  assertEquals(reply, "✅ Invoice INV-2026-0077 is marked paid.");
  assertEquals(f.state.invoiceFlipped, true);
  assertEquals(f.state.invoice?.status, "paid");
  assertEquals(f.state.auditRows.length, 1);
  assertEquals(f.state.auditRows[0].actor, "agent");
  assertEquals(f.state.auditRows[0].action, "agent.mark_invoice_paid");
  assertEquals(String(f.state.auditRows[0].details).includes("3456"), true);

  // Re-approval can't re-run anything: the action row is terminal.
  const again = await handleApproval(f.client, "OWNER", "APPROVE 3456", io);
  assertEquals(again?.includes("already handled"), true);
});
