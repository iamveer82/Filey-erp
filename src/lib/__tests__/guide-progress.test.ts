import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { agentStorageScope } from "../agentStorage";
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";
import { loadGuideProgress, saveGuideProgress } from "../guideProgress";

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("guide-fixture", "owner");
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  setCacheOrg(null);
});

const keyFor = (scope: string) => `filey.guides.v1:${encodeURIComponent(scope)}`;

it("updates one guide while preserving the others and stores only progress", () => {
  const scope = agentStorageScope()!;
  expect(loadGuideProgress(scope)).toEqual({});
  expect(saveGuideProgress(scope, "create-invoice", { step: 0, finished: false })).toBe(true);
  expect(saveGuideProgress(scope, "packing-list", { step: 100, finished: true })).toBe(true);
  expect(saveGuideProgress(scope, "create-invoice", { step: 2, finished: true })).toBe(true);
  expect(loadGuideProgress(scope)).toEqual({
    "create-invoice": { step: 2, finished: true },
    "packing-list": { step: 100, finished: true },
  });
  expect(JSON.parse(localStorage.getItem(keyFor(scope))!)).toEqual(loadGuideProgress(scope));
});

it("isolates progress by account, organization and storage mode", () => {
  const original = agentStorageScope()!;
  saveGuideProgress(original, "create-invoice", { step: 3, finished: false });
  for (const [mode, org, user] of [["local", "guide-fixture", "another-owner"], ["local", "another-org", "owner"], ["cloud", "guide-fixture", "owner"]] as const) {
    setDataMode(mode);
    setCacheOrg(org, user);
    const current = agentStorageScope()!;
    expect(loadGuideProgress(current)).toEqual({});
    expect(loadGuideProgress(original)).toEqual({});
    expect(saveGuideProgress(original, "create-invoice", { step: 9, finished: true })).toBe(false);
    expect(saveGuideProgress(current, "packing-list", { step: 1, finished: false })).toBe(true);
  }
  setDataMode("local");
  setCacheOrg("guide-fixture", "owner");
  expect(loadGuideProgress(original)).toEqual({ "create-invoice": { step: 3, finished: false } });
});

it("never writes anonymous or empty scopes", () => {
  expect(loadGuideProgress(null)).toEqual({});
  expect(saveGuideProgress(null, "create-invoice", { step: 1, finished: false })).toBe(false);
  expect(saveGuideProgress("", "create-invoice", { step: 1, finished: false })).toBe(false);
  const prior = agentStorageScope()!;
  setCacheOrg(null);
  expect(saveGuideProgress(prior, "create-invoice", { step: 1, finished: false })).toBe(false);
  expect(Object.keys(localStorage).some(key => key.startsWith("filey.guides.v1:"))).toBe(false);
});

it.each([
  "{broken sensitive content", "null", "[]", "\"text\"",
  '{"create-invoice":{"step":2,"finished":false},"packing-list":null}',
  '{"create-invoice":{"step":2,"finished":false,"customer":"private"}}',
  '{"__proto__":{"step":1,"finished":false}}',
  '{"constructor":{"step":1,"finished":false}}',
  '{"prototype":{"step":1,"finished":false}}',
])("preserves corrupt source without implicit repair: %s", raw => {
  const scope = agentStorageScope()!;
  localStorage.setItem(keyFor(scope), raw);
  expect(loadGuideProgress(scope)).toEqual({});
  expect(saveGuideProgress(scope, "create-invoice", { step: 1, finished: false })).toBe(false);
  expect(localStorage.getItem(keyFor(scope))).toBe(raw);
  expect(Object.prototype).not.toHaveProperty("step");
});

it.each(["__proto__", "constructor", "prototype", "Guide", "two words", "-guide", "a".repeat(81)])("rejects an unsafe guide ID: %s", id => {
  const scope = agentStorageScope()!;
  expect(saveGuideProgress(scope, id, { step: 1, finished: false })).toBe(false);
  expect(localStorage.getItem(keyFor(scope))).toBeNull();
});

it.each([-1, 101, 1.5, NaN, Infinity])("rejects an invalid step: %s", step => {
  const scope = agentStorageScope()!;
  expect(saveGuideProgress(scope, "create-invoice", { step, finished: false })).toBe(false);
  expect(loadGuideProgress(scope)).toEqual({});
});

it("rejects malformed progress without storing unrelated data", () => {
  const scope = agentStorageScope()!;
  for (const value of [null, [], { step: "2", finished: false }, { step: 2, finished: "yes" }, { step: 2, finished: false, apiKey: "private" },
    Object.assign(Object.create({ step: 2 }), { finished: false, unrelated: true })])
    expect(saveGuideProgress(scope, "create-invoice", value as never)).toBe(false);
  expect(localStorage.getItem(keyFor(scope))).toBeNull();
});

it("returns a generic failure when storage reads are denied and retains existing progress", () => {
  const scope = agentStorageScope()!;
  saveGuideProgress(scope, "create-invoice", { step: 3, finished: false });
  const raw = localStorage.getItem(keyFor(scope));
  const original = Storage.prototype.getItem;
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
    if (key === keyFor(scope)) throw new Error("Private details must not be logged");
    return original.call(this, key);
  });
  expect(loadGuideProgress(scope)).toEqual({});
  expect(saveGuideProgress(scope, "create-invoice", { step: 4, finished: false })).toBe(false);
  expect(error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  expect(localStorage.getItem(keyFor(scope))).toBe(raw);
});

it("preserves existing source when storage writes fail", () => {
  const scope = agentStorageScope()!;
  saveGuideProgress(scope, "create-invoice", { step: 3, finished: false });
  const raw = localStorage.getItem(keyFor(scope));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
  expect(saveGuideProgress(scope, "create-invoice", { step: 4, finished: true })).toBe(false);
  expect(localStorage.getItem(keyFor(scope))).toBe(raw);
});

it("rechecks scope immediately before writing after a storage read", () => {
  const scope = agentStorageScope()!;
  const original = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
    if (key === keyFor(scope)) setCacheOrg("another-org", "another-owner");
    return original.call(this, key);
  });
  expect(saveGuideProgress(scope, "create-invoice", { step: 1, finished: false })).toBe(false);
  expect(localStorage.getItem(keyFor(scope))).toBeNull();
});
