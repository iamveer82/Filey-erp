import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import CrmToday from "./CrmToday";
import { billing, type InvoiceDocSummary } from "../../lib/api";
import { emptyCrmData } from "../../lib/crmWorkspace";
vi.mock("../../lib/api", () => ({ billing: { listDocs: vi.fn() } }));
vi.mock("../../lib/agentStorage", () => ({ agentStorageScope: () => "test", requireAgentStorageScope: () => "test" }));
afterEach(cleanup);
it("removes stale invoice balances when a refresh fails and keeps CRM work available", async () => {
  vi.mocked(billing.listDocs).mockResolvedValueOnce([{ id: 1, number: "INV-1", status: "sent", balance: 100, due_date: "2000-01-01" }] as InvoiceDocSummary[]).mockRejectedValueOnce(new Error("Offline"));
  const data = emptyCrmData(); data.tasks = [{ id: 1, title: "Call buyer", status: "open" }];
  const view = (value: typeof data) => <MemoryRouter><CrmToday data={value} disabled={false} onOpen={vi.fn()} onAdd={vi.fn()} onComplete={vi.fn()}/></MemoryRouter>;
  const rendered = render(view(data)); await screen.findByRole("link", { name: "INV-1" });
  rendered.rerender(view({ ...data }));
  await screen.findByText(/Invoice follow-ups could not refresh: Offline/);
  await waitFor(() => expect(screen.queryByRole("link", { name: "INV-1" })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: /^Call buyer$/ })).toBeInTheDocument();
});
