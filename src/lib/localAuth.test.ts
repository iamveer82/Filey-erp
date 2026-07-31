// Offline sign-in decides who gets into a company's books with no server to
// ask, so the hashing and the match/no-match paths get covered directly.
import { describe, it, expect, beforeEach } from "vitest";
import {
  getLocalCredential,
  hasLocalCredential,
  rememberLocalCredential,
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

  it("rejects a different account, even with a valid password", async () => {
    expect(await verifyLocalPassword("someone@else.com", "hunter2hunter2")).toBe(false);
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
