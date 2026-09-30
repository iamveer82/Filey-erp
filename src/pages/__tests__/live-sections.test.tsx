import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { UIProvider } from "../../lib/ui";
import { notifyDataChanged } from "../../lib/realtime";
import BankAccounts from "../BankAccounts";
import ChequeRegister from "../ChequeRegister";
import Marketing from "../Marketing";
import EmailTemplates from "../EmailTemplates";
import CampaignsPanel from "../../components/CampaignsPanel";

const mock = vi.hoisted(() => ({
  scope: "org:user:alice",
  settings: vi.fn(),
  setSetting: vi.fn(),
  customers: vi.fn(),
  campaigns: vi.fn(),
}));
vi.mock("../../lib/api", () => ({
  getCacheScope: () => mock.scope,
  tools: { settings: mock.settings, setSetting: mock.setSetting },
  fin: {},
  crm: { customers: mock.customers, campaigns: mock.campaigns, optOuts: async () => [] },
  billing: { getCompany: async () => ({ name: "Test company" }), listDocs: async () => [] },
}));
vi.mock("../../lib/supabase", () => ({ supabase: null, isConfigured: false }));

const bank = { id: 1, bank_name: "AI bank entry", account_name: "Operating", account_number: "", iban: "", currency: "AED", opening_balance: 50, current_balance: 50, created_at: "2026-09-08" };
const cheque = { id: 1, cheque_no: "AI-CHEQUE", type: "received", party: "AI cheque party", bank: "Test bank", amount: 50, issue_date: "2026-09-08", due_date: "2026-09-09", status: "pending", notes: "", created_at: "2026-09-08" };
const ledgers = [
  { name: "bank accounts", Page: BankAccounts, key: "filey_bank_accounts", setting: "bank_accounts", row: bank, text: bank.bank_name, add: "Add account", field: "Bank Name *" },
  { name: "cheques", Page: ChequeRegister, key: "filey_cheques", setting: "cheque_register", row: cheque, text: cheque.party, add: "New cheque", field: "Party *" },
];
const cacheKey = (key: string, scope = mock.scope, mode = "local") => `${key}:${encodeURIComponent(`${mode}:${scope}`)}`;
const wrap = (node: ReactElement) => render(<MemoryRouter><UIProvider>{node}</UIProvider></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  mock.scope = "org:user:alice";
  mock.settings.mockReset().mockResolvedValue([]);
  mock.setSetting.mockReset().mockResolvedValue(undefined);
  mock.customers.mockReset().mockResolvedValue([]);
  mock.campaigns.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

describe.each(ledgers)("live $name", ({ Page, key, setting, row, text, add, field }) => {
  it("ignores unattributed, other-account and other-mode caches without changing records", async () => {
    for (const entry of [key, cacheKey(key, "org:user:bob"), cacheKey(key, mock.scope, "cloud")])
      localStorage.setItem(entry, JSON.stringify([row]));
    const view = wrap(<Page />);
    await waitFor(() => expect(mock.settings).toHaveBeenCalledOnce());
    expect(view.queryByText(text)).toBeNull();
    expect(localStorage.getItem(key)).toContain(text);
    expect(mock.setSetting).not.toHaveBeenCalled();
  });

  it("refreshes after an agent write and preserves an open draft", async () => {
    const view = wrap(<Page />);
    await waitFor(() => expect(mock.settings).toHaveBeenCalledOnce());
    fireEvent.click(view.getByRole("button", { name: add }));
    fireEvent.change(await view.findByRole("textbox", { name: field }), { target: { value: "Unsaved draft" } });
    mock.settings.mockResolvedValue([{ key: setting, value: JSON.stringify([row]) }]);
    act(() => notifyDataChanged());
    expect(await view.findByText(text)).toBeTruthy();
    expect(view.getByDisplayValue("Unsaved draft")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(cacheKey(key))!)).toEqual([row]);
    expect(mock.setSetting).not.toHaveBeenCalled();
  });

  it("keeps the entered draft and original cache when the durable save fails", async () => {
    const originalKey=cacheKey(key);localStorage.setItem(originalKey,"[]");
    const view=wrap(<Page />);
    await waitFor(()=>expect(mock.settings).toHaveBeenCalledOnce());
    fireEvent.click(view.getByRole("button",{name:add}));
    fireEvent.change(await view.findByRole("textbox",{name:field}),{target:{value:"Unsaved fixture"}});
    if (setting==="bank_accounts") fireEvent.change(view.getByRole("textbox",{name:"Account Name *"}),{target:{value:"Operating"}});
    else {
      fireEvent.change(view.getByRole("textbox",{name:"Cheque Number *"}),{target:{value:"FIXTURE-1"}});
      fireEvent.change(view.getByRole("spinbutton",{name:/Amount/}),{target:{value:"25"}});
    }
    mock.setSetting.mockRejectedValue(new Error("Fixture disk full"));
    fireEvent.click(view.getByRole("button",{name:setting==="bank_accounts"?"Create account":"Create cheque"}));
    await waitFor(()=>expect(mock.setSetting).toHaveBeenCalledOnce());
    expect(await view.findByText("Fixture disk full")).toBeTruthy();
    expect(view.getByDisplayValue("Unsaved fixture")).toBeTruthy();
    expect(localStorage.getItem(originalKey)).toBe("[]");
  });

  it("discards a pending settings response after the account changes", async () => {
    let resolve!: (rows: { key: string; value: string }[]) => void;
    mock.settings.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = wrap(<Page />);
    const originalKey = cacheKey(key);
    mock.scope = "org:user:bob";
    await act(async () => resolve([{ key: setting, value: JSON.stringify([row]) }]));
    expect(view.queryByText(text)).toBeNull();
    expect(localStorage.getItem(originalKey)).toBeNull();
    expect(localStorage.getItem(cacheKey(key))).toBeNull();
    expect(mock.setSetting).not.toHaveBeenCalled();
  });
});

it("refreshes marketing leads when a customer is added elsewhere", async () => {
  const view = wrap(<Marketing />);
  await waitFor(() => expect(mock.customers).toHaveBeenCalledOnce());
  mock.customers.mockResolvedValue([{ id: 1, name: "New AI customer", email: "new@example.test" }]);
  act(() => notifyDataChanged());
  expect(await view.findByText("New AI customer")).toBeTruthy();
});

it("refreshes campaigns without replacing a message being composed", async () => {
  const view = wrap(<CampaignsPanel leads={[]} />);
  await waitFor(() => expect(mock.campaigns).toHaveBeenCalledOnce());
  fireEvent.click(view.getByRole("button", { name: "New campaign" }));
  fireEvent.change(view.getByRole("textbox", { name: "Campaign name" }), { target: { value: "Unsaved campaign" } });
  mock.campaigns.mockResolvedValue([{ id: 1, name: "AI campaign draft", subject: "Hello", status: "draft", recipients: [], sent_count: 0, failed_count: 0 }]);
  act(() => notifyDataChanged());
  expect(await view.findByText("AI campaign draft")).toBeTruthy();
  expect(view.getByDisplayValue("Unsaved campaign")).toBeTruthy();
});

const emailKey = "filey_email_templates";
const emailTemplate = { id: 1, name: "Alice template", subject: "Private subject", body: "Private body", category: "General", created_at: "2026-09-08" };

it("does not adopt shared email templates or write starters until explicitly requested", async () => {
  localStorage.setItem(emailKey, JSON.stringify([emailTemplate]));
  localStorage.setItem(cacheKey(emailKey, "org:user:bob"), JSON.stringify([emailTemplate]));
  const view = wrap(<EmailTemplates />);
  const starters = await view.findByRole("button", { name: "Use starter templates" });
  expect(view.queryByText("Alice template")).toBeNull();
  expect(mock.setSetting).not.toHaveBeenCalled();
  fireEvent.click(starters);
  expect(await view.findByText("Invoice Due")).toBeTruthy();
  expect(mock.setSetting).toHaveBeenCalledOnce();
  expect(mock.setSetting).toHaveBeenCalledWith("email_templates", expect.any(String));
  expect(localStorage.getItem(emailKey)).toContain("Private body");
});

it("refreshes persisted email templates without resetting an unsaved editor", async () => {
  localStorage.setItem(cacheKey(emailKey), JSON.stringify([emailTemplate]));
  const view = wrap(<EmailTemplates />);
  expect(await view.findByText("Alice template")).toBeTruthy();
  await waitFor(() => expect(view.getByRole("button", { name: "New template" })).not.toBeDisabled());
  fireEvent.click(view.getByRole("button", { name: "New template" }));
  fireEvent.change(view.getByRole("textbox", { name: "Template Name *" }), { target: { value: "Unsaved email template" } });
  mock.settings.mockResolvedValue([{ key: "email_templates", value: JSON.stringify([{ ...emailTemplate, name: "Updated elsewhere" }]) }]);
  act(() => notifyDataChanged());
  expect(await view.findByText("Updated elsewhere")).toBeTruthy();
  expect(view.getByDisplayValue("Unsaved email template")).toBeTruthy();
  expect(mock.setSetting).not.toHaveBeenCalled();
});

it("deletes from the latest template list after a confirmation waits through a refresh", async () => {
  localStorage.setItem(cacheKey(emailKey), JSON.stringify([emailTemplate]));
  const view = wrap(<EmailTemplates />);
  await waitFor(() => expect(view.getByRole("button", { name: "New template" })).toBeEnabled());
  fireEvent.click(view.getByRole("button", { name: "More actions" }));
  fireEvent.click(await view.findByRole("menuitem", { name: "Delete" }));
  const confirmation = within(await view.findByRole("alertdialog"));
  const added = { ...emailTemplate, id: 2, name: "Added elsewhere" };
  mock.settings.mockResolvedValue([{ key: "email_templates", value: JSON.stringify([emailTemplate, added]) }]);
  act(() => notifyDataChanged());
  expect(await view.findByText("Added elsewhere")).toBeTruthy();
  fireEvent.click(confirmation.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(mock.setSetting).toHaveBeenCalledOnce());
  expect(mock.setSetting).toHaveBeenCalledWith("email_templates", JSON.stringify([added]));
  await waitFor(() => expect(view.queryByText("Alice template")).toBeNull());
  expect(view.getByText("Added elsewhere")).toBeTruthy();
});

it("keeps a template draft and original cache after a failed durable save, then retries", async () => {
  localStorage.setItem(cacheKey(emailKey), JSON.stringify([emailTemplate]));
  const view = wrap(<EmailTemplates />);
  await waitFor(() => expect(view.getByRole("button", { name: "New template" })).toBeEnabled());
  fireEvent.click(view.getByRole("button", { name: "New template" }));
  fireEvent.change(view.getByRole("textbox", { name: "Template Name *" }), { target: { value: "Payment reminder" } });
  fireEvent.change(view.getByRole("textbox", { name: "Subject *" }), { target: { value: "Invoice {{number}}" } });
  mock.setSetting.mockRejectedValueOnce(new Error("Could not save fixture"));
  fireEvent.click(view.getByRole("button", { name: "Create template" }));
  expect(await view.findByText("Could not save fixture")).toBeTruthy();
  expect(view.getByDisplayValue("Payment reminder")).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(cacheKey(emailKey))!)).toEqual([emailTemplate]);
  fireEvent.click(view.getByRole("button", { name: "Create template" }));
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(view.getByText("Payment reminder")).toBeTruthy();
  expect(mock.setSetting).toHaveBeenCalledTimes(2);
});

it("does not claim success or duplicate writes while a template save is pending", async () => {
  let finish!: () => void;
  mock.setSetting.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  const view = wrap(<EmailTemplates />);
  const starters = await view.findByRole("button", { name: "Use starter templates" });
  fireEvent.click(starters);
  fireEvent.click(starters);
  expect(mock.setSetting).toHaveBeenCalledOnce();
  expect(view.queryByText("Starter templates added.")).toBeNull();
  expect(localStorage.getItem(cacheKey(emailKey))).toBeNull();
  await act(async () => finish());
  expect(await view.findByText("Invoice Due")).toBeTruthy();
});

it("does not let a refresh started before a template save overwrite its saved cache", async () => {
  let resolve!: (rows: { key: string; value: string }[]) => void;
  const view = wrap(<EmailTemplates />);
  await view.findByRole("button", { name: "Use starter templates" });
  mock.settings.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  act(() => notifyDataChanged());
  await waitFor(() => expect(mock.settings).toHaveBeenCalledTimes(2));
  fireEvent.click(view.getByRole("button", { name: "Use starter templates" }));
  expect(await view.findByText("Invoice Due")).toBeTruthy();
  const saved = localStorage.getItem(cacheKey(emailKey));
  await act(async () => resolve([{ key: "email_templates", value: JSON.stringify([emailTemplate]) }]));
  expect(view.queryByText("Alice template")).toBeNull();
  expect(localStorage.getItem(cacheKey(emailKey))).toBe(saved);
});

it.each(["account", "mode"])("does not report or mirror a pending save into the next %s workspace", async change => {
  let finish!: () => void;
  mock.setSetting.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const view = wrap(<EmailTemplates />);
  fireEvent.click(await view.findByRole("button", { name: "Use starter templates" }));
  const originalKey = cacheKey(emailKey);
  act(() => {
    if (change === "account") mock.scope = "org:user:bob";
    else localStorage.setItem("filey_data_mode", "cloud");
    window.dispatchEvent(new Event("filey:agent-storage"));
  });
  await view.findByRole("button", { name: "Use starter templates" });
  await act(async () => finish());
  expect(view.queryByText("Starter templates added.")).toBeNull();
  expect(view.queryByText(/Workspace changed while saving/)).toBeNull();
  expect(view.queryByText("Invoice Due")).toBeNull();
  expect(localStorage.getItem(originalKey)).toBeNull();
  expect(localStorage.getItem(cacheKey(emailKey))).toBeNull();
});

it("keeps cached templates and prevents overwrites when their authoritative read fails", async () => {
  localStorage.setItem(cacheKey(emailKey), JSON.stringify([emailTemplate]));
  mock.settings.mockRejectedValueOnce(new Error("Connection failed"));
  const view = wrap(<EmailTemplates />);
  expect(await view.findByText("Couldn't load saved templates. Your current records are preserved.")).toBeTruthy();
  expect(view.getByText("Alice template")).toBeTruthy();
  expect(view.getByRole("button", { name: "New template" })).toBeDisabled();
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(view.getByRole("button", { name: "New template" })).toBeEnabled());
  expect(mock.setSetting).not.toHaveBeenCalled();
});

it("makes a refresh failure recoverable inside an open template editor without losing its draft", async () => {
  const view = wrap(<EmailTemplates />);
  await waitFor(() => expect(view.getByRole("button", { name: "New template" })).toBeEnabled());
  fireEvent.click(view.getByRole("button", { name: "New template" }));
  const editor = within(view.getByRole("dialog"));
  fireEvent.change(editor.getByRole("textbox", { name: "Template Name *" }), { target: { value: "Unsaved reminder" } });
  fireEvent.change(editor.getByRole("textbox", { name: "Subject *" }), { target: { value: "Payment due" } });
  mock.settings.mockRejectedValueOnce(new Error("Fixture unavailable"));
  act(() => notifyDataChanged());
  expect(await editor.findByText("Couldn't load saved templates. Your current records are preserved.")).toBeTruthy();
  expect(editor.getByRole("button", { name: "Create template" })).toBeDisabled();
  fireEvent.click(editor.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(editor.getByRole("button", { name: "Create template" })).toBeEnabled());
  expect(editor.getByDisplayValue("Unsaved reminder")).toBeTruthy();
  expect(mock.setSetting).not.toHaveBeenCalled();
});

it.each(["{}", "[null]"])("preserves cached templates when stored JSON has an invalid shape: %s", async value => {
  localStorage.setItem(cacheKey(emailKey), JSON.stringify([emailTemplate]));
  mock.settings.mockResolvedValue([{ key: "email_templates", value }]);
  const view = wrap(<EmailTemplates />);
  expect(await view.findByText("Couldn't load saved templates. Your current records are preserved.")).toBeTruthy();
  expect(view.getByText("Alice template")).toBeTruthy();
  expect(view.getByRole("button", { name: "New template" })).toBeDisabled();
  expect(mock.setSetting).not.toHaveBeenCalled();
});

it.each(["account", "mode"])("clears email drafts and displayed templates when the %s changes", async (change) => {
  localStorage.setItem(cacheKey(emailKey), JSON.stringify([emailTemplate]));
  const view = wrap(<EmailTemplates />);
  await waitFor(() => expect(view.getByRole("button", { name: "New template" })).not.toBeDisabled());
  fireEvent.click(view.getByRole("button", { name: "New template" }));
  fireEvent.change(view.getByRole("textbox", { name: "Template Name *" }), { target: { value: "Unsaved Alice draft" } });
  act(() => {
    if (change === "account") mock.scope = "org:user:bob";
    else localStorage.setItem("filey_data_mode", "cloud");
    window.dispatchEvent(new Event("filey:agent-storage"));
  });
  expect(view.queryByRole("dialog")).toBeNull();
  expect(view.queryByDisplayValue("Unsaved Alice draft")).toBeNull();
  expect(view.queryByText("Alice template")).toBeNull();
  expect(await view.findByRole("button", { name: "Use starter templates" })).toBeTruthy();
  expect(mock.setSetting).not.toHaveBeenCalled();
});

it("ignores an old account's pending template response after a new account loads", async () => {
  let resolve!: (rows: { key: string; value: string }[]) => void;
  mock.settings.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const view = wrap(<EmailTemplates />);
  const oldKey = cacheKey(emailKey);
  act(() => {
    mock.scope = "org:user:bob";
    window.dispatchEvent(new Event("filey:agent-storage"));
  });
  await view.findByRole("button", { name: "Use starter templates" });
  await act(async () => resolve([{ key: "email_templates", value: JSON.stringify([emailTemplate]) }]));
  expect(view.queryByText("Alice template")).toBeNull();
  expect(localStorage.getItem(oldKey)).toBeNull();
  expect(localStorage.getItem(cacheKey(emailKey))).toBeNull();
  expect(mock.setSetting).not.toHaveBeenCalled();
});
