import { beforeEach, describe, expect, it, vi } from "vitest";

// The desktop build: per-account stores exist only where the Tauri bridge does.
const native = vi.hoisted(() => {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  return { calls: [] as { command: string; args: unknown }[], active: "" };
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: { userId?: string; primary?: boolean }) => {
    native.calls.push({ command, args });
    if (command === "open_account_store") native.active = args.primary ? "" : args.userId ?? "";
    if (command === "active_account_store") return native.active;
    return null;
  },
}));

import { reconcileAccountStore, storedAccountFor, switchAccountStore } from "../accountStores";
import { localWorkspaceOwner } from "../localAuth";

const credential = (userId: string, email: string) =>
  JSON.stringify({ email, userId, verifiedAt: "2026-10-22T00:00:00.000Z" });

function signedOutOwner(userId: string, email: string) {
  localStorage.setItem("filey_local_workspace_owner", userId);
  localStorage.setItem("filey_local_credential", credential(userId, email));
  localStorage.setItem("filey_bank_accounts", `[{"owner":"${userId}"}]`);
}

describe("several accounts on one computer", () => {
  beforeEach(() => {
    localStorage.clear();
    native.calls.length = 0;
    native.active = "";
  });

  it("opens another account's own books instead of refusing, and keeps the first owner's apart", async () => {
    signedOutOwner("owner-a", "a@example.com");
    expect(await switchAccountStore("owner-b")).toBe(true);
    expect(native.calls).toContainEqual({ command: "open_account_store", args: { userId: "owner-b", primary: false } });
    // B starts empty: none of A's identity or records came along.
    expect(localWorkspaceOwner()).toBeNull();
    expect(localStorage.getItem("filey_bank_accounts")).toBeNull();

    signedOutOwner("owner-b", "b@example.com");
    expect(await switchAccountStore("owner-a")).toBe(true);
    expect(native.calls).toContainEqual({ command: "open_account_store", args: { userId: "owner-a", primary: true } });
    expect(localWorkspaceOwner()).toBe("owner-a");
    expect(localStorage.getItem("filey_bank_accounts")).toBe('[{"owner":"owner-a"}]');
    // B can sign in offline later by email.
    expect(storedAccountFor("B@example.com ")).toBe("owner-b");
    expect(storedAccountFor("nobody@example.com")).toBeNull();
  });

  it("changes nothing for the same owner or an unclaimed computer", async () => {
    expect(await switchAccountStore("owner-a")).toBe(false);
    signedOutOwner("owner-a", "a@example.com");
    expect(await switchAccountStore("owner-a")).toBe(false);
    expect(native.calls).toEqual([]);
  });

  it("puts the right identity back when a switch stopped half way", async () => {
    signedOutOwner("owner-a", "a@example.com");
    await switchAccountStore("owner-b");
    signedOutOwner("owner-b", "b@example.com");
    await switchAccountStore("owner-a");
    // The desktop reopened B's books but the keys still say A.
    native.active = "owner-b";
    await reconcileAccountStore();
    expect(localWorkspaceOwner()).toBe("owner-b");
    expect(localStorage.getItem("filey_bank_accounts")).toBe('[{"owner":"owner-b"}]');
    expect(storedAccountFor("a@example.com")).toBe("owner-a");
  });
});
