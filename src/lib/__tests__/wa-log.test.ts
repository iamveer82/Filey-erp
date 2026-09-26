import { setCacheOrg } from "../api";
import { beforeEach, describe, expect, it } from "vitest";
import { waLogAdd, waLogClear, waLogList } from "../waLog";
import { WA_HEADER, waFormat } from "../waAgent";

/* The WhatsApp thread is the only record the in-app agent can read back — the
 * platform hands us no history — so the log has to keep the right end of it. */

beforeEach(() => { localStorage.setItem("filey_data_mode", "local"); setCacheOrg("test-org", "test-user"); waLogClear(); });

describe("waLogList", () => {
  it("keeps document outcomes across reopening and isolates them from another account", () => {
    const document = { key: "invoice:1", filename: "Invoice.pdf", channel: "whatsapp" as const, outcome: "unknown" as const };
    waLogAdd({ dir: "out", from: "971501234567", text: "[outcome unknown] Invoice", document });
    expect(waLogList()[0].document).toEqual(document);
    setCacheOrg("test-org", "another-user"); expect(waLogList()).toEqual([]);
    setCacheOrg("test-org", "test-user"); expect(waLogList()[0].document?.outcome).toBe("unknown");
  });
  it("returns newest last and honours the limit", () => {
    for (let i = 0; i < 5; i++)
      waLogAdd({ dir: "in", from: "971501234567", text: `m${i}` });
    const rows = waLogList({ limit: 2 });
    expect(rows.map((r) => r.text)).toEqual(["m3", "m4"]);
  });

  it("filters by number however it is written", () => {
    waLogAdd({ dir: "in", from: "971501234567", text: "owner" });
    waLogAdd({ dir: "in", from: "971509999999", text: "someone else" });
    const rows = waLogList({ from: "+971 50 123 4567@s.whatsapp.net" });
    expect(rows.map((r) => r.text)).toEqual(["owner"]);
  });

  it("caps the stored history instead of growing forever", () => {
    for (let i = 0; i < 260; i++) waLogAdd({ dir: "out", from: "1", text: `m${i}` });
    const all = waLogList({ limit: 200 });
    expect(all).toHaveLength(200);
    expect(all[all.length - 1].text).toBe("m259");
  });
});

/* Every outgoing message wears the agent header — once, and never on the empty
 * reply that means "stay silent". */
describe("waFormat", () => {
  it("prefixes the header", () => {
    expect(waFormat("Draft created.")).toBe(`${WA_HEADER}\n\nDraft created.`);
  });

  it("doesn't double it when the model already wrote it", () => {
    expect(waFormat(`${WA_HEADER}\n\nDraft created.`)).toBe(
      `${WA_HEADER}\n\nDraft created.`
    );
  });

  it("leaves silence silent", () => {
    expect(waFormat("")).toBe("");
    expect(waFormat("   ")).toBe("");
  });
});
