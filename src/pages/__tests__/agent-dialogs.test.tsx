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
});

it("opens named history and memory dialogs and closes them with Escape", async () => {
  render(
    <MemoryRouter>
      <AgentChat />
    </MemoryRouter>
  );
  for (const name of ["Chat history", "Agent memory"]) {
    fireEvent.click(screen.getByRole("button", { name }));
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
  expect(screen.getByRole("link", { name: "AI settings" })).toHaveAttribute(
    "href",
    "/settings?section=ai"
  );
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

it("starts desktop computer access on chat open and keeps it available across completed turns", async () => {
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
  await waitFor(() => expect(enable).toHaveBeenCalledOnce());
  expect(screen.queryByText("Computer access")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Message Filey AI" }), { target: { value: "Open my browser" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Computer task complete.");
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
