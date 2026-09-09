import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UIProvider } from "../../lib/ui";
import { tools } from "../../lib/api";
import ActivityLog from "../settings/ActivityLog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows an activity loading error and lets the user retry", async () => {
  const load = vi
    .spyOn(tools, "auditLog")
    .mockRejectedValueOnce(new Error("Connection unavailable"))
    .mockResolvedValueOnce([]);
  render(
    <UIProvider>
      <ActivityLog />
    </UIProvider>
  );
  expect(
    await screen.findByText("Could not load activity: Connection unavailable")
  ).toBeVisible();
  expect(screen.queryByText("No activity recorded yet")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("No activity recorded yet")).toBeVisible();
  expect(load).toHaveBeenCalledTimes(2);
});
