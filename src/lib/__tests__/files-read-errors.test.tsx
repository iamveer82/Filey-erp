import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  signedIn: true,
  fail: "",
  count: 1,
  pages: [] as { table: string; start: number }[],
}));
vi.mock("../supabase", () => ({
  isConfigured: true,
  supabase: null,
  sb: () => ({
    auth: { getSession: async () => ({ data: { session: state.signedIn ? { user: { id: "owner" } } : null } }) },
    from: (table: string) => {
      let start = 0;
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        range: (offset: number) => {
          start = offset;
          state.pages.push({ table, start });
          return query;
        },
        then: (resolve: (value: unknown) => unknown) => resolve({
          error: state.fail === table ? { message: `${table} unavailable` } : null,
          data: Array.from({ length: Math.max(0, Math.min(500, state.count - start)) }, (_, i) => ({
            id: String(start + i), name: `Document ${start + i}.pdf`, mime: "application/pdf", size: 12,
            storage_path: `owner/${start + i}`, created_at: "2026-09-07T00:00:00Z", folder_id: null, parent_id: null,
          })),
        }),
      };
      return query;
    },
  }),
}));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("../ui", () => ({ useUI: () => ({ toast: {}, confirm: vi.fn(), prompt: vi.fn() }) }));

import { listFiles, listFolders, useFiles } from "../files";
import MyFiles from "../../pages/MyFiles";

beforeEach(() => {
  localStorage.clear();
  state.signedIn = true;
  state.fail = "";
  state.count = 1;
  state.pages = [];
});
afterEach(cleanup);

it("rejects unavailable file and folder reads, including a lost session", async () => {
  state.fail = "user_files";
  await expect(listFiles()).rejects.toMatchObject({ message: "user_files unavailable" });
  state.fail = "user_folders";
  await expect(listFolders()).rejects.toMatchObject({ message: "user_folders unavailable" });
  state.signedIn = false;
  await expect(listFiles()).rejects.toThrow("Sign in");
});

it("reads complete cloud counts beyond the server row cap and accepts genuinely empty folders", async () => {
  state.count = 1205;
  expect(await listFiles()).toHaveLength(1205);
  expect(await listFolders()).toHaveLength(1205);
  expect(state.pages).toEqual([
    { table: "user_files", start: 0 }, { table: "user_files", start: 500 }, { table: "user_files", start: 1000 },
    { table: "user_folders", start: 0 }, { table: "user_folders", start: 500 }, { table: "user_folders", start: 1000 },
  ]);
  state.count = 0;
  expect(await listFiles()).toEqual([]);
  expect(await listFolders()).toEqual([]);
});

it("retains the last coherent file snapshot on refresh failure and recovers on retry", async () => {
  const { result } = renderHook(() => useFiles());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.files).toHaveLength(1);
  state.count = 2;
  state.fail = "user_folders";
  await act(() => result.current.refresh());
  expect(result.current.error).toContain("user_folders unavailable");
  expect(result.current.files).toHaveLength(1);
  expect(result.current.loading).toBe(false);
  state.fail = "";
  await act(() => result.current.refresh());
  expect(result.current.error).toBe("");
  expect(result.current.files).toHaveLength(2);
});

it("shows a retry action instead of zero metrics when My Files cannot load", async () => {
  state.fail = "user_files";
  render(<MemoryRouter><MyFiles /></MemoryRouter>);
  expect(await screen.findByText(/Could not load your files/)).toBeInTheDocument();
  expect(screen.queryByText("Storage used")).not.toBeInTheDocument();
  state.fail = "";
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Storage used")).toBeInTheDocument();
  expect(screen.queryByText(/Could not load your files/)).not.toBeInTheDocument();
});
