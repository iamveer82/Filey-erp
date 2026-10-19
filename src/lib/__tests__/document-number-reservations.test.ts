import { expect, it, vi } from "vitest";

vi.mock("../api", () => ({ getCacheOrg: () => null, getCacheScope: () => null }));
vi.mock("../supabase", () => ({ sb: () => ({}) }));

import { liveReservations } from "../documentNumbers";

const now = Date.parse("2026-10-19T09:00:00Z");
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

it("lets an abandoned reservation go so numbering follows the saved invoices", () => {
  const rows = [
    { number: "INV-DLS-031-26", created_at: ago(120) }, // saved: always counts
    { number: "INV-DLS-032-26", created_at: ago(30) },  // failed attempt / deleted draft
    { number: "INV-DLS-033-26", created_at: ago(20) },
    { number: "INV-DLS-034-26", created_at: ago(2) },   // still being saved
  ];
  expect(liveReservations(rows, ["INV-DLS-031-26"], now)).toEqual(["INV-DLS-031-26", "INV-DLS-034-26"]);
});

it("keeps a reservation without a readable time, rather than risk a duplicate", () => {
  expect(liveReservations([{ number: "INV-7" }, { number: "INV-8", created_at: "garbage" }], [], now)).toEqual(["INV-7", "INV-8"]);
});
