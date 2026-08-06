// Offline sign-in decides who gets into a company's books with no server to
// ask, so the hashing and the match/no-match paths get covered directly.
import { describe, it, expect, beforeEach } from "vitest";
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
} from "./localAuth";

beforeEach(() => {
  localStorage.clear();
});

describe("remembering a verified identity", () => {
  it("stores the email and account id but never the password", async () => {
    await rememberLocalCredential("Owner@Example.com", "uid-1", "correct horse battery");
    const cred = getLocalCredential();
    expect(cred?.email).toBe("owner@example.com"); // normalised
    expect(cred?.userId).toBe("uid-1");
    expect(cred?.verifiedAt).toBeTruthy();
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

  it("accepts a changed account email when the password hash matches, and adopts it", async () => {
    // The account email is mutable server-side; the hash is the real check.
    expect(await verifyLocalPassword("new-owner@example.com", "hunter2hunter2")).toBe(true);
    expect(getLocalCredential()?.email).toBe("new-owner@example.com");
  });

  it("rejects everything when no identity has been remembered", async () => {
    forgetLocalCredential();
    expect(hasLocalCredential()).toBe(false);
    expect(await verifyLocalPassword("owner@example.com", "hunter2hunter2")).toBe(false);
  });
});

describe("the on-device session", () => {
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
