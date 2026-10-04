import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AgentEffortControl } from "../AgentComposerControls";
import type { AiConfig } from "../../lib/ai";

const managed: AiConfig = { provider: "openai", model: "filey-ai", baseUrl: "https://filey-credits.invalid/v1", apiKey: "", billing: "credits" };
afterEach(cleanup);

it("uses an accessible off-by-default switch for managed Filey AI instead of a reasoning effort menu", () => {
  const change = vi.fn(), effort = vi.fn();
  const view = render(<AgentEffortControl config={managed} value="high" disabled={false} onChange={effort} onReasoningChange={change} />);
  const control = screen.getByRole("switch", { name: "Reasoning" });
  expect(control).toHaveAttribute("aria-checked", "false");
  fireEvent.click(control);
  expect(change).toHaveBeenCalledExactlyOnceWith(true);
  expect(effort).not.toHaveBeenCalled();
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  view.rerender(<AgentEffortControl config={managed} value="high" disabled={false} reasoningEnabled onChange={effort} onReasoningChange={change} />);
  expect(control).toHaveAttribute("aria-checked", "true");
  expect(control).toHaveTextContent("On");
  fireEvent.click(control);
  expect(change).toHaveBeenLastCalledWith(false);
});

it("disables the switch during a running task", () => {
  const change = vi.fn();
  render(<AgentEffortControl config={managed} value="auto" disabled reasoningEnabled onChange={vi.fn()} onReasoningChange={change} />);
  const control = screen.getByRole("switch", { name: "Reasoning" });
  expect(control).toBeDisabled();
  fireEvent.click(control);
  expect(change).not.toHaveBeenCalled();
});

it("preserves the BYOK model's supported reasoning effort control", () => {
  const change = vi.fn();
  const config = { ...managed, model: "gpt-5.2", billing: undefined };
  render(<AgentEffortControl config={config} value="high" disabled={false} onChange={change} onReasoningChange={vi.fn()} />);
  expect(screen.queryByRole("switch", { name: "Reasoning" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reasoning effort: High" }));
  const slider = screen.getByRole("slider", { name: "Reasoning effort" });
  expect(slider).toHaveAttribute("aria-valuetext", "High");
  fireEvent.change(slider, { target: { value: "4" } });
  expect(change).toHaveBeenCalledExactlyOnceWith("xhigh");
});
