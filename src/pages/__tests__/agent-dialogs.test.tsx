import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AgentChat from "../AgentChat";
import { runTool } from "../../lib/aiTools";
import { setDataMode } from "../../lib/dataMode";
import * as ai from "../../lib/ai";
import { gateFor, getAgentMode } from "../../lib/agentMode";
import { isCapabilityEnabled, setCapabilityEnabled } from "../../lib/capabilities";
import { setCacheOrg } from "../../lib/api";
import * as computer from "../../lib/computerUse";
import { saveChats, type Chat } from "../../lib/aiChats";
import * as voice from "../../lib/voice";
import { agentStorageScope } from "../../lib/agentStorage";

vi.mock("../../lib/aiContext", () => ({ buildAiContext: async () => "" }));
vi.mock("../../components/BloubBot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../components/BloubBot")>()),
  default: () => null,
}));
vi.mock("../../components/AutomationsDrawer", () => ({ default: () => null }));
vi.mock("../../components/SkillsDrawer", () => ({ default: () => null }));
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("test-org", "test-user");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps phone Enter for a new line and sends using the arrow, with a compact copy action", async () => {
  const scroll = vi.spyOn(Element.prototype, "scrollTo");
  const scrollPage = vi.spyOn(Element.prototype, "scrollIntoView");
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)", media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  vi.spyOn(ai, "aiReady").mockReturnValue(true);
  const stream = vi.spyOn(ai, "aiAgentStream").mockImplementation(async function* () {
    yield { type: "text" as const, text: "Your draft is ready." };
    return "Your draft is ready.";
  });
  const { container } = render(<MemoryRouter><AgentChat /></MemoryRouter>);
  const conversation = container.querySelector(".filey-conversation-scroll")!;
  Object.defineProperty(conversation, "scrollHeight", { value: 2400 });
  const input = screen.getByRole("textbox", { name: "Message Filey AI" });
  fireEvent.change(input, { target: { value: "Prepare a draft" } });
  expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
  expect(stream).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Your draft is ready.");
  expect(stream).toHaveBeenCalledOnce();
  await waitFor(() => expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: 2400 })));
  expect(scroll.mock.contexts.every(target => target === conversation)).toBe(true);
  expect(scrollPage).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Copy reply" })).not.toHaveTextContent("Copy");
  fireEvent.click(screen.getByRole("button", { name: "Conversation options" }));
  expect(screen.getByRole("menuitem", { name: "Coin wallet" })).toBeInTheDocument();
});

it("follows large streamed updates, preserves a reader's position on completion, and lets them jump back", async () => {
  let nextChunk!: () => void;
  let finish!: () => void;
  const next = new Promise<void>(resolve => { nextChunk = resolve; });
  const done = new Promise<void>(resolve => { finish = resolve; });
  vi.spyOn(ai, "aiReady").mockReturnValue(true);
  vi.spyOn(ai, "aiAgentStream").mockImplementation(async function* () {
    yield { type: "text" as const, text: "First part." };
    await next;
    yield { type: "text" as const, text: "More detail." };
    await done;
    return "Completed reply.";
  });
  const scroll = vi.spyOn(Element.prototype, "scrollTo").mockImplementation(function (this: Element, options: ScrollToOptions | number) {
    if (typeof options === "object") this.scrollTop = Math.max(0, (options.top ?? 0) - this.clientHeight);
  });
  const { container } = render(<MemoryRouter><AgentChat /></MemoryRouter>);
  const conversation = container.querySelector(".filey-conversation-scroll")!;
  let height = 2400;
  Object.defineProperties(conversation, {
    scrollHeight: { get: () => height },
    clientHeight: { value: 600 },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Message Filey AI" }), { target: { value: "Explain this" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("First part.");
  await waitFor(() => expect(scroll).toHaveBeenCalledWith({ top: 2400, behavior: "instant" }));
  height = 4000;
  await act(async () => { nextChunk(); });
  await waitFor(() => expect(scroll).toHaveBeenCalledWith({ top: 4000, behavior: "instant" }));
  conversation.scrollTop = 600;
  fireEvent.scroll(conversation);
  expect(screen.getByRole("button", { name: "Jump to latest message" })).toBeInTheDocument();
  scroll.mockClear();
  await act(async () => { finish(); });
  await screen.findByText("Completed reply.");
  await act(async () => { await new Promise(requestAnimationFrame); });
  expect(scroll).not.toHaveBeenCalled();
  expect(conversation.scrollTop).toBe(600);
  fireEvent.click(screen.getByRole("button", { name: "Jump to latest message" }));
  expect(scroll).toHaveBeenLastCalledWith({ top: 4000, behavior: "instant" });
  expect(screen.queryByRole("button", { name: "Jump to latest message" })).not.toBeInTheDocument();
});

it("keeps drafts and cumulative attachments with their own conversation and releases image previews", async () => {
  const created: string[] = [];
  const revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = () => { const url = `blob:preview-${created.length}`; created.push(url); return url; };
    static revokeObjectURL = revoke;
  });
  saveChats([
    { id: "invoices", title: "Review invoices", turns: [{ role: "user", text: "Review invoices" }], createdAt: 1, updatedAt: 2 },
    { id: "marketing", title: "Marketing ideas", turns: [{ role: "user", text: "Marketing ideas" }], createdAt: 1, updatedAt: 1 },
  ] satisfies Chat[]);
  const { container, unmount } = render(<MemoryRouter><AgentChat /></MemoryRouter>);
  const openChat = (name: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Chat history" }));
    fireEvent.click(within(screen.getByRole("complementary", { name: "Chat history" })).getByRole("button", { name }));
  };
  openChat("Review invoices");
  fireEvent.change(screen.getByRole("textbox", { name: "Message Filey AI" }), { target: { value: "Review these files" } });
  const first = new File(["one"], "one.pdf", { type: "application/pdf" });
  const second = new File(["two"], "two.pdf", { type: "application/pdf" });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [first] } });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [second] } });
  fireEvent.paste(screen.getByRole("textbox", { name: "Message Filey AI" }), {
    clipboardData: { files: [new File(["image"], "screen.png", { type: "image/png" })] },
  });
  for (const name of ["one.pdf", "two.pdf", "screen.png"]) expect(screen.getByText(name)).toBeInTheDocument();
  openChat("Marketing ideas");
  expect(screen.getByRole("textbox", { name: "Message Filey AI" })).toHaveValue("");
  expect(screen.queryByText("one.pdf")).not.toBeInTheDocument();
  openChat("Review invoices");
  expect(screen.getByRole("textbox", { name: "Message Filey AI" })).toHaveValue("Review these files");
  for (const name of ["one.pdf", "two.pdf", "screen.png"]) expect(screen.getByText(name)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  expect(screen.getByRole("textbox", { name: "Message Filey AI" })).toHaveValue("");
  expect(screen.queryByText("screen.png")).not.toBeInTheDocument();
  fireEvent.paste(screen.getByRole("textbox", { name: "Message Filey AI" }), {
    clipboardData: { files: [new File(["last"], "last.png", { type: "image/png" })] },
  });
  unmount();
  for (const url of created) expect(revoke).toHaveBeenCalledWith(url);
});

it("restores the composed message and attached files after a failed run so the user can retry", async () => {
  vi.spyOn(ai, "aiReady").mockReturnValue(true);
  const stream = vi.spyOn(ai, "aiAgentStream")
    .mockImplementationOnce(async function* () { yield* []; throw new Error("Connection interrupted"); })
    .mockImplementationOnce(async function* () { yield* []; return "Retry completed."; });
  const { container } = render(<MemoryRouter><AgentChat /></MemoryRouter>);
  fireEvent.change(screen.getByRole("textbox", { name: "Message Filey AI" }), { target: { value: "Review this PDF" } });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["pdf"], "draft.pdf", { type: "application/pdf" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Connection interrupted");
  expect(screen.getByRole("textbox", { name: "Message Filey AI" })).toHaveValue("Review this PDF");
  expect(screen.getByRole("button", { name: "Remove draft.pdf" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Retry completed.");
  expect(stream).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("button", { name: "Remove draft.pdf" })).not.toBeInTheDocument();
  expect(screen.queryByText("Connection interrupted")).not.toBeInTheDocument();
});

it("appends dictation to the draft and stops late dictation from entering another chat", () => {
  vi.spyOn(voice, "speechRecognitionSupported").mockReturnValue(true);
  let callbacks!: Parameters<typeof voice.startDictation>[0];
  const stop = vi.fn();
  vi.spyOn(voice, "startDictation").mockImplementation(handlers => { callbacks = handlers; return { stop }; });
  const { unmount } = render(<MemoryRouter><AgentChat /></MemoryRouter>);
  fireEvent.change(screen.getByRole("textbox", { name: "Message Filey AI" }), { target: { value: "Existing draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
  act(() => callbacks.onFinal("spoken words"));
  expect(screen.getByRole("textbox", { name: "Message Filey AI" })).toHaveValue("Existing draft spoken words");
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  expect(stop).toHaveBeenCalledOnce();
  act(() => callbacks.onFinal("late result"));
  expect(screen.getByRole("textbox", { name: "Message Filey AI" })).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
  unmount();
  expect(stop).toHaveBeenCalledTimes(2);
});

it("clears scoped drafts and attachments and stops dictation when the account changes", () => {
  const revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = () => "blob:workspace-preview";
    static revokeObjectURL = revoke;
  });
  vi.spyOn(voice, "speechRecognitionSupported").mockReturnValue(true);
  let callbacks!: Parameters<typeof voice.startDictation>[0];
  const stop = vi.fn();
  vi.spyOn(voice, "startDictation").mockImplementation(handlers => { callbacks = handlers; return { stop }; });
  const { container } = render(<MemoryRouter initialEntries={[{
    pathname: "/agent", state: { draft: "Private workspace draft", draftScope: agentStorageScope() },
  }]}><AgentChat /></MemoryRouter>);
  expect(screen.getByRole("textbox", { name: "Message Filey AI" })).toHaveValue("Private workspace draft");
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["image"], "private.png", { type: "image/png" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
  act(() => { setCacheOrg("other-org", "other-user"); });
  expect(screen.getByRole("textbox", { name: "Message Filey AI" })).toHaveValue("");
  expect(screen.queryByRole("button", { name: "Remove private.png" })).not.toBeInTheDocument();
  expect(stop).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith("blob:workspace-preview");
  act(() => callbacks.onFinal("Late private words"));
  expect(screen.getByRole("textbox", { name: "Message Filey AI" })).toHaveValue("");
});

it("prefills an integration handoff as an editable draft without running the agent", () => {
  const run = vi.spyOn(ai, "aiAgentStream");
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: "/agent",
          state: { draft: "Prepare an Instagram caption for review." },
        },
      ]}
    >
      <AgentChat />
    </MemoryRouter>
  );
  expect(
    screen.getByDisplayValue("Prepare an Instagram caption for review.")
  ).toBeInTheDocument();
  expect(run).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "Add Coin to AI wallet" })).toHaveAttribute("href", "/settings?section=credits");
});

it("opens inline chat history, filters saved conversations and collapses with Escape", async () => {
  saveChats([
    { id: "invoices", title: "Review invoices", turns: [{ role: "user", text: "Review invoices" }], createdAt: 1, updatedAt: 2 },
    { id: "marketing", title: "Marketing ideas", turns: [{ role: "user", text: "Marketing ideas" }], createdAt: 1, updatedAt: 1 },
  ] satisfies Chat[]);
  render(<MemoryRouter><AgentChat /></MemoryRouter>);
  const toggle = screen.getByRole("button", { name: "Chat history" });
  fireEvent.click(toggle);
  const history = screen.getByRole("complementary", { name: "Chat history" });
  expect(screen.queryByRole("dialog", { name: "Chat history" })).not.toBeInTheDocument();
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(within(history).getByRole("button", { name: "Review invoices" })).toBeInTheDocument();
  fireEvent.change(within(history).getByRole("searchbox", { name: "Search chats" }), { target: { value: "marketing" } });
  expect(within(history).queryByRole("button", { name: "Review invoices" })).not.toBeInTheDocument();
  fireEvent.click(within(history).getByRole("button", { name: "Marketing ideas" }));
  expect(screen.queryByRole("complementary", { name: "Chat history" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Marketing ideas");
  fireEvent.click(toggle);
  fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search chats" }), { key: "Escape" });
  expect(screen.queryByRole("complementary", { name: "Chat history" })).not.toBeInTheDocument();
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  await waitFor(() => expect(toggle).toHaveFocus());
});

it("opens the memory dialog and closes it with Escape", async () => {
  render(
    <MemoryRouter>
      <AgentChat />
    </MemoryRouter>
  );
  for (const name of ["Agent memory"]) {
    if (name === "Agent memory") {
      fireEvent.click(screen.getByRole("button", { name: "Conversation options" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Memory" }));
    } else fireEvent.click(screen.getByRole("button", { name }));
    const dialog = screen.getByRole("dialog", { name });
    expect(
      within(dialog).getByRole("button", { name: "Close dialog" })
    ).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await act(async () => {});
    expect(screen.queryByRole("dialog", { name })).not.toBeInTheDocument();
  }
});

it("denies a waiting sensitive tool when the approval dialog is closed", async () => {
  render(
    <MemoryRouter>
      <AgentChat />
    </MemoryRouter>
  );
  let result!: ReturnType<typeof runTool>;
  await act(async () => {
    // The gate resolves before any data lookup or write; no invoice is created.
    result = runTool("mark_invoice_paid", { invoice_number: "NO-RECORD" });
  });
  const dialog = await screen.findByRole("dialog", { name: "Approve action" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
  await expect(result).resolves.toEqual({
    error: "Cancelled — the user did not approve this action.",
  });
  expect(
    screen.queryByRole("dialog", { name: "Approve action" })
  ).not.toBeInTheDocument();
});

it("preserves access on opening and reflects an explicit approval-mode change in the workspace", () => {
  setCapabilityEnabled("crm", false);
  render(
    <MemoryRouter>
      <AgentChat />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole("button", { name: "Agent access" }));
  expect(screen.getByRole("radio", { name: /Approve for me/ })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("button", { name: "Manage action groups" }));
  const dialog = within(screen.getByRole("dialog", { name: "Agent access" }));
  expect(dialog.getByRole("radio", { name: "Accept edits" })).toBeChecked();
  expect(
    dialog.getByRole("switch", { name: "Customers & CRM disabled" })
  ).not.toBeChecked();
  expect(isCapabilityEnabled("crm")).toBe(false);
  const optionalComputers = dialog.getByRole("switch", { name: "Agent computers (optional) disabled" });
  expect(optionalComputers).not.toBeChecked();
  fireEvent.click(optionalComputers);
  expect(isCapabilityEnabled("agent_computers")).toBe(true);
  fireEvent.click(dialog.getByRole("switch", { name: "Agent computers (optional) enabled" }));
  expect(isCapabilityEnabled("agent_computers")).toBe(false);
  expect(gateFor("mark_invoice_paid", true)).toBe("ask");
  fireEvent.click(dialog.getByRole("radio", { name: "Manual" }));
  fireEvent.click(dialog.getByRole("button", { name: "Done" }));
  expect(getAgentMode()).toBe("manual");
  expect(screen.getByRole("button", { name: "Agent access" })).toHaveTextContent(
    "Ask for approval"
  );
  expect(screen.getByRole("button", { name: "Agent access" })).toHaveAttribute("title",
    "Ask for approval");
  expect(isCapabilityEnabled("crm")).toBe(false);
});

it("keeps the chat minimal and sends only the user's composed message", async () => {
  const enable = vi.spyOn(computer, "enableComputerUse");
  vi.spyOn(ai, "aiReady").mockReturnValue(true);
  const stream = vi.spyOn(ai, "aiAgentStream").mockImplementation(async function* () {
    yield { type: "text" as const, text: "Looking up invoices." };
    return "No unpaid invoices found in this test.";
  });
  render(
    <MemoryRouter>
      <AgentChat />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole("button", { name: "Conversation options" }));
  expect(screen.getByRole("menuitem", { name: "AI settings" })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("button", { name: "Find unpaid invoices" })).not.toBeInTheDocument();
  expect(screen.queryByText("Open AI settings")).not.toBeInTheDocument();
  expect(screen.queryByText("Choose a model")).not.toBeInTheDocument();
  const input = screen.getByRole("textbox", { name: "Message Filey AI" });
  expect(input).toHaveValue("");
  fireEvent.change(input, { target: { value: "Who owes me money?" } });
  expect(input).toHaveValue("Who owes me money?");
  expect(stream).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(stream).not.toHaveBeenCalled();
  expect(input).toHaveValue("Who owes me money?");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(stream).toHaveBeenCalledOnce());
  expect(stream).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ role: "user", text: "Who owes me money?" }),
    ]),
    expect.any(Object)
  );
  expect(
    await screen.findByText("No unpaid invoices found in this test.")
  ).toBeInTheDocument();
  expect(enable).not.toHaveBeenCalled();
});

it("starts desktop computer access automatically for an approved task without an enable switch", async () => {
  vi.spyOn(ai, "aiReady").mockReturnValue(true);
  vi.spyOn(computer, "computerUseSupported").mockReturnValue(true);
  const enable = vi.spyOn(computer, "enableComputerUse").mockResolvedValue(42);
  const disable = vi.spyOn(computer, "disableComputerUse").mockResolvedValue();
  let session!: () => Promise<number>;
  vi.spyOn(ai, "aiAgentStream").mockImplementation(async function* (_messages, options) {
    session = options!.computerSession!;
    expect(await session()).toBe(42);
    expect(await session()).toBe(42);
    yield { type: "text", text: "Computer task checked." };
    return "Computer task complete.";
  });
  render(<MemoryRouter><AgentChat /></MemoryRouter>);
  expect(screen.queryByRole("button", { name: "Enable for 5 minutes" })).not.toBeInTheDocument();
  await act(async () => {});
  expect(enable).not.toHaveBeenCalled();
  disable.mockClear(); // Selecting a conversation revokes the previous browser grant.
  expect(screen.queryByText("Computer access")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Message Filey AI" }), { target: { value: "Open my browser" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Computer task complete.");
  expect(enable).toHaveBeenCalledOnce();
  expect(enable.mock.calls.every(args => args.length === 0)).toBe(true);
  expect(disable).not.toHaveBeenCalled();
  await expect(session()).rejects.toMatchObject({ name: "AbortError" });
  cleanup();
  expect(disable).toHaveBeenCalled();
});

it("keeps autonomous plan and tool results with the reply and passes history to follow-ups", async () => {
  vi.spyOn(ai, "aiReady").mockReturnValue(true);
  const stream = vi
    .spyOn(ai, "aiAutonomousStream")
    .mockImplementation(async function* () {
      yield {
        type: "plan" as const,
        steps: [{ step: "Review invoices", status: "completed" as const }],
      };
      yield { type: "tool_call" as const, id: "read-1", name: "list_invoices", args: {} };
      yield {
        type: "tool_result" as const,
        id: "read-1",
        name: "list_invoices",
        result: { count: 0 },
      };
      yield {
        type: "done" as const,
        text: "Review finished.",
        reason: "finished" as const,
      };
      return "Review finished.";
    });
  render(
    <MemoryRouter>
      <AgentChat />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole("button", { name: "Add to message" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Autonomous mode" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message Filey AI" }), {
    target: { value: "Review invoices" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByText("Review finished.")).toBeInTheDocument();
  expect(screen.getByLabelText("Task progress")).toHaveTextContent("1 of 1 complete");
  expect(screen.getByLabelText("Actions this turn")).toHaveTextContent(
    "list invoices · completed"
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Message Filey AI" }), {
    target: { value: "Continue" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
  expect(stream.mock.calls[1][1]?.history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: "assistant", text: "Review finished." }),
    ])
  );
});

it("passes the chosen effort into the agent and remembers it for this workspace", async () => {
  vi.spyOn(ai, "getAiConfig").mockReturnValue({ provider: "openai", model: "gpt-5.2", baseUrl: "https://api.openai.com/v1", apiKey: "test" });
  vi.spyOn(ai, "aiReady").mockReturnValue(true);
  const stream = vi.spyOn(ai, "aiAgentStream").mockImplementation(async function* () {
    yield { type: "text" as const, text: "Ready." }; return "Ready.";
  });
  render(<MemoryRouter><AgentChat /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Reasoning effort: Default" }));
  fireEvent.change(screen.getByRole("slider", { name: "Reasoning effort" }), { target: { value: "4" } });
  expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "Extra high");
  fireEvent.keyDown(screen.getByRole("slider"), { key: "Escape" });
  fireEvent.change(screen.getByRole("textbox", { name: "Message Filey AI" }), { target: { value: "Review this draft." } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(stream).toHaveBeenCalled());
  expect(stream.mock.calls[0][1]?.effort).toBe("xhigh");
});
