import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import PersistentAgentChat from "../../components/PersistentAgentChat";
import * as ai from "../../lib/ai";
import * as tools from "../../lib/aiTools";
import * as voice from "../../lib/voice";
import * as computer from "../../lib/computerUse";
import { loadChats } from "../../lib/aiChats";
import { billing, setCacheOrg } from "../../lib/api";
import { setDataMode } from "../../lib/dataMode";
import { agentStorageScope } from "../../lib/agentStorage";
import { clearLocalCache, localClient } from "../../lib/localdb";
import * as deviceStorage from "../../lib/deviceStorage";
import { rememberLocalIdentity, setLocalSignedIn } from "../../lib/localAuth";

vi.mock("../../lib/modules", () => ({ useModules: () => ({ loading: false, error: "", isEnabled: () => true }) }));
vi.mock("../../lib/aiContext", () => ({ buildAiContext: async () => "" }));
vi.mock("../../components/BloubBot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../components/BloubBot")>()),
  default: () => null,
}));
vi.mock("../../components/AutomationsDrawer", () => ({ default: () => null }));
vi.mock("../../components/SkillsDrawer", () => ({ default: () => null }));
vi.mock("../../components/AgentMediaPanel", () => ({ default: () => <p>Media view fixture</p>, MediaJobCard: () => <p>Media job fixture</p> }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function NavigationHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <nav aria-label="Fixture sections">
      <button onClick={() => navigate("/customers")}>Customers section</button>
      <button onClick={() => navigate("/agent")}>AI section</button>
      <button onClick={() => navigate("/agent", { state: { draft: "New integration instructions", draftScope: agentStorageScope() } })}>Integration handoff</button>
      <button onClick={() => navigate("/agent?video=1")}>Media handoff</button>
    </nav>
    {location.pathname === "/customers" && <h1>Customers section fixture</h1>}
    <PersistentAgentChat />
  </>;
}

async function openChat() {
  const view = render(<MemoryRouter initialEntries={["/agent"]}><NavigationHarness /></MemoryRouter>);
  await screen.findByRole("textbox", { name: "Message Filey AI" }, { timeout: 30_000 });
  return view;
}

function send(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Message Filey AI" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
}

function deferredStream(result = "Invoice prepared.") {
  const finish = deferred();
  let signal!: AbortSignal;
  const stream = vi.spyOn(ai, "aiAgentStream").mockImplementation(async function* (_messages, options) {
    signal = options!.signal!;
    yield { type: "text", text: "Preparing the requested invoice." };
    await Promise.race([finish.promise, new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
    })]);
    signal.throwIfAborted();
    tools.setTurnFiles(options!.turnId!, [], [{ name: "invoice.pdf", path: "C:/generated-fixtures/invoice.pdf" }]);
    return result;
  });
  return { finish, stream, signal: () => signal };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setDataMode("local");
  setCacheOrg("navigation-org", "navigation-user");
  vi.spyOn(ai, "aiReady").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps one running request and its original chat/files when navigating away and back", async () => {
  const run = deferredStream();
  const disable = vi.spyOn(computer, "disableComputerUse").mockResolvedValue();
  await openChat();
  send("Prepare my invoice");
  await screen.findByText("Preparing the requested invoice.");
  const id = run.stream.mock.calls[0][1]!.agentId;
  disable.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Customers section" }));
  expect(screen.getByRole("heading", { name: "Customers section fixture" })).toBeInTheDocument();
  expect(screen.getByRole("complementary", { name: "Filey AI task" })).toHaveTextContent("continuing your task");
  expect(run.signal().aborted).toBe(false);
  expect(disable).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox", { name: "Message Filey AI" })).not.toBeInTheDocument();
  await act(async () => { run.finish.resolve(); });
  await waitFor(() => expect(loadChats().find(chat => chat.id === id)?.turns).toHaveLength(2));
  const saved = loadChats().find(chat => chat.id === id)!;
  expect(saved.turns[1]).toMatchObject({ role: "assistant", text: "Invoice prepared.", files: [{ name: "invoice.pdf", path: "C:/generated-fixtures/invoice.pdf" }] });
  fireEvent.click(screen.getByRole("button", { name: "AI section" }));
  expect(await screen.findByText("Invoice prepared.")).toBeVisible();
  expect(screen.getByRole("button", { name: "invoice.pdf" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Prepare my invoice" })).toBeInTheDocument();
  expect(run.stream).toHaveBeenCalledOnce();
});

it("finishes one real local invoice with its exact custom pricing after navigating away before commit", async () => {
  clearLocalCache();
  rememberLocalIdentity("navigation@example.test", "navigation-user");
  setLocalSignedIn(true);
  await localClient.from("company_profile").insert({ name: "Fixture company", currency: "AED", country_code: "AE", default_tax_rate: 5, default_template: "minimal" });
  await localClient.from("crm_customers").insert({ name: "Rennox", company: "Rennox" });
  const beforeCommit = deferred(), finishCommit = deferred();
  const commit = deviceStorage.compareDeviceValues;
  let invoiceCommits = 0;
  vi.spyOn(deviceStorage, "compareDeviceValues").mockImplementation(async (entries, expected) => {
    if (entries.some(([key]) => key === "localdb:invoice_docs")) {
      invoiceCommits++;
      beforeCommit.resolve();
      await finishCommit.promise;
    }
    return commit(entries, expected);
  });
  let result: unknown;
  let signal!: AbortSignal;
  const stream = vi.spyOn(ai, "aiAgentStream").mockImplementation(async function* (_messages, options) {
    signal = options!.signal!;
    yield { type: "text", text: "Saving the requested Rennox invoice." };
    result = await tools.runTool("create_invoice_draft", {
      invoice_number: "QA-NAV-LOCAL-1", customer_name: "Rennox", currency: "AED", issue_date: "2026-09-23", tax_rate: 5,
      custom_columns: [{ key: "liters", label: "T.Liters" }], price_by: "liters",
      items: [{ description: "H/O PAIL 20L", qty: 50, unit: "L", unit_price: .2, custom: { liters: "1000" } },
        { description: "15W40 PAIL 20L", qty: 15, unit: "L", unit_price: 4.1, custom: { liters: "300" } },
        { description: "20W50 PAIL 20L", qty: 15, unit: "L", unit_price: 4.1, custom: { liters: "300" } }],
    }, options!.confirm, options!.isOwner, options!.turnId, signal, options!.computerSession, options!.agentId);
    return "Rennox invoice QA-NAV-LOCAL-1 created. Total AED 2,793.00.";
  });
  await openChat();
  send("Create my Rennox invoice");
  await act(async () => { await beforeCommit.promise; });
  const chatId = stream.mock.calls[0][1]!.agentId;
  expect((await localClient.from("invoice_docs").select("*")).data).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Customers section" }));
  expect(screen.getByRole("heading", { name: "Customers section fixture" })).toBeInTheDocument();
  expect(screen.getByRole("complementary", { name: "Filey AI task" })).toHaveTextContent("continuing your task");
  expect(signal.aborted).toBe(false);
  await act(async () => { finishCommit.resolve(); });
  await waitFor(() => expect(loadChats().find(chat => chat.id === chatId)?.turns).toHaveLength(2));
  expect(result).toMatchObject({ ok: true, number: "QA-NAV-LOCAL-1" });
  const invoices = await billing.listDocs("sales", true);
  expect(invoices).toMatchObject([{ number: "QA-NAV-LOCAL-1", customer_name: "Rennox", net_total: 2660, tax_total: 133, total: 2793 }]);
  expect(invoices).toHaveLength(1);
  const saved = await billing.getDoc(invoices[0].id, true);
  expect(saved).toMatchObject({ unit_price_formula: { a: "liters", b: "unit_price" }, custom_columns: [{ key: "liters", label: "T.Liters" }],
    items: [{ description: "H/O PAIL 20L", qty: 50, unit: "L", unit_price: .2, custom: { liters: "1000" } },
      { description: "15W40 PAIL 20L", qty: 15, unit: "L", unit_price: 4.1, custom: { liters: "300" } },
      { description: "20W50 PAIL 20L", qty: 15, unit: "L", unit_price: 4.1, custom: { liters: "300" } }] });
  expect(saved.items).toHaveLength(3);
  expect((await localClient.from("local_business_workflow_requests").select("*")).data).toHaveLength(1);
  expect(await billing.pendingInvoiceSaves()).toEqual([]);
  expect(invoiceCommits).toBe(1);
  expect(loadChats().find(chat => chat.id === chatId)?.turns[1]).toMatchObject({ role: "assistant", text: "Rennox invoice QA-NAV-LOCAL-1 created. Total AED 2,793.00." });
  fireEvent.click(screen.getByRole("button", { name: "AI section" }));
  expect(await screen.findByText("Rennox invoice QA-NAV-LOCAL-1 created. Total AED 2,793.00.")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Create my Rennox invoice" })).toBeInTheDocument();
  expect(stream).toHaveBeenCalledOnce();
});

it("returns to the same streaming task and Stop cancels it from another section", async () => {
  const run = deferredStream();
  await openChat();
  send("Prepare my invoice");
  await screen.findByText("Preparing the requested invoice.");
  fireEvent.click(screen.getByRole("button", { name: "Customers section" }));
  fireEvent.click(screen.getByRole("link", { name: "Return to chat" }));
  expect(screen.getByText("Preparing the requested invoice.")).toBeVisible();
  expect(run.signal().aborted).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Customers section" }));
  fireEvent.click(screen.getByRole("button", { name: "Stop Filey AI task" }));
  expect(run.signal().aborted).toBe(true);
  await waitFor(() => expect(screen.queryByRole("complementary", { name: "Filey AI task" })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "AI section" }));
  expect(await screen.findByText(/Stopped\./)).toBeVisible();
  expect(screen.queryByText("Invoice prepared.")).not.toBeInTheDocument();
  expect(run.stream).toHaveBeenCalledOnce();
});

it("keeps an exact approval pending off-route until the user returns and approves", async () => {
  const ask = deferred();
  const applied = vi.fn();
  vi.spyOn(ai, "aiAgentStream").mockImplementation(async function* (_messages, options) {
    yield { type: "text", text: "Preparing your email." };
    await ask.promise;
    const allowed = await options!.confirm!("send_invoice_email", { invoice_id: 12, recipient: "fixture@example.test" });
    options!.signal!.throwIfAborted();
    if (allowed) applied();
    return allowed ? "Email approved." : "Email declined.";
  });
  await openChat();
  send("Email the invoice");
  await screen.findByText("Preparing your email.");
  fireEvent.click(screen.getByRole("button", { name: "Customers section" }));
  await act(async () => { ask.resolve(); });
  await waitFor(() => expect(screen.getByRole("complementary", { name: "Filey AI task" })).toHaveTextContent("needs your approval"));
  expect(screen.queryByRole("dialog", { name: "Approve action" })).not.toBeInTheDocument();
  expect(applied).not.toHaveBeenCalled();
  const leaveAgain = screen.getByRole("button", { name: "Customers section" });
  fireEvent.click(screen.getByRole("link", { name: "Return to chat" }));
  let dialog = await screen.findByRole("dialog", { name: "Approve action" });
  expect(dialog).toHaveTextContent("fixture@example.test");
  // Browser history or agent navigation can leave while a modal is open.
  fireEvent.click(leaveAgain);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Approve action" })).not.toBeInTheDocument());
  expect(screen.getByRole("complementary", { name: "Filey AI task" })).toHaveTextContent("needs your approval");
  expect(applied).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("link", { name: "Return to chat" }));
  dialog = await screen.findByRole("dialog", { name: "Approve action" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Allow" }));
  expect(await screen.findByText("Email approved.")).toBeVisible();
  expect(applied).toHaveBeenCalledOnce();
});

it("stops on account/workspace change and never publishes private output in the new account", async () => {
  const run = deferredStream("Private previous workspace answer.");
  await openChat();
  send("Private account request");
  await screen.findByText("Preparing the requested invoice.");
  fireEvent.click(screen.getByRole("button", { name: "Customers section" }));
  act(() => { setCacheOrg("other-org", "other-user"); });
  expect(run.signal().aborted).toBe(true);
  await act(async () => { run.finish.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: "AI section" }));
  expect(await screen.findByRole("textbox", { name: "Message Filey AI" })).toHaveValue("");
  expect(screen.queryByText("Private account request")).not.toBeInTheDocument();
  expect(screen.queryByText("Private previous workspace answer.")).not.toBeInTheDocument();
  expect(loadChats()).toHaveLength(0);
});

it("pauses hidden dictation, keyboard shortcuts, media and auto-scroll while retaining drafts", async () => {
  vi.spyOn(voice, "speechRecognitionSupported").mockReturnValue(true);
  let callbacks!: Parameters<typeof voice.startDictation>[0];
  const stopDictation = vi.fn();
  vi.spyOn(voice, "startDictation").mockImplementation(handlers => { callbacks = handlers; return { stop: stopDictation }; });
  const scroll = vi.spyOn(Element.prototype, "scrollTo");
  const view = await openChat();
  fireEvent.change(screen.getByRole("textbox", { name: "Message Filey AI" }), { target: { value: "Unsent words" } });
  fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
  fireEvent.click(screen.getByRole("button", { name: "Customers section" }));
  expect(stopDictation).toHaveBeenCalledOnce();
  act(() => callbacks.onFinal("late spoken words"));
  const click = vi.spyOn(view.container.querySelector('input[type="file"]')! as HTMLInputElement, "click");
  scroll.mockClear();
  fireEvent.keyDown(window, { key: "u", ctrlKey: true });
  await act(async () => { await new Promise(requestAnimationFrame); });
  expect(click).not.toHaveBeenCalled();
  expect(scroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "AI section" }));
  expect(screen.getByRole("textbox", { name: "Message Filey AI" })).toHaveValue("Unsent words");
  fireEvent.click(screen.getByRole("button", { name: "Media handoff" }));
  expect(await screen.findByText("Media view fixture")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Customers section" }));
  expect(screen.queryByText("Media view fixture")).not.toBeInTheDocument();
});

it("applies each later integration handoff once without overwriting or automatically sending a draft", async () => {
  const stream = vi.spyOn(ai, "aiAgentStream");
  await openChat();
  fireEvent.change(screen.getByRole("textbox", { name: "Message Filey AI" }), { target: { value: "My existing words" } });
  fireEvent.click(screen.getByRole("button", { name: "Customers section" }));
  fireEvent.click(screen.getByRole("button", { name: "Integration handoff" }));
  expect(screen.getByRole("textbox", { name: "Message Filey AI" })).toHaveValue("My existing words\n\nNew integration instructions");
  fireEvent.change(screen.getByRole("textbox", { name: "Message Filey AI" }), { target: { value: "Edited integration instructions" } });
  expect(screen.getByRole("textbox", { name: "Message Filey AI" })).toHaveValue("Edited integration instructions");
  expect(stream).not.toHaveBeenCalled();
});

it("retains a handoff received during a task even after leaving again before it finishes", async () => {
  const run = deferredStream();
  await openChat();
  send("Prepare my invoice");
  await screen.findByText("Preparing the requested invoice.");
  fireEvent.click(screen.getByRole("button", { name: "Customers section" }));
  fireEvent.click(screen.getByRole("button", { name: "Integration handoff" }));
  expect(screen.getByRole("textbox", { name: "Message Filey AI" })).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Customers section" }));
  await act(async () => { run.finish.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: "AI section" }));
  expect(screen.getByRole("textbox", { name: "Message Filey AI" })).toHaveValue("New integration instructions");
  expect(screen.getByText("Invoice prepared.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Customers section" }));
  fireEvent.click(screen.getByRole("button", { name: "AI section" }));
  expect(screen.getByRole("textbox", { name: "Message Filey AI" })).toHaveValue("New integration instructions");
  expect(run.stream).toHaveBeenCalledOnce();
});
