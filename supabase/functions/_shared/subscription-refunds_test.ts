import {
  billingReviewer,
  checkRefundPayment,
  subscriptionRefundAction,
  reconcileSubscriptionRefund,
} from "./subscription-refunds.ts";
function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
async function rejects(fn: () => unknown, pattern: RegExp) {
  try {
    await fn();
  } catch (e) {
    assert(pattern.test(String(e)), String(e));
    return;
  }
  throw new Error("Expected rejection");
}
function setup() {
  Deno.env.set("DODO_PRODUCT_CLOUD", "pdt_pro");
  Deno.env.set("FILEY_BILLING_ADMIN_USER_IDS", "merchant");
  const payment = {
    payment_id: "pay_fixture",
    subscription_id: "sub_fixture",
    customer: { customer_id: "cus_fixture" },
    status: "succeeded",
    total_amount: 500,
    currency: "USD",
    metadata: {} as Record<string, string>,
    refunds: [] as {
      refund_id: string;
      status: string;
      amount: number;
      currency: string;
    }[],
    disputes: [],
  };
  const rows: Record<string, unknown>[] = [];
  let creates = 0,
    uncertain = false;
  const db = {
    from() {
      let patch: Record<string, unknown> | undefined,
        insert: Record<string, unknown> | undefined,
        single = false;
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      const q = {
        select() {
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        eq(k: string, v: unknown) {
          filters.push((r) => r[k] === v);
          return q;
        },
        in(k: string, v: unknown[]) {
          filters.push((r) => v.includes(r[k]));
          return q;
        },
        update(value: Record<string, unknown>) {
          patch = value;
          return q;
        },
        insert(value: Record<string, unknown>) {
          insert = value;
          return q;
        },
        single() {
          single = true;
          return q;
        },
        maybeSingle() {
          single = true;
          return q;
        },
        then(resolve: (v: unknown) => void) {
          if (insert) {
            if (rows.some((r) => r.payment_id === insert!.payment_id))
              return resolve({ error: { code: "23505" } });
            rows.push({
              id: "request-fixture",
              status: "requested",
              refunded_amount: 0,
              ...insert,
            });
          }
          const matches = rows.filter((r) => filters.every((f) => f(r)));
          if (patch) matches.forEach((r) => Object.assign(r, patch));
          resolve({
            data: single
              ? matches[0]
                ? { ...matches[0] }
                : null
              : matches.map((r) => ({ ...r })),
            error: null,
          });
        },
      };
      return q;
    },
  } as unknown as Parameters<typeof subscriptionRefundAction>[1];
  const dodo = {
    payments: {
      retrieve: async () => structuredClone(payment),
      list: async () => ({ items: [payment] }),
    },
    subscriptions: {
      retrieve: async () => ({
        product_id: "pdt_pro",
        customer: { customer_id: "cus_fixture" },
      }),
    },
    refunds: {
      create: async (_body: unknown, opts: { maxRetries: number }) => {
        creates++;
        assert(opts.maxRetries === 0, "Financial call must not retry");
        if (uncertain) throw new Error("Transport timeout after submission");
        const refund = {
          refund_id: "ref_fixture",
          payment_id: payment.payment_id,
          status: "pending",
          amount: 500,
          currency: "USD",
        };
        payment.refunds.push(refund);
        return refund;
      },
    },
  } as unknown as Parameters<typeof subscriptionRefundAction>[0];
  const org = {
    id: "org-fixture",
    dodo_subscription_id: "sub_fixture",
    dodo_customer_id: "cus_fixture",
  };
  const call = (user: string, body: Record<string, unknown>, workspace = org) =>
    subscriptionRefundAction(dodo, db, user, workspace, body);
  const request = () =>
    call("customer", {
      action: "request_subscription_refund",
      payment_id: "pay_fixture",
      reason: "This subscription is no longer needed.",
    });
  return {
    payment,
    rows,
    db,
    dodo,
    org,
    call,
    request,
    creates: () => creates,
    uncertain: () => {
      uncertain = true;
    },
  };
}
Deno.test(
  "refund requests exclude AI credits, another customer, another subscription and duplicates",
  async () => {
    const t = setup();
    t.payment.metadata.type = "ai_credits";
    await rejects(t.request, /Only this workspace/);
    t.payment.metadata = {};
    await rejects(
      () =>
        t.call(
          "customer",
          {
            action: "request_subscription_refund",
            payment_id: "pay_fixture",
            reason: "Please refund this payment.",
          },
          { ...t.org, dodo_customer_id: "cus_other" }
        ),
      /Only this workspace/
    );
    await rejects(
      () => checkRefundPayment(t.payment as never, "sub_other", "cus_fixture"),
      /Only this workspace/
    );
    assert(t.rows.length === 0 && t.creates() === 0);
    await t.request();
    await t.request();
    assert(
      Number(t.rows.length) === 1 && t.creates() === 0,
      "Requests must not move money"
    );
  }
);
Deno.test(
  "only merchant allowlist can approve; concurrent approval creates one refund",
  async () => {
    const t = setup();
    await t.request();
    Deno.env.set("OWNER_USER_ID", "workspace-owner");
    assert(!billingReviewer("workspace-owner") && !billingReviewer("customer"));
    const action = {
      action: "review_subscription_refund",
      id: "request-fixture",
      decision: "approve",
      note: "Approved after checking the payment.",
    };
    await rejects(() => t.call("customer", action), /billing administrators/);
    await Promise.all([t.call("merchant", action), t.call("merchant", action)]);
    assert(t.creates() === 1 && String(t.rows[0].status) === "pending");
    t.payment.refunds[0].status = "succeeded";
    await reconcileSubscriptionRefund(t.dodo, t.db, "pay_fixture");
    await reconcileSubscriptionRefund(t.dodo, t.db, "pay_fixture");
    assert(String(t.rows[0].status) === "refunded" && t.rows[0].refunded_amount === 500);
  }
);
Deno.test(
  "uncertain refund submission cannot be re-approved and late webhook resolves it",
  async () => {
    const t = setup();
    await t.request();
    t.uncertain();
    const action = {
      action: "review_subscription_refund",
      id: "request-fixture",
      decision: "approve",
      note: "Approved after checking the payment.",
    };
    await t.call("merchant", action);
    await t.call("merchant", action);
    assert(t.creates() === 1 && String(t.rows[0].status) === "needs_review");
    t.payment.refunds.push({
      refund_id: "ref_late",
      status: "succeeded",
      amount: 500,
      currency: "USD",
    });
    await reconcileSubscriptionRefund(t.dodo, t.db, "pay_fixture");
    assert(String(t.rows[0].status) === "refunded");
    t.payment.refunds = [];
    await reconcileSubscriptionRefund(t.dodo, t.db, "pay_fixture");
    assert(String(t.rows[0].status) === "refunded", "Never regress a completed refund");
  }
);
Deno.test(
  "rejection creates no refund and existing provider refunds block a new submission",
  async () => {
    const t = setup();
    await t.request();
    await t.call("merchant", {
      action: "review_subscription_refund",
      id: "request-fixture",
      decision: "reject",
      note: "Duplicate customer request.",
    });
    assert(t.creates() === 0 && String(t.rows[0].status) === "rejected");
    t.payment.refunds.push({
      refund_id: "ref_existing",
      status: "succeeded",
      amount: 100,
      currency: "USD",
    });
    await rejects(t.request, /already has a refund/);
    await reconcileSubscriptionRefund(t.dodo, t.db, "pay_fixture");
    assert(
      String(t.rows[0].status) === "partially_refunded" &&
        t.rows[0].refunded_amount === 100
    );
  }
);
