import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AiFundingControl from "../AiFundingControl";
import {
  creditChoice,
  getCreditStatus,
  setCreditChoice,
  type CreditStatus,
} from "../../lib/aiCredits";

vi.mock("../../lib/aiCredits", async (original) => ({
  ...(await original<typeof import("../../lib/aiCredits")>()),
  getCreditStatus: vi.fn(),
  setCreditChoice: vi.fn(),
  creditChoice: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ supabase: null }));
beforeEach(() => {
  vi.mocked(creditChoice).mockReturnValue({ funding: "byok", model: "" });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  localStorage.clear();
});

it("selects named paid and free models without mixing funding, even with zero Paper", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue({
    account: { available_micros: 0 },
    markup_bps: 0,
    configured: true,
    models: [
      {
        id: "provider/paid",
        name: "Paid model",
        input: 0.000001,
        output: 0.000002,
        image: 0.0125,
        vision: true,
      },
      { id: "provider/free", name: "Free model", input: 0, output: 0, free: true },
    ],
  } as CreditStatus);
  render(
    <MemoryRouter>
      <AiFundingControl />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole("button", { name: "AI payment method" }));
  const search = await screen.findByRole("searchbox", { name: "Search AI models" });
  expect(screen.getByText("0 Paper available")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Paid model/ })).toHaveTextContent(
    "Up to 1 Paper input · 2 Paper output / 1M tokens"
  );
  expect(screen.getByRole("button", { name: /Paid model/ })).toHaveTextContent(
    "Up to 0.0125 Paper / input image"
  );
  expect(
    screen.getByText(/You pay actual usage; these rates are spending estimates/)
  ).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "missing" } });
  expect(screen.queryByRole("button", { name: /Paid model/ })).toBeNull();
  expect(screen.getByRole("combobox", { name: "Free AI model" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("No matching models");
  expect(setCreditChoice).not.toHaveBeenCalled();
  fireEvent.change(search, { target: { value: "provider/paid" } });
  fireEvent.click(screen.getByRole("button", { name: /Paid model/ }));
  expect(setCreditChoice).toHaveBeenLastCalledWith("credits", "provider/paid");
  fireEvent.click(screen.getByRole("button", { name: "AI payment method" }));
  fireEvent.change(await screen.findByRole("searchbox", { name: "Search AI models" }), {
    target: { value: "free" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Free AI model" }), {
    target: { value: "provider/free" },
  });
  expect(setCreditChoice).toHaveBeenLastCalledWith("free", "provider/free");
  fireEvent.click(screen.getByRole("button", { name: "AI payment method" }));
  fireEvent.click(
    screen.getByRole("button", {
      name: "My API key or local model No Filey usage fee. Provider charges may apply.",
    })
  );
  expect(setCreditChoice).toHaveBeenLastCalledWith("byok", undefined);
});

it("requires a model selection for a saved automatic-model alias", async () => {
  vi.mocked(creditChoice).mockReturnValue({ funding: "credits", model: "filey-ai" });
  vi.mocked(getCreditStatus).mockResolvedValue({
    account: { available_micros: 5e6 },
    configured: true,
    models: [{ id: "provider/paid", name: "Paid model", input: 1e-6, output: 2e-6 }],
  } as CreditStatus);
  render(
    <MemoryRouter>
      <AiFundingControl />
    </MemoryRouter>
  );
  expect(screen.getByRole("button", { name: "AI payment method" })).toHaveTextContent(
    "Choose a paid model"
  );
  fireEvent.click(screen.getByRole("button", { name: "AI payment method" }));
  await screen.findByRole("button", { name: /Paid model/ });
  expect(screen.getByText(/Choose a paid model to continue/)).toBeInTheDocument();
  expect(screen.queryByText("filey-ai")).toBeNull();
  expect(setCreditChoice).not.toHaveBeenCalled();
});

it("keeps paid Filey AI disabled when only free models are available", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue({
    account: { available_micros: 5e6 },
    configured: true,
    models: [
      { id: "provider/free", name: "Free model", input: 0, output: 0, free: true },
      { id: "filey-ai", name: "Legacy automatic model", input: 1e-6, output: 2e-6 },
    ],
  } as CreditStatus);
  render(
    <MemoryRouter>
      <AiFundingControl />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole("button", { name: "AI payment method" }));
  expect(await screen.findByRole("combobox", { name: "Free AI model" })).toBeEnabled();
  expect(screen.getByText(/Paid models are not available yet/)).toBeInTheDocument();
  expect(screen.queryByText("Legacy automatic model")).toBeNull();
  expect(screen.queryByRole("button", { name: /Paid model/ })).toBeNull();
  expect(setCreditChoice).not.toHaveBeenCalled();
});

it("disables named paid models when the service is not configured", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue({
    account: { available_micros: 5e6 },
    configured: false,
    models: [{ id: "provider/paid", name: "Paid model", input: 1e-6, output: 2e-6 }],
  } as CreditStatus);
  render(
    <MemoryRouter>
      <AiFundingControl />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole("button", { name: "AI payment method" }));
  const paid = await screen.findByRole("button", { name: /Paid model/ });
  expect(paid).toBeDisabled();
  fireEvent.click(paid);
  expect(setCreditChoice).not.toHaveBeenCalled();
});
