import { beforeEach, expect, it } from "vitest";
import { cleanRowForPush } from "../sync";
import { localClient, replaceColl } from "../localdb";

beforeEach(() => { localStorage.clear(); localStorage.setItem("filey_data_mode", "local"); });

it.each(["invoice_docs", "quotations", "purchase_orders", "payment_receipts"])(
  "%s retains downloaded public-link status locally but cannot upload it as consent", async table => {
    const row = { id: 17, number: "DOC-17", notes: "Original", public_shared: true,
      share_token: "10000000-0000-4000-8000-000000000001", shared: false, sync_revision: 4 };
    await replaceColl(table, [row]);
    await localClient.from(table).update({ notes: "Local edit" }).eq("id", 17);
    const result = await localClient.from(table).select().eq("id", 17).single();
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ ...row, notes: "Local edit" });
    const pushed = cleanRowForPush(result.data, "alice", table);
    expect(pushed).not.toHaveProperty("public_shared");
    expect(pushed).not.toHaveProperty("share_token");
    expect(pushed).toMatchObject({ notes: "Local edit", shared: false });
    expect(result.data.public_shared).toBe(true);
    expect(result.data.share_token).toBe(row.share_token);
  });
