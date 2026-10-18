import { expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UIProvider } from "../../lib/ui";
import { AuthProvider } from "../../lib/auth";

// Office work only needs its own module switched on; My Files below it reads nothing here.
vi.mock("../../lib/modules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/modules")>()),
  useModules: () => ({ loading: false, error: null, isEnabled: () => true }),
}));
vi.mock("../MyFiles", () => ({ default: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));

import OfficeWork from "../OfficeWork";

it("Office work lists all seven apps", async () => {
  const view = render(<MemoryRouter initialEntries={["/office"]}><AuthProvider><UIProvider><OfficeWork /></UIProvider></AuthProvider></MemoryRouter>);
  for (const name of ["Word", "Sheets", "PDF", "Slides", "Designs", "Fig", "Vector"])
    expect(await view.findByRole("button", { name: new RegExp(`^${name}`) })).toBeTruthy();
  view.unmount();
});
