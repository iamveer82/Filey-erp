import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import OpenUiRender, { promptFromAction } from "../OpenUiRender";

// Filey AI's OpenUI cards: drawn with OpenUI's chat library; a follow-up sends its text back.
describe("OpenUI card", () => {
  it("draws the program and sends a follow-up back to the agent", async () => {
    const onPrompt = vi.fn();
    render(<OpenUiRender onPrompt={onPrompt} program={[
      "root = Card([header, body, next])",
      'header = CardHeader("Overdue invoices", "AED")',
      'body = TextContent("Three invoices are overdue.")',
      "next = FollowUpBlock([f1])",
      'f1 = FollowUpItem("Draft reminders")',
    ].join("\n")} />);
    expect(await screen.findByText("Overdue invoices")).toBeInTheDocument();
    expect(screen.getByText("Three invoices are overdue.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Draft reminders"));
    expect(onPrompt).toHaveBeenCalledWith("Draft reminders");
  });

  it("keeps hidden button context with the words it sends", () => {
    expect(promptFromAction({ type: "continue_conversation", params: { context: { invoice: "INV-032" } }, humanFriendlyMessage: "Open it" }))
      .toBe('Open it\n({"invoice":"INV-032"})');
  });
});
