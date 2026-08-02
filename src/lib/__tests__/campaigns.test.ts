import { describe, it, expect, vi, beforeEach } from "vitest";

const sendEmail = vi.fn();
const optOuts = vi.fn();
vi.mock("../email", () => ({
  sendEmail,
  emailShell: (_t: string, body: string) => `<html>${body}</html>`,
  esc: (v: unknown) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;"),
}));
vi.mock("../api", () => ({ crm: { optOuts } }));

const {
  buildRecipients,
  renderTemplate,
  sendCampaign,
  unsubscribeFooter,
  normalizeEmail,
} = await import("../campaigns");
import type { Lead } from "../marketing";
import type { Campaign, CampaignRecipient, CrmCustomer } from "../api";

const lead = (id: number, name: string, email?: string, score = 50): Lead =>
  ({
    customer: { id, name, email } as CrmCustomer,
    score,
    reasons: [],
    revenue: 0,
    invoices: 0,
    overdue: 0,
    daysSinceActivity: null,
    domain: null,
    incomplete: false,
  }) as Lead;

const campaign = (recipients: CampaignRecipient[]): Campaign =>
  ({
    id: 1,
    name: "August offer",
    subject: "Hello {{first_name}}",
    body_html: "<p>Hi {{first_name}}, from {{company}}.</p>",
    status: "draft",
    audience: {},
    recipients,
    sent_count: 0,
    failed_count: 0,
  }) as Campaign;

beforeEach(() => {
  sendEmail.mockReset().mockResolvedValue(undefined);
  optOuts.mockReset().mockResolvedValue([]);
});

describe("renderTemplate", () => {
  it("fills merge fields, including a first name split off the full name", () => {
    const out = renderTemplate("Hi {{first_name}} at {{company}}", {
      name: "Asha Rahman",
      company: "Acme",
      email: "a@acme.ae",
    } as CrmCustomer);
    expect(out).toBe("Hi Asha at Acme");
  });

  it("escapes values so a customer name cannot inject markup", () => {
    const out = renderTemplate("Hi {{name}}", {
      name: "<script>alert(1)</script>",
      email: "",
    } as CrmCustomer);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("leaves an unknown placeholder alone rather than blanking it", () => {
    expect(
      renderTemplate("Hi {{nickname}}", { name: "A", email: "" } as CrmCustomer)
    ).toBe("Hi {{nickname}}");
  });
});

describe("buildRecipients", () => {
  it("excludes opted-out addresses and records why", () => {
    const rs = buildRecipients(
      [lead(1, "Ok", "ok@a.ae"), lead(2, "Gone", "gone@a.ae")],
      new Set(["gone@a.ae"])
    );
    expect(rs.find((r) => r.email === "ok@a.ae")!.status).toBe("pending");
    const gone = rs.find((r) => r.email === "gone@a.ae")!;
    expect(gone.status).toBe("skipped");
    expect(gone.error).toBe("Unsubscribed");
  });

  it("mails a shared address once, however many records use it", () => {
    const rs = buildRecipients(
      [lead(1, "A", "same@a.ae"), lead(2, "B", "same@a.ae")],
      new Set()
    );
    expect(rs.filter((r) => r.status === "pending")).toHaveLength(1);
    expect(rs.find((r) => r.status === "skipped")!.error).toMatch(/duplicate/i);
  });

  it("matches opt-outs case-insensitively", () => {
    const rs = buildRecipients(
      [lead(1, "A", "Sales@Acme.AE")],
      new Set(["sales@acme.ae"])
    );
    expect(rs[0].status).toBe("skipped");
  });

  it("honours a minimum score", () => {
    const rs = buildRecipients(
      [lead(1, "Hot", "h@a.ae", 80), lead(2, "Cold", "c@a.ae", 10)],
      new Set(),
      { minScore: 60 }
    );
    expect(rs).toHaveLength(1);
    expect(rs[0].name).toBe("Hot");
  });
});

describe("sendCampaign", () => {
  const opts = {
    customers: [] as CrmCustomer[],
    fromName: "Acme",
    replyTo: "hello@acme.ae",
    delayMs: 0,
  };

  it("sends to pending recipients and appends an unsubscribe line to each", async () => {
    const { progress } = await sendCampaign({
      ...opts,
      campaign: campaign([
        { customer_id: 1, name: "A", email: "a@x.ae", status: "pending" },
        { customer_id: 2, name: "B", email: "b@x.ae", status: "pending" },
      ]),
    });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    for (const [msg] of sendEmail.mock.calls) expect(msg.html).toMatch(/unsubscribe/i);
    expect(progress.sent).toBe(2);
  });

  it("never sends to an address that opted out after the campaign was drafted", async () => {
    optOuts.mockResolvedValue([{ email: "B@X.ae", reason: "unsubscribed" }]);
    const { recipients, progress } = await sendCampaign({
      ...opts,
      campaign: campaign([
        { customer_id: 1, name: "A", email: "a@x.ae", status: "pending" },
        { customer_id: 2, name: "B", email: "b@x.ae", status: "pending" },
      ]),
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe("a@x.ae");
    expect(recipients[1].status).toBe("skipped");
    expect(progress.sent).toBe(1);
  });

  it("does not re-send to anyone already marked sent", async () => {
    await sendCampaign({
      ...opts,
      campaign: campaign([
        { customer_id: 1, name: "A", email: "a@x.ae", status: "sent" },
        { customer_id: 2, name: "B", email: "b@x.ae", status: "pending" },
      ]),
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe("b@x.ae");
  });

  it("stops at the daily cap and leaves the rest pending, not failed", async () => {
    sendEmail
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Daily email limit reached for your plan"));
    const { recipients, progress } = await sendCampaign({
      ...opts,
      campaign: campaign([
        { customer_id: 1, name: "A", email: "a@x.ae", status: "pending" },
        { customer_id: 2, name: "B", email: "b@x.ae", status: "pending" },
        { customer_id: 3, name: "C", email: "c@x.ae", status: "pending" },
      ]),
    });
    expect(progress.sent).toBe(1);
    expect(progress.failed).toBe(0);
    expect(recipients[1].status).toBe("pending"); // resumable
    expect(recipients[2].status).toBe("pending");
    expect(progress.stoppedBecause).toMatch(/daily/i);
  });

  it("records a genuine per-recipient failure and carries on", async () => {
    sendEmail
      .mockRejectedValueOnce(new Error("Mailbox does not exist"))
      .mockResolvedValueOnce(undefined);
    const { recipients, progress } = await sendCampaign({
      ...opts,
      campaign: campaign([
        { customer_id: 1, name: "A", email: "a@x.ae", status: "pending" },
        { customer_id: 2, name: "B", email: "b@x.ae", status: "pending" },
      ]),
    });
    expect(recipients[0].status).toBe("failed");
    expect(recipients[0].error).toMatch(/mailbox/i);
    expect(progress.sent).toBe(1);
    expect(progress.failed).toBe(1);
  });

  it("stops when the caller asks it to", async () => {
    let calls = 0;
    const { progress } = await sendCampaign({
      ...opts,
      shouldStop: () => calls++ >= 1,
      campaign: campaign([
        { customer_id: 1, name: "A", email: "a@x.ae", status: "pending" },
        { customer_id: 2, name: "B", email: "b@x.ae", status: "pending" },
      ]),
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(progress.stoppedBecause).toBe("Stopped");
  });
});

describe("unsubscribeFooter", () => {
  it("carries a working mailto and escapes the business name", () => {
    const html = unsubscribeFooter("A & B <Trading>", "hello@a.ae");
    expect(html).toContain('href="mailto:hello@a.ae?subject=Unsubscribe"');
    expect(html).toContain("A &amp; B &lt;Trading&gt;");
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims, and survives nothing at all", () => {
    expect(normalizeEmail("  Sales@Acme.AE ")).toBe("sales@acme.ae");
    expect(normalizeEmail(undefined)).toBe("");
  });
});

describe("sendCampaign — environmental failures", () => {
  it("pauses instead of failing everyone when email is unavailable offline", async () => {
    sendEmail.mockRejectedValue(new Error("Email is not available — sign in to send."));
    const { recipients, progress } = await sendCampaign({
      customers: [],
      fromName: "Acme",
      replyTo: "hello@acme.ae",
      delayMs: 0,
      campaign: campaign([
        { customer_id: 1, name: "A", email: "a@x.ae", status: "pending" },
        { customer_id: 2, name: "B", email: "b@x.ae", status: "pending" },
      ]),
    });
    expect(progress.failed).toBe(0);
    expect(recipients.every((r) => r.status === "pending")).toBe(true);
    expect(progress.stoppedBecause).toMatch(/sign in/i);
  });
});
