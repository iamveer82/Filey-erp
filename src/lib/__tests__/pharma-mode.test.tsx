import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { tools } from "../api";
import { ModulesProvider, useModules } from "../modules";
import { requireToolModuleAccess } from "../moduleAccess";
import { toolsForRequest, appMapPrompt } from "../appMap";
import { pharmaModeFrom } from "../pharmaMode";
import { UIProvider } from "../ui";
import AppsManager from "../../pages/settings/AppsManager";

vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));

let settings: { key: string; value: string }[] = [];
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "local");
  settings = [];
  vi.spyOn(tools, "settings").mockImplementation(async () => settings as never);
  vi.spyOn(tools, "setSetting").mockImplementation(async (key, value) => {
    settings = [...settings.filter((s) => s.key !== key), { key, value }];
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); pharmaModeFrom([]); });

function Probe() {
  const m = useModules();
  const counter = m.enabledModules().find((x) => x.id === "counter");
  return <p>{m.loading ? "Loading" : `Sidebar: ${counter?.label ?? "none"}`}</p>;
}

it("keeps the Counter for everyone and turns it into the Pharmacy counter in Pharma mode", async () => {
  render(<ModulesProvider><UIProvider><Probe /><AppsManager /></UIProvider></ModulesProvider>);
  expect(await screen.findByText("Sidebar: Counter")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch", { name: "Turn Pharma mode on or off" }));
  expect(await screen.findByText("Sidebar: Pharmacy")).toBeInTheDocument();
  expect(settings).toContainEqual({ key: "pharma_mode", value: "on" });
  fireEvent.click(screen.getByRole("switch", { name: "Turn Pharma mode on or off" }));
  expect(await screen.findByText("Sidebar: Counter")).toBeInTheDocument();
  expect(settings).toContainEqual({ key: "pharma_mode", value: "off" });
});

it("gives every shop the agent's batch, expiry and counter tools, Pharma mode or not", async () => {
  for (const name of ["receive_batch", "write_off_batch", "expiry_report", "counter_sell"])
    await expect(requireToolModuleAccess(name, {})).resolves.toBeUndefined();
});

it("routes batches and expiry for everyone, and adds the Pharmacy area only in Pharma mode", () => {
  pharmaModeFrom([]);
  expect(toolsForRequest("which items expire soon")).toContain("expiry_report");
  expect(toolsForRequest("received batch B7 of milk powder")).toContain("receive_batch");
  expect(toolsForRequest("give me 2 paracetamol")).not.toContain("counter_sell");
  expect(appMapPrompt()).not.toContain("Pharmacy");
  pharmaModeFrom([{ key: "pharma_mode", value: "on" }]);
  expect(toolsForRequest("give me 2 paracetamol tablets")).toContain("counter_sell");
  expect(appMapPrompt()).toContain("Pharmacy");
});
