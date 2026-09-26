import { expect, it } from "vitest";
import { assertWorkspaceCurrent } from "../dataMode";

it("blocks old-tab data access after storage switches in a different tab", () => {
  expect(() => assertWorkspaceCurrent()).not.toThrow();
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "filey_theme",
      oldValue: "light",
      newValue: "dark",
    })
  );
  expect(() => assertWorkspaceCurrent()).not.toThrow();
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "filey_data_mode",
      oldValue: "cloud",
      newValue: "local",
    })
  );
  expect(() => assertWorkspaceCurrent()).toThrow("Reload this workspace");
});
