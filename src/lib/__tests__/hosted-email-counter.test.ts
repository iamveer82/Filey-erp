import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setCacheOrg } from "../api";
import { agentStorageScope } from "../agentStorage";
import { bumpEmailCount } from "../license";

const key = () => `filey:email_count:${encodeURIComponent(agentStorageScope()!)}`;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "cloud");
  setCacheOrg(null);
  setCacheOrg("email-org", "owner-a");
});
afterEach(() => { vi.restoreAllMocks(); setCacheOrg(null); });

it("isolates hosted usage by account and organization without inheriting an unowned legacy counter", async () => {
  localStorage.setItem("filey:email_count", JSON.stringify({ date: "2026-10-04", n: 10 }));
  const first = key();
  await bumpEmailCount();
  expect(JSON.parse(localStorage.getItem(first)!).n).toBe(1);
  setCacheOrg("email-org", "owner-b");
  const second = key();
  await bumpEmailCount();
  expect(JSON.parse(localStorage.getItem(second)!).n).toBe(1);
  expect(JSON.parse(localStorage.getItem(first)!).n).toBe(1);
  setCacheOrg("another-org", "owner-a");
  await bumpEmailCount();
  expect(JSON.parse(localStorage.getItem(key())!).n).toBe(1);
  expect(localStorage.getItem("filey:email_count")).toContain('"n":10');
});

it("checks the originating action before reading or writing a counter", async () => {
  const counter = key();
  const check = vi.fn(() => { throw new Error("Account changed"); });
  await expect(bumpEmailCount(check)).rejects.toThrow("Account changed");
  expect(localStorage.getItem(counter)).toBeNull();
});

it("does not write old or new account usage when the action changes during its asynchronous read", async () => {
  const original = key();
  let active = true;
  const read = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, name) {
    const result = read.call(this, name);
    if (name === original) { active = false; setCacheOrg("email-org", "owner-b"); }
    return result;
  });
  await expect(bumpEmailCount(() => { if (!active) throw new Error("Account changed"); })).rejects.toThrow("Account changed");
  expect(localStorage.getItem(original)).toBeNull();
  expect(localStorage.getItem(key())).toBeNull();
});
