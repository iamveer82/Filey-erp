import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AgentEffortControl } from "../AgentComposerControls";
import type { AiConfig } from "../../lib/ai";

const managed: AiConfig = { provider: "openai", model: "filey-ai", baseUrl: "https://filey-credits.invalid/v1", apiKey: "", billing: "credits" };
afterEach(cleanup);

it("opens managed effort in fast mode without enabling reasoning just by opening the menu", () => {
  const change = vi.fn(), effort = vi.fn();
  render(<AgentEffortControl config={managed} value="high" disabled={false} onChange={effort} onReasoningChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Filey AI effort: Fast" }));
  const slider = screen.getByRole("slider", { name: "Filey AI effort" });
  expect(slider).toHaveValue("0");
  expect(slider).toHaveAttribute("aria-valuetext", "Fast, reasoning off");
  expect(change).not.toHaveBeenCalled();
  expect(effort).not.toHaveBeenCalled();
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  fireEvent.change(slider, { target: { value: "2" } });
  expect(effort).toHaveBeenCalledExactlyOnceWith("high");
  expect(change).toHaveBeenCalledExactlyOnceWith(true);
});

it("shows the selected reasoning level and turns reasoning off at the fast slider stop", () => {
  const change = vi.fn(), effort = vi.fn();
  render(<AgentEffortControl config={managed} value="max" disabled={false} reasoningEnabled onChange={effort} onReasoningChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Filey AI effort: Maximum" }));
  const slider = screen.getByRole("slider", { name: "Filey AI effort" });
  expect(slider).toHaveValue("3");
  fireEvent.change(slider, { target: { value: "0" } });
  expect(change).toHaveBeenCalledExactlyOnceWith(false);
  expect(effort).not.toHaveBeenCalled();
});

it("offers an explicit reasoning switch and supported levels in Advanced", () => {
  const change = vi.fn(), effort = vi.fn();
  const view = render(<AgentEffortControl config={managed} value="low" disabled={false} onChange={effort} onReasoningChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Filey AI effort: Fast" }));
  const advanced = screen.getByRole("button", { name: "Advanced" });
  fireEvent.click(advanced);
  expect(advanced).toHaveAttribute("aria-expanded", "true");
  const control = screen.getByRole("switch", { name: "Reasoning" });
  expect(control).toHaveAttribute("aria-checked", "false");
  expect(screen.getByRole("combobox", { name: "Reasoning level" })).toBeDisabled();
  fireEvent.click(control);
  expect(change).toHaveBeenCalledExactlyOnceWith(true);
  view.rerender(<AgentEffortControl config={managed} value="low" disabled={false} reasoningEnabled onChange={effort} onReasoningChange={change} />);
  const levels = screen.getByRole("combobox", { name: "Reasoning level" });
  expect(levels).not.toBeDisabled();
  fireEvent.change(levels, { target: { value: "high" } });
  expect(effort).toHaveBeenCalledExactlyOnceWith("high");
  expect(document.body).not.toHaveTextContent(/deepseek|filey-ai/);
});

it("locks the trigger, slider and advanced controls if a task starts with the menu open", () => {
  const change = vi.fn(), effort = vi.fn();
  const view = render(<AgentEffortControl config={managed} value="low" disabled={false} reasoningEnabled onChange={effort} onReasoningChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Filey AI effort: Low" }));
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  view.rerender(<AgentEffortControl config={managed} value="low" disabled reasoningEnabled onChange={effort} onReasoningChange={change} />);
  for (const control of [screen.getByRole("button", { name: "Filey AI effort: Low" }), screen.getByRole("slider"), screen.getByRole("switch"), screen.getByRole("combobox")]) expect(control).toBeDisabled();
  fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("switch"));
  expect(change).not.toHaveBeenCalled();
  expect(effort).not.toHaveBeenCalled();
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

it("locks an already-open own-provider effort menu during a task too", () => {
  const change = vi.fn();
  const config = { ...managed, model: "gpt-5.2", billing: undefined };
  const view = render(<AgentEffortControl config={config} value="high" disabled={false} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Reasoning effort: High" }));
  view.rerender(<AgentEffortControl config={config} value="high" disabled onChange={change} />);
  expect(screen.getByRole("slider")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reset effort" })).toBeDisabled();
  fireEvent.change(screen.getByRole("slider"), { target: { value: "4" } });
  expect(change).not.toHaveBeenCalled();
});
