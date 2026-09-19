import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setDataMode } from "../../lib/dataMode";
import { messages } from "../../lib/api";
import { UIProvider } from "../../lib/ui";
import CompanyMessages from "../CompanyMessages";
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ user: { id: "local-user" } }) }));
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});
afterEach(cleanup);
it("renders locally stored messages without cloud ownership columns and can reply", async () => {
  await messages.post("Disposable team test");
  render(
    <UIProvider>
      <CompanyMessages />
    </UIProvider>
  );
  expect(await screen.findByText("Disposable team test")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete message" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Reply to You" }), {
    target: { value: "Reply works" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Post reply" }));
  expect(await screen.findByText("Reply works")).toBeInTheDocument();
});
