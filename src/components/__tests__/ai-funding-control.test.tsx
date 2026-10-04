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

const status = {
  account: { available_micros: 0 },
  configured: true,
  models: [
    { id: "filey-ai", name: "Private provider model", input: 1e-6, output: 2e-6, image: 0.0125, vision: true },
    { id: "provider/paid", name: "Other paid model", input: 1e-6, output: 2e-6 },
    { id: "openrouter/free", name: "Free model", input: 0, output: 0, free: true },
  ],
} as CreditStatus;
function mount() {
  render(<MemoryRouter><AiFundingControl /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "AI payment method" }));
}

it("offers one generic paid Filey AI connection and keeps Coin and BYOK choices explicit", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue(status);
  mount();
  const paid = await screen.findByRole("button", { name: /Filey AI Usage is paid/ });
  expect(screen.getByText("0 Coin available")).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(/tokens|Coin input|Coin output|input image|spending estimates|no usage markup/i);
  expect(screen.queryByRole("searchbox")).toBeNull();
  expect(screen.queryByText(/Private provider model|Other paid model|Free model|provider\/paid|openrouter\/free/)).toBeNull();
  expect(setCreditChoice).not.toHaveBeenCalled();
  fireEvent.click(paid);
  expect(setCreditChoice).toHaveBeenCalledExactlyOnceWith("credits", "filey-ai");
  fireEvent.click(screen.getByRole("button", { name: "AI payment method" }));
  fireEvent.click(screen.getByRole("button", { name: /My API key or local model/ }));
  expect(setCreditChoice).toHaveBeenLastCalledWith("byok", undefined);
});

it("shows only Filey AI for a saved paid choice, including its tooltip", async () => {
  vi.mocked(creditChoice).mockReturnValue({ funding: "credits", model: "provider/old-model" });
  vi.mocked(getCreditStatus).mockResolvedValue(status);
  mount();
  expect(screen.getByRole("button", { name: "AI payment method" })).toHaveTextContent("Filey AI");
  expect(screen.getByRole("button", { name: "AI payment method" })).toHaveAttribute("title", "Filey AI");
  const paid = await screen.findByRole("button", { name: /Filey AI Usage is paid/ });
  expect(paid).toHaveAttribute("aria-pressed", "true");
  expect(document.body).not.toHaveTextContent("provider/old-model");
  expect(document.body).not.toHaveTextContent("Private provider model");
  expect(setCreditChoice).not.toHaveBeenCalled();
});

it("requires an explicit paid choice for retired free funding without automatically spending Coin", async () => {
  vi.mocked(creditChoice).mockReturnValue({ funding: "free", model: "" });
  vi.mocked(getCreditStatus).mockResolvedValue(status);
  mount();
  await screen.findByRole("button", { name: /Filey AI Usage is paid/ });
  expect(screen.getByText(/Your previous free connection is no longer available/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "AI payment method" })).toHaveTextContent("Choose AI connection");
  expect(setCreditChoice).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Filey AI Usage is paid/ }));
  expect(setCreditChoice).toHaveBeenCalledExactlyOnceWith("credits", "filey-ai");
});

it("does not offer an old paid or free catalog as the built-in connection", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status, models: status.models.slice(1) });
  mount();
  await screen.findByText(/Filey AI is not available yet/);
  expect(screen.getByRole("button", { name: /Filey AI Usage is paid/ })).toBeDisabled();
  expect(document.body).not.toHaveTextContent("Other paid model");
  expect(document.body).not.toHaveTextContent("Free model");
  expect(setCreditChoice).not.toHaveBeenCalled();
});

it("disables Filey AI while its service is unconfigured", async () => {
  vi.mocked(getCreditStatus).mockResolvedValue({ ...status, configured: false });
  mount();
  const paid = await screen.findByRole("button", { name: /Filey AI Usage is paid/ });
  expect(paid).toBeDisabled();
  fireEvent.click(paid);
  expect(setCreditChoice).not.toHaveBeenCalled();
});
