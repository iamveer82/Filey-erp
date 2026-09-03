// The app-side half of 2FA: which factor counts as "on", whether a session
// still owes a code, and the stale-enrolment cleanup. Supabase's own crypto
// is not under test here — a fake client stands in for it.
import { describe, it, expect } from "vitest";
import { mfaFactor, mfaEnroll, mfaVerify, mfaRequired } from "./mfa";

function fakeAuth(opts?: {
  totp?: any[];
  aal?: { currentLevel: string; nextLevel: string };
}) {
  const calls: { op: string; arg?: any }[] = [];
  let totp = opts?.totp ?? [];
  const client: any = {
    auth: {
      mfa: {
        async listFactors() {
          return { data: { totp }, error: null };
        },
        async unenroll({ factorId }: any) {
          calls.push({ op: "unenroll", arg: factorId });
          totp = totp.filter((f) => f.id !== factorId);
          return { error: null };
        },
        async enroll() {
          calls.push({ op: "enroll" });
          return {
            data: { id: "new-factor", totp: { qr_code: "data:image/svg+xml,x", secret: "SEC" } },
            error: null,
          };
        },
        async challenge({ factorId }: any) {
          calls.push({ op: "challenge", arg: factorId });
          return { data: { id: "chal-1" }, error: null };
        },
        async verify(arg: any) {
          calls.push({ op: "verify", arg });
          return arg.code === "123456"
            ? { error: null }
            : { error: { message: "Invalid TOTP code entered" } };
        },
        async getAuthenticatorAssuranceLevel() {
          return { data: opts?.aal ?? { currentLevel: "aal1", nextLevel: "aal1" }, error: null };
        },
      },
    },
  };
  return { client, calls };
}

describe("mfaFactor", () => {
  it("ignores an unverified factor — a half-finished enrolment is not 2FA", async () => {
    const { client } = fakeAuth({ totp: [{ id: "f1", status: "unverified" }] });
    expect(await mfaFactor(client)).toBeNull();
  });

  it("returns the verified factor", async () => {
    const { client } = fakeAuth({
      totp: [{ id: "f1", status: "unverified" }, { id: "f2", status: "verified" }],
    });
    expect((await mfaFactor(client))?.id).toBe("f2");
  });
});

describe("mfaEnroll", () => {
  it("clears abandoned enrolments first so a retry isn't refused", async () => {
    const { client, calls } = fakeAuth({
      totp: [{ id: "stale", status: "unverified" }],
    });
    const e = await mfaEnroll(client);
    expect(calls.filter((c) => c.op === "unenroll").map((c) => c.arg)).toEqual(["stale"]);
    expect(e.factorId).toBe("new-factor");
    expect(e.secret).toBe("SEC");
  });

  it("never unenrolls a verified factor while setting up a new one", async () => {
    const { client, calls } = fakeAuth({ totp: [{ id: "live", status: "verified" }] });
    await mfaEnroll(client);
    expect(calls.some((c) => c.op === "unenroll")).toBe(false);
  });
});

describe("mfaVerify", () => {
  it("challenges then verifies with the fresh challenge id", async () => {
    const { client, calls } = fakeAuth();
    await mfaVerify("f1", "123456", client);
    expect(calls.map((c) => c.op)).toEqual(["challenge", "verify"]);
    expect(calls[1].arg).toMatchObject({ factorId: "f1", challengeId: "chal-1", code: "123456" });
  });

  it("throws on a wrong code so the caller can keep the prompt open", async () => {
    const { client } = fakeAuth();
    await expect(mfaVerify("f1", "000000", client)).rejects.toMatchObject({
      message: "Invalid TOTP code entered",
    });
  });
});

describe("mfaRequired", () => {
  it("is true when the session sits at aal1 but could reach aal2", async () => {
    const { client } = fakeAuth({ aal: { currentLevel: "aal1", nextLevel: "aal2" } });
    expect(await mfaRequired(client)).toBe(true);
  });

  it("is false once the code has been accepted", async () => {
    const { client } = fakeAuth({ aal: { currentLevel: "aal2", nextLevel: "aal2" } });
    expect(await mfaRequired(client)).toBe(false);
  });

  it("is false for an account with no factors", async () => {
    const { client } = fakeAuth({ aal: { currentLevel: "aal1", nextLevel: "aal1" } });
    expect(await mfaRequired(client)).toBe(false);
  });

  it("is false with no cloud client — 2FA must never lock an offline install out", async () => {
    expect(await mfaRequired(null)).toBe(false);
  });
});
