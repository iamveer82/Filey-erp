// Offline accounts.
//
// Every user has a real email account now, in cloud mode AND offline. But an
// offline install must keep working on a plane, so after a successful ONLINE
// sign-in this remembers the identity on the device: the email, the account id,
// and a PBKDF2 hash of the password. The password itself is never stored.
// A later sign-in with no connection is checked against that hash locally.
//
// Deliberately NOT a security boundary against someone holding the device —
// the local database is unencrypted, so anyone with the file has the data
// regardless. This exists so the app can tell WHICH account a device belongs
// to while offline, and so signing out doesn't strand a user outside their own
// data. Treat it as identity, not as a lock.

const CRED_KEY = "filey_local_credential";
const SESSION_KEY = "filey_local_session";
const OWNER_KEY = "filey_local_workspace_owner";
let credentialRevision = 0;

const hasControl = (value: string): boolean =>
  [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const identityId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 &&
  value !== "local-user" && !/\s/.test(value) && !hasControl(value);
const normalizedEmail = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && !hasControl(email) && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
};

/** The device workspace has one owner; cloud sign-in must not reassign its books. */
export function localWorkspaceOwner(): string | null {
  const saved = localStorage.getItem(OWNER_KEY);
  if (saved) return saved;
  // Upgrade existing installations without moving or deleting their records.
  const profile = localStorage.getItem("filey_local_profile");
  if (profile) {
    try {
      const p = JSON.parse(profile);
      const id = identityId(p?.id) ? p.id : getLocalCredential()?.userId;
      if (id) {
        localStorage.setItem(OWNER_KEY, id);
        return id;
      }
    } catch {
      /* an unreadable profile cannot establish ownership */
    }
  }
  if (
    localStorage.getItem(SESSION_KEY) === "1" ||
    localStorage.getItem("filey_cloud_seeded")
  ) {
    const id = getLocalCredential()?.userId;
    if (id) {
      localStorage.setItem(OWNER_KEY, id);
      return id;
    }
  }
  return null;
}

export function assertLocalAccount(userId: string, orgId?: string | null): void {
  const owner = localWorkspaceOwner();
  if (owner && owner !== userId)
    throw new Error(
      "This device workspace belongs to another account. Sign in with its original account; your cloud workspace is separate."
    );
  if (orgId !== undefined) {
    let profile: { id?: string; org_id?: string } = {};
    try {
      const saved = JSON.parse(localStorage.getItem("filey_local_profile") || "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) profile = saved;
    } catch {
      /* legacy profile has no verifiable organization */
    }
    if (
      profile.id === userId &&
      typeof profile.org_id === "string" && profile.org_id &&
      profile.org_id !== (orgId || "default")
    )
      throw new Error(
        "Your cloud organization differs from this device workspace. Keep the stores separate and contact your administrator before transferring data."
      );
  }
}

export function claimLocalWorkspace(userId: string): void {
  if (!identityId(userId)) throw new Error("Sign in before opening the device workspace.");
  assertLocalAccount(userId);
  localStorage.setItem(OWNER_KEY, userId);
}
// Keep existing verifier files readable; successful legacy sign-in upgrades
// them without needing a server or changing the verified account identity.
const LEGACY_ITERATIONS = 210_000;
// PBKDF2-HMAC-SHA256 work factor from OWASP's Password Storage Cheat Sheet.
const ITERATIONS = 600_000;

export interface LocalCredential {
  email: string;
  /** The cloud account id, so a later cloud sync attaches to the right user. */
  userId: string;
  /** Absent when the device was claimed from a live cloud session (OTP sign-in,
   *  or flipping sync off) — we know WHO owns the device but never saw a
   *  password, so offline password sign-in isn't available until one is used. */
  salt?: string;
  hash?: string;
  /** Absent on the original 210,000-iteration format. New verifiers record
   *  their work factor so increasing it never invalidates existing passwords. */
  iterations?: number;
  /** When this identity was last confirmed against the server. */
  verifiedAt: string;
}

const toB64 = (b: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(b)));
const fromB64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations = ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    key,
    256
  );
  return toB64(bits);
}

/** Both validated hashes have the same fixed length. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseLocalCredential(raw: string | null): LocalCredential | null {
  try {
    if (!raw || raw.length > 4096) return null;
    const c = JSON.parse(raw) as LocalCredential;
    const email = normalizedEmail(c?.email);
    if (!email || !identityId(c?.userId) || typeof c.verifiedAt !== "string" ||
      !Number.isFinite(Date.parse(c.verifiedAt))) return null;
    const cred: LocalCredential = { email, userId: c.userId, verifiedAt: c.verifiedAt };
    if (c.salt !== undefined || c.hash !== undefined || c.iterations !== undefined) {
      if (typeof c.salt !== "string" || typeof c.hash !== "string" ||
        !/^[A-Za-z0-9+/]{22}==$/.test(c.salt) || !/^[A-Za-z0-9+/]{43}=$/.test(c.hash) ||
        fromB64(c.salt).length !== 16 || fromB64(c.hash).length !== 32 ||
        (c.iterations !== undefined && c.iterations !== LEGACY_ITERATIONS && c.iterations !== ITERATIONS)) return null;
      cred.salt = c.salt;
      cred.hash = c.hash;
      if (c.iterations !== undefined) cred.iterations = c.iterations;
    }
    return cred;
  } catch {
    return null;
  }
}

export function getLocalCredential(): LocalCredential | null {
  try {
    return parseLocalCredential(localStorage.getItem(CRED_KEY));
  } catch {
    return null;
  }
}

export const hasLocalCredential = (): boolean => !!getLocalCredential();

/** Whether an OFFLINE password sign-in is possible on this device. */
export function hasLocalPassword(): boolean {
  const c = getLocalCredential();
  return !!(c?.salt && c?.hash);
}

type CredentialFence = { revision: number; raw: string | null; owner: string | null; session: string | null };
function captureFence(): CredentialFence | null {
  try {
    const owner = localWorkspaceOwner();
    return { revision: credentialRevision, raw: localStorage.getItem(CRED_KEY), owner, session: localStorage.getItem(SESSION_KEY) };
  } catch {
    return null;
  }
}
function fenceCurrent(fence: CredentialFence): boolean {
  try {
    return credentialRevision === fence.revision && localStorage.getItem(CRED_KEY) === fence.raw &&
      localWorkspaceOwner() === fence.owner && localStorage.getItem(SESSION_KEY) === fence.session;
  } catch {
    return false;
  }
}

/** Remember an identity that the SERVER just accepted. Only ever called after
 *  a real cloud sign-in or sign-up — never on the offline path, or the device
 *  could mint an account the server has never heard of. */
export async function rememberLocalCredential(
  email: string,
  userId: string,
  password: string
): Promise<void> {
  const typed = normalizedEmail(email);
  if (!typed || !identityId(userId) || typeof password !== "string" || !password)
    throw new Error("A verified account and password are required to remember offline sign-in.");
  const fence = captureFence();
  if (!fence || (fence.owner && fence.owner !== userId)) return;
  fence.revision = ++credentialRevision;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt);
  if (!fenceCurrent(fence)) return;
  const cred: LocalCredential = {
    email: typed,
    userId,
    salt: toB64(salt.buffer as ArrayBuffer),
    hash,
    iterations: ITERATIONS,
    verifiedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(CRED_KEY, JSON.stringify(cred));
  } catch {
    /* best-effort — an offline sign-in simply won't be available */
  }
}

/** Claim the device for an account the SERVER has already authenticated, when
 *  no password was involved — a one-time code, or an existing cloud session at
 *  the moment sync is switched off. Without this, those users land on the login
 *  screen with an unclaimed device and no way back into their own data.
 *  Never downgrades a credential that already has a password hash. */
export function rememberLocalIdentity(email: string, userId: string): void {
  const typed = normalizedEmail(email);
  if (!typed || !identityId(userId))
    throw new Error("A verified account is required to remember this device.");
  const owner = localWorkspaceOwner();
  if (owner && owner !== userId) return;
  const cur = getLocalCredential();
  if (cur?.hash && cur.userId === userId) {
    updateLocalCredentialEmail(typed);
    return;
  }
  const cred: LocalCredential = {
    email: typed,
    userId,
    verifiedAt: new Date().toISOString(),
  };
  credentialRevision++;
  try {
    localStorage.setItem(CRED_KEY, JSON.stringify(cred));
  } catch {
    /* best-effort */
  }
}

/** Adopt the server-confirmed email for the same verified account. An offline
 *  password match must never establish ownership of a different email. */
export function updateLocalCredentialEmail(email: string): void {
  const cred = getLocalCredential();
  if (!cred) return;
  const typed = normalizedEmail(email);
  const owner = localWorkspaceOwner();
  if (!typed || (owner && owner !== cred.userId)) return;
  credentialRevision++;
  try {
    localStorage.setItem(CRED_KEY, JSON.stringify({ ...cred, email: typed, verifiedAt: new Date().toISOString() }));
  } catch {
    /* ignore */
  }
}

/** Check the remembered verified account. A changed email is accepted only
 *  after a new online proof; a typed address alone cannot change this identity. */
export async function verifyLocalPassword(
  email: string,
  password: string
): Promise<boolean> {
  const fence = captureFence();
  const cred = parseLocalCredential(fence?.raw ?? null);
  if (!fence || !cred?.salt || !cred.hash || normalizedEmail(email) !== cred.email ||
    (fence.owner && fence.owner !== cred.userId)) return false;
  try {
    const iterations = cred.iterations ?? LEGACY_ITERATIONS;
    const hash = await derive(password, fromB64(cred.salt), iterations);
    if (!sameHash(hash, cred.hash) || !fenceCurrent(fence)) return false;
    if (iterations < ITERATIONS) {
      try {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const upgraded = await derive(password, salt);
        if (!fenceCurrent(fence)) return false;
        credentialRevision++;
        try {
          localStorage.setItem(CRED_KEY, JSON.stringify({ ...cred, salt: toB64(salt.buffer as ArrayBuffer), hash: upgraded, iterations: ITERATIONS }));
        } catch {
          /* A storage failure leaves the working legacy verifier intact. */
        }
      } catch {
        // The old verifier already matched; a best-effort rehash failure must
        // not strand its owner, but cancellation/scope changes still fail.
        return fenceCurrent(fence);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Explicitly remove cached offline sign-in, preserving the workspace owner
 *  and its records. Ordinary sign-out keeps this cache for later offline use. */
export function forgetLocalCredential(): void {
  credentialRevision++;
  try {
    localStorage.removeItem(CRED_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function isLocalSignedIn(): boolean {
  try {
    const owner = localWorkspaceOwner();
    const cred = getLocalCredential();
    return (
      localStorage.getItem(SESSION_KEY) === "1" &&
      !!cred && owner === cred.userId
    );
  } catch {
    return false;
  }
}

export function setLocalSignedIn(on: boolean): void {
  if (on) claimLocalWorkspace(getLocalCredential()?.userId ?? "");
  else credentialRevision++;
  try {
    if (on) localStorage.setItem(SESSION_KEY, "1");
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
