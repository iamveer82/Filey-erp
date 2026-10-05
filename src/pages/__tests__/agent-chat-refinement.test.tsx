import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AgentChat from "../AgentChat";
import * as ai from "../../lib/ai";
import * as localPaths from "../../lib/localPaths";
import { loadChats, saveChats, setActiveId, type Chat } from "../../lib/aiChats";
import { setCacheOrg } from "../../lib/api";
import { setDataMode } from "../../lib/dataMode";
import { agentStorageScope } from "../../lib/agentStorage";

vi.mock("../../lib/aiContext", () => ({ buildAiContext: async () => "" }));
vi.mock("../../components/BloubBot", async importOriginal => ({
  ...(await importOriginal<typeof import("../../components/BloubBot")>()), default: () => null,
}));
vi.mock("../../components/AutomationsDrawer", () => ({ default: () => null }));
vi.mock("../../components/SkillsDrawer", () => ({ default: () => null }));

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  setDataMode("local"); setCacheOrg("test-org", "test-user");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const showChat = () => render(<MemoryRouter><AgentChat /></MemoryRouter>);
const input = () => screen.getByRole("textbox", { name: "Message Filey AI" });
const savedChat = (id = "invoices"): Chat => ({ id, title: "Review invoices", turns: [{ role: "user", text: "Review invoices" }], createdAt: 1, updatedAt: 2 });
const seedChat = () => { const chat = savedChat(); saveChats([chat]); setActiveId(chat.id); return chat; };

it("starter prompts prepare editable drafts without running the agent or replacing typed text", () => {
  const stream = vi.spyOn(ai, "aiAgentStream");
  showChat();
  fireEvent.click(screen.getByRole("button", { name: "Create an invoice" }));
  expect(input()).toHaveValue("Create a new draft invoice. Ask me for the customer and items you need.");
  expect(input()).toHaveFocus();
  expect(screen.queryByRole("group", { name: "Conversation starters" })).not.toBeInTheDocument();
  fireEvent.change(input(), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Review payments" }));
  expect(input()).toHaveValue("Show me unpaid and overdue invoices, with amounts grouped by currency.");
  expect(stream).not.toHaveBeenCalled();
});

it("the file starter opens the existing picker without starting a request", () => {
  const stream = vi.spyOn(ai, "aiAgentStream");
  const { container } = showChat();
  const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const click = vi.spyOn(picker, "click");
  fireEvent.click(screen.getByRole("button", { name: "Work with a file" }));
  expect(click).toHaveBeenCalledOnce(); expect(stream).not.toHaveBeenCalled();
  expect(input()).toHaveValue("");
});

it("manual chat titles survive another agent reply and transcript export contains the conversation", async () => {
  seedChat(); vi.spyOn(ai, "aiReady").mockReturnValue(true);
  vi.spyOn(ai, "aiAgentStream").mockImplementation(async function* () { yield { type: "text", text: "Invoice checked." }; return "Invoice checked."; });
  const save = vi.spyOn(localPaths, "saveBytes").mockResolvedValue("saved.txt");
  showChat();
  fireEvent.click(screen.getByRole("button", { name: "Conversation options" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename chat" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Chat name" }), { target: { value: "  October accounts  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  expect(await screen.findByRole("heading", { name: "October accounts" })).toBeInTheDocument();
  fireEvent.change(input(), { target: { value: "Check the invoice" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Invoice checked.");
  expect(loadChats()[0]).toMatchObject({ title: "October accounts", customTitle: "October accounts" });
  fireEvent.click(screen.getByRole("button", { name: "Conversation options" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Export conversation" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toBe("Filey-chat-invoices.txt");
  expect(new TextDecoder().decode(save.mock.calls[0][1])).toBe("October accounts\n\nYou: Review invoices\n\nYou: Check the invoice\n\nAI: Invoice checked.");
});

it("history search finds message contents, and deletion requires an explicit confirmation", async () => {
  const chat = savedChat(); chat.turns.push({ role: "assistant", text: "Customer reference RENN-2026." });
  saveChats([chat]); showChat();
  fireEvent.click(screen.getByRole("button", { name: "Chat history" }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Search chats" }), { target: { value: "RENN-2026" } });
  const history = screen.getByRole("complementary", { name: "Chat history" });
  expect(within(history).getByRole("button", { name: "Review invoices" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete chat: Review invoices" }));
  expect(loadChats()).toHaveLength(1);
  fireEvent.click(within(screen.getByRole("dialog", { name: "Delete conversation?" })).getByRole("button", { name: "Cancel" }));
  expect(loadChats()).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Delete chat: Review invoices" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Delete conversation?" })).getByRole("button", { name: "Delete conversation" }));
  await waitFor(() => expect(loadChats()).toHaveLength(0));
});

it("a real terminal Coin failure offers recharge and restores an unexecuted request", async () => {
  vi.spyOn(ai, "aiReady").mockReturnValue(true);
  const failure = "Insufficient credit. Add Coin to continue. Nothing was executed from that response.";
  const stream = vi.spyOn(ai, "aiAgentStream").mockImplementation(async function* () {
    yield { type: "done", reason: "error", text: failure }; return failure;
  });
  showChat(); fireEvent.change(input(), { target: { value: "Create the draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText(failure);
  expect(screen.getByRole("link", { name: "Add Coin" })).toHaveAttribute("href", "/settings?section=credits");
  expect(input()).toHaveValue("Create the draft"); expect(stream).toHaveBeenCalledOnce();
});

it("does not prepare a replay when credit runs out after an action already executed", async () => {
  vi.spyOn(ai, "aiReady").mockReturnValue(true);
  const failure = "Insufficient credit. Add Coin to continue. Nothing was executed from that response. Check any earlier changes or files before asking me to continue.";
  vi.spyOn(ai, "aiAgentStream").mockImplementation(async function* () {
    yield { type: "tool_call", name: "create_invoice_draft", args: {}, id: "saved" };
    yield { type: "tool_result", name: "create_invoice_draft", result: { ok: true, id: 42 }, id: "saved" };
    yield { type: "done", reason: "error", text: failure }; return failure;
  });
  showChat(); fireEvent.change(input(), { target: { value: "Create an invoice" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText(failure);
  expect(screen.getByRole("link", { name: "Add Coin" })).toBeInTheDocument();
  expect(input()).toHaveValue("");
  expect(loadChats()[0].turns.slice(-1)[0]?.run?.actions[0]).toMatchObject({ id: "saved", status: "completed" });
});

it("does not treat arbitrary appended diagnostics as a trusted Coin failure", async () => {
  vi.spyOn(ai, "aiReady").mockReturnValue(true);
  const failure = "Insufficient credit. Add Coin to continue. Unexpected diagnostic";
  vi.spyOn(ai, "aiAgentStream").mockImplementation(async function* () {
    yield { type: "done", reason: "error", text: failure }; return failure;
  });
  showChat(); fireEvent.change(input(), { target: { value: "Prepare a draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText(failure);
  expect(screen.queryByRole("link", { name: "Add Coin" })).not.toBeInTheDocument();
  expect(input()).toHaveValue("");
});

it("renaming preserves messages saved by another tab while the dialog is open", async () => {
  const original = seedChat(); showChat();
  fireEvent.click(screen.getByRole("button", { name: "Conversation options" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename chat" }));
  const newer = { ...original, turns: [...original.turns, { role: "assistant" as const, text: "Saved in the other tab." }], updatedAt: Date.now() };
  saveChats([newer]);
  fireEvent.change(screen.getByRole("textbox", { name: "Chat name" }), { target: { value: "Accounts" } });
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  expect(await screen.findByText("Saved in the other tab.")).toBeInTheDocument();
  expect(loadChats()[0].turns).toEqual(newer.turns);
});

it.each(["success", "error", "stop"])("preserves a follow-up draft while a reply ends with %s, without auto-sending it", async outcome => {
  let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
  vi.spyOn(ai, "aiReady").mockReturnValue(true);
  const stream = vi.spyOn(ai, "aiAgentStream").mockImplementation(async function* (_messages, options) {
    yield { type: "text", text: "Checking your records." }; await done;
    if (outcome === "error") throw new Error("Connection unavailable.");
    options?.signal?.throwIfAborted(); return "Finished.";
  });
  showChat(); fireEvent.change(input(), { target: { value: "Check accounts" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Checking your records.");
  expect(input()).not.toBeDisabled();
  fireEvent.change(input(), { target: { value: "Now summarize overdue invoices" } });
  fireEvent.keyDown(input(), { key: "Enter" });
  if (outcome === "stop") fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
  await act(async () => { finish(); });
  await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument());
  expect(input()).toHaveValue("Now summarize overdue invoices");
  expect(stream).toHaveBeenCalledOnce();
});

it("offers explicit history recovery on initial corrupted data and retains the original", async () => {
  const scope = agentStorageScope()!;
  const key = `filey.ai.chats:${encodeURIComponent(scope)}`;
  const raw = JSON.stringify([savedChat(), { id: "damaged", turns: null }]);
  localStorage.setItem(key, raw); showChat();
  expect(screen.getByText(/Chat history could not be saved/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Recover history" }));
  expect(localStorage.getItem(key)).toBe(raw);
  const dialog = screen.getByRole("dialog", { name: "Recover chat history?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Recover history" }));
  await waitFor(() => expect(screen.queryByText(/Chat history could not be saved/)).not.toBeInTheDocument());
  expect(loadChats()).toHaveLength(1);
  expect(localStorage.getItem(`filey.ai.chats.recovery:${encodeURIComponent(scope)}`)).toBe(raw);
});

it("shows actionable feedback when the browser blocks copying a reply", async () => {
  const chat = savedChat(); chat.turns.push({ role: "assistant", text: "Your summary." });
  saveChats([chat]); setActiveId(chat.id);
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } });
  showChat(); fireEvent.click(screen.getByRole("button", { name: "Copy reply" }));
  expect(await screen.findByText("Could not copy. Select and copy the reply.")).toBeInTheDocument();
});
