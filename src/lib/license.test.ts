// The licence gate must never trap data already on the device: an unlicensed
// install that has offline data can still switch back to local mode.
import { describe, it, expect, beforeEach } from "vitest";
import { canUseLocalMode, hasLocalData } from "./license";

beforeEach(() => localStorage.clear());

describe("canUseLocalMode", () => {
  it("recognizes a workspace containing only CRM tasks as existing data", async () => {
    localStorage.setItem("localdb:crm_tasks", JSON.stringify([{ id: 1, title: "Keep me" }]));
    expect(await hasLocalData()).toBe(true);
    expect(await canUseLocalMode()).toBe(true);
  });
  it("allows a fresh unlicensed device", async () => {
    expect(await canUseLocalMode()).toBe(true);
  });

  it("allows a device that already holds local data", async () => {
    localStorage.setItem("localdb:invoice_docs", JSON.stringify([{ id: 1 }]));
    expect(await canUseLocalMode()).toBe(true);
  });

  it("treats an empty collection as no data", async () => {
    localStorage.setItem("localdb:invoice_docs", "[]");
    expect(await canUseLocalMode()).toBe(true);
  });
});
