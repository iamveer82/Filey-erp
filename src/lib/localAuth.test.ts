// Offline sign-in decides who gets into a company's books with no server to
// ask, so the hashing and the match/no-match paths get covered directly.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getLocalCredential,
  hasLocalCredential,
  hasLocalPassword,
  rememberLocalCredential,
  rememberLocalIdentity,
  verifyLocalPassword,
  forgetLocalCredential,
  isLocalSignedIn,
  setLocalSignedIn,
  claimLocalWorkspace,
  assertLocalAccount,
} from "./localAuth";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

async function legacyCredential(password = "legacy-password") {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 210_000, hash: "SHA-256" }, key, 256);
  const base64 = (value: ArrayBufferLike) => btoa(String.fromCharCode(...new Uint8Array(value)));
  return { email: "owner@example.com", userId: "uid-1", salt: base64(salt.buffer), hash: base64(bits), verifiedAt: "2025-01-02T03:04:05.000Z" };
}

function pauseNextDerivation() {
  const actual = crypto.subtle.deriveBits.bind(crypto.subtle);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const paused = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(crypto.subtle, "deriveBits").mockImplementationOnce(async (algorithm, key, length) => {
    entered();
    await paused;
    return actual(algorithm, key, length);
  });
  return { started, release };
}

describe("remembering a verified identity", () => {
  it("stores the email and account id but never the password", async () => {
    await rememberLocalCredential("Owner@Example.com", "uid-1", "correct horse battery");
    const cred = getLocalCredential();
    expect(cred?.email).toBe("owner@example.com"); // normalised
    expect(cred?.userId).toBe("uid-1");
    expect(cred?.verifiedAt).toBeTruthy();
    expect(cred?.iterations).toBe(600_000);
    // The password must not be recoverable from what was written to disk.
    expect(JSON.stringify(cred)).not.toContain("correct horse battery");
  });

  it("salts each device, so the same password yields a different hash", async () => {
    await rememberLocalCredential("a@b.com", "uid-1", "same-password");
    const first = getLocalCredential();
    localStorage.clear();
    await rememberLocalCredential("a@b.com", "uid-1", "same-password");
    const second = getLocalCredential();
    expect(first?.hash).not.toBe(second?.hash);
    expect(first?.salt).not.toBe(second?.salt);
  });
});

// Signing in by code, or switching a signed-in device to offline, claims the
// device without ever seeing a password. The device must know WHOSE it is
// (or the user is stranded at the login screen) while refusing every offline
// password guess (there is nothing to check them against).
describe("claiming a device with no password", () => {
  it("records the account and stays unusable for offline password sign-in", async () => {
    rememberLocalIdentity("Owner@Example.com", "uid-9");
    expect(hasLocalCredential()).toBe(true);
    expect(hasLocalPassword()).toBe(false);
    expect(getLocalCredential()?.email).toBe("owner@example.com");
    expect(getLocalCredential()?.userId).toBe("uid-9");
    expect(await verifyLocalPassword("owner@example.com", "anything at all")).toBe(false);
  });

  it("never overwrites a password this device already verified", async () => {
    await rememberLocalCredential("owner@example.com", "uid-1", "hunter2hunter2");
    rememberLocalIdentity("owner@example.com", "uid-1");
    expect(hasLocalPassword()).toBe(true);
    expect(await verifyLocalPassword("owner@example.com", "hunter2hunter2")).toBe(true);
  });

  it("re-claims the device when a different account signs in", async () => {
    await rememberLocalCredential("old@example.com", "uid-1", "hunter2hunter2");
    rememberLocalIdentity("new@example.com", "uid-2");
    expect(getLocalCredential()?.userId).toBe("uid-2");
    expect(hasLocalPassword()).toBe(false);
    expect(await verifyLocalPassword("new@example.com", "hunter2hunter2")).toBe(false);
  });
});

describe("verifying offline", () => {
  beforeEach(async () => {
    await rememberLocalCredential("owner@example.com", "uid-1", "hunter2hunter2");
  });

  it("accepts the right password", async () => {
    expect(await verifyLocalPassword("owner@example.com", "hunter2hunter2")).toBe(true);
  });

  it("is case-insensitive on the email, as sign-in forms are", async () => {
    expect(await verifyLocalPassword("Owner@Example.COM", "hunter2hunter2")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    expect(await verifyLocalPassword("owner@example.com", "hunter2hunter3")).toBe(false);
  });

  it("rejects a wrong password even with the right email", async () => {
    expect(await verifyLocalPassword("owner@example.com", "hunter2hunter3")).toBe(false);
  });

  it("never replaces a server-verified email with an offline typed address", async () => {
    const before = localStorage.getItem("filey_local_credential");
    expect(await verifyLocalPassword("new-owner@example.com", "hunter2hunter2")).toBe(false);
    expect(localStorage.getItem("filey_local_credential")).toBe(before);
    expect(getLocalCredential()?.email).toBe("owner@example.com");
  });

  it("adopts an online-confirmed email for the same account without losing its password", async () => {
    const before = getLocalCredential();
    rememberLocalIdentity("new-owner@example.com", "uid-1");
    expect(getLocalCredential()?.hash).toBe(before?.hash);
    expect(getLocalCredential()?.iterations).toBe(before?.iterations);
    expect(await verifyLocalPassword("new-owner@example.com", "hunter2hunter2")).toBe(true);
    expect(await verifyLocalPassword("owner@example.com", "hunter2hunter2")).toBe(false);
  });

  it("does not change online verification time during offline sign-in", async () => {
    const before = getLocalCredential();
    expect(await verifyLocalPassword("owner@example.com", "hunter2hunter2")).toBe(true);
    expect(getLocalCredential()?.verifiedAt).toBe(before?.verifiedAt);
  });

  it("rejects everything when no identity has been remembered", async () => {
    forgetLocalCredential();
    expect(hasLocalCredential()).toBe(false);
    expect(await verifyLocalPassword("owner@example.com", "hunter2hunter2")).toBe(false);
  });
});

describe("legacy verifier compatibility", () => {
  it("upgrades an actual 210k verifier after a valid password without changing account proof", async () => {
    const legacy = await legacyCredential();
    localStorage.setItem("filey_local_credential", JSON.stringify(legacy));
    expect(await verifyLocalPassword(legacy.email, "legacy-password")).toBe(true);
    const upgraded = getLocalCredential();
    expect(upgraded?.iterations).toBe(600_000);
    expect(upgraded?.salt).not.toBe(legacy.salt);
    expect(upgraded?.hash).not.toBe(legacy.hash);
    expect(upgraded?.email).toBe(legacy.email);
    expect(upgraded?.userId).toBe(legacy.userId);
    expect(upgraded?.verifiedAt).toBe(legacy.verifiedAt);
    expect(await verifyLocalPassword(legacy.email, "legacy-password")).toBe(true);
    expect(localStorage.getItem("filey_local_credential")).not.toContain("legacy-password");
  });

  it("does not upgrade or discard a legacy verifier after a wrong password", async () => {
    const legacy = JSON.stringify(await legacyCredential());
    localStorage.setItem("filey_local_credential", legacy);
    expect(await verifyLocalPassword("owner@example.com", "wrong-password")).toBe(false);
    expect(localStorage.getItem("filey_local_credential")).toBe(legacy);
  });

  it("leaves a usable legacy verifier intact when upgrading cannot persist", async () => {
    const legacy = JSON.stringify(await legacyCredential());
    localStorage.setItem("filey_local_credential", legacy);
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("Quota exceeded"); });
    expect(await verifyLocalPassword("owner@example.com", "legacy-password")).toBe(true);
    expect(localStorage.getItem("filey_local_credential")).toBe(legacy);
  });

  it("keeps a matched legacy password usable when the best-effort rehash fails", async () => {
    const legacy = JSON.stringify(await legacyCredential());
    localStorage.setItem("filey_local_credential", legacy);
    const actual = crypto.subtle.deriveBits.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "deriveBits").mockImplementationOnce(actual).mockRejectedValueOnce(new Error("Rehash unavailable"));
    expect(await verifyLocalPassword("owner@example.com", "legacy-password")).toBe(true);
    expect(localStorage.getItem("filey_local_credential")).toBe(legacy);
  });

  it("does not resurrect a credential forgotten while its legacy rehash is pending", async () => {
    localStorage.setItem("filey_local_credential", JSON.stringify(await legacyCredential()));
    const actual = crypto.subtle.deriveBits.bind(crypto.subtle);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const paused = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(crypto.subtle, "deriveBits").mockImplementationOnce(actual).mockImplementationOnce(async (algorithm, key, length) => {
      entered();
      await paused;
      return actual(algorithm, key, length);
    });
    const pending = verifyLocalPassword("owner@example.com", "legacy-password");
    await started;
    forgetLocalCredential();
    release();
    expect(await pending).toBe(false);
    expect(getLocalCredential()).toBeNull();
  });
});

describe("credential validation and async ownership", () => {
  it.each([
    { userId: "" }, { userId: "local-user" }, { userId: { id: "uid-1" } },
    { email: "unverified" }, { email: "owner\0@example.com" }, { verifiedAt: "invalid" }, { salt: "not-base64" },
    { hash: "" }, { iterations: 1 }, { iterations: 600_000.5 }, { iterations: 9_000_000_000 },
  ])("rejects malformed identity/verifier metadata without deriving or deleting it: %j", async patch => {
    const legacy = { ...await legacyCredential(), ...patch };
    const raw = JSON.stringify(legacy);
    localStorage.setItem("filey_local_credential", raw);
    localStorage.setItem("filey_local_session", "1");
    const derive = vi.spyOn(crypto.subtle, "deriveBits");
    expect(getLocalCredential()).toBeNull();
    expect(hasLocalPassword()).toBe(false);
    expect(isLocalSignedIn()).toBe(false);
    expect(await verifyLocalPassword("owner@example.com", "legacy-password")).toBe(false);
    expect(derive).not.toHaveBeenCalled();
    expect(localStorage.getItem("filey_local_credential")).toBe(raw);
  });

  it("does not treat an orphan local session as a verified account", () => {
    localStorage.setItem("filey_local_session", "1");
    expect(isLocalSignedIn()).toBe(false);
    expect(() => setLocalSignedIn(true)).toThrow("Sign in");
  });

  it("cannot resurrect a forgotten credential from a delayed online hash", async () => {
    const gate = pauseNextDerivation();
    const pending = rememberLocalCredential("owner@example.com", "uid-1", "owner-password");
    await gate.started;
    forgetLocalCredential();
    gate.release();
    await pending;
    expect(getLocalCredential()).toBeNull();
    expect(isLocalSignedIn()).toBe(false);
  });

  it("does not overwrite a newer account that claimed the workspace while hashing", async () => {
    const gate = pauseNextDerivation();
    const pending = rememberLocalCredential("owner@example.com", "uid-1", "owner-password");
    await gate.started;
    rememberLocalIdentity("second@example.com", "uid-2");
    setLocalSignedIn(true);
    gate.release();
    await pending;
    expect(getLocalCredential()?.userId).toBe("uid-2");
    expect(hasLocalPassword()).toBe(false);
    expect(isLocalSignedIn()).toBe(true);
  });

  it("rejects a password result that completes after sign-out", async () => {
    await rememberLocalCredential("owner@example.com", "uid-1", "owner-password");
    setLocalSignedIn(true);
    const gate = pauseNextDerivation();
    const pending = verifyLocalPassword("owner@example.com", "owner-password");
    await gate.started;
    setLocalSignedIn(false);
    gate.release();
    expect(await pending).toBe(false);
    expect(hasLocalPassword()).toBe(true);
    expect(isLocalSignedIn()).toBe(false);
  });

  it.each(["owner", "session"])("rejects an in-flight password result after another tab changes %s", async changed => {
    await rememberLocalCredential("owner@example.com", "uid-1", "owner-password");
    setLocalSignedIn(true);
    const gate = pauseNextDerivation();
    const pending = verifyLocalPassword("owner@example.com", "owner-password");
    await gate.started;
    // Direct storage writes simulate another tab without advancing this
    // module's in-memory revision counter.
    if (changed === "owner") localStorage.setItem("filey_local_workspace_owner", "uid-2");
    else localStorage.removeItem("filey_local_session");
    gate.release();
    expect(await pending).toBe(false);
    expect(isLocalSignedIn()).toBe(false);
  });

  it("rejects a stale password result after a newer server-confirmed password", async () => {
    await rememberLocalCredential("owner@example.com", "uid-1", "old-password");
    const gate = pauseNextDerivation();
    const pending = verifyLocalPassword("owner@example.com", "old-password");
    await gate.started;
    await rememberLocalCredential("owner@example.com", "uid-1", "new-password");
    gate.release();
    expect(await pending).toBe(false);
    expect(await verifyLocalPassword("owner@example.com", "new-password")).toBe(true);
  });

  it("rejects a credential belonging to a different workspace owner", async () => {
    await rememberLocalCredential("owner@example.com", "uid-1", "owner-password");
    localStorage.setItem("filey_local_workspace_owner", "uid-2");
    expect(await verifyLocalPassword("owner@example.com", "owner-password")).toBe(false);
    expect(isLocalSignedIn()).toBe(false);
  });
});

describe("the on-device session", () => {
  it("does not crash or change saved records when a legacy profile is null", async () => {
    await rememberLocalCredential("owner@example.com", "uid-1", "owner-password");
    localStorage.setItem("filey_local_profile", "null");
    expect(() => assertLocalAccount("uid-1", "company-one")).not.toThrow();
    expect(localStorage.getItem("filey_local_profile")).toBe("null");
    expect(getLocalCredential()?.userId).toBe("uid-1");
  });
  it("prevents transferring a device workspace into a different organization", () => {
    localStorage.setItem("filey_local_profile", JSON.stringify({ id: "uid-1", org_id: "company-one" }));
    expect(() => assertLocalAccount("uid-1", "company-two")).toThrow("organization differs");
    expect(() => assertLocalAccount("uid-1", "company-one")).not.toThrow();
  });
  it("keeps a device workspace and credential with its owner across another cloud sign-in", async () => {
    await rememberLocalCredential("owner@example.com", "uid-1", "owner-password");
    claimLocalWorkspace("uid-1");
    await rememberLocalCredential("other@example.com", "uid-2", "other-password");
    expect(getLocalCredential()?.userId).toBe("uid-1");
    expect(() => assertLocalAccount("uid-2")).toThrow("another account");
    expect(() => assertLocalAccount("uid-1")).not.toThrow();
  });
  it("signing out ends the session but KEEPS the identity", async () => {
    await rememberLocalCredential("owner@example.com", "uid-1", "hunter2hunter2");
    setLocalSignedIn(true);
    expect(isLocalSignedIn()).toBe(true);

    setLocalSignedIn(false);
    expect(isLocalSignedIn()).toBe(false);
    // Otherwise signing out on a plane strands the user outside their own books.
    expect(hasLocalCredential()).toBe(true);
    expect(await verifyLocalPassword("owner@example.com", "hunter2hunter2")).toBe(true);
  });

  it("forgetting the device clears both", async () => {
    await rememberLocalCredential("owner@example.com", "uid-1", "hunter2hunter2");
    setLocalSignedIn(true);
    forgetLocalCredential();
    expect(hasLocalCredential()).toBe(false);
    expect(isLocalSignedIn()).toBe(false);
  });
});
