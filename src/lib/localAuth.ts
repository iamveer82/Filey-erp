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
// OWASP's floor for PBKDF2-HMAC-SHA256. Runs once per sign-in, so the cost is
// invisible to the user and meaningful to anyone brute-forcing the file.
const ITERATIONS = 210_000;

export interface LocalCredential {
  email: string;
  /** The cloud account id, so a later cloud sync attaches to the right user. */
  userId: string;
  salt: string;
  hash: string;
  /** When this identity was last confirmed against the server. */
  verifiedAt: string;
}

const toB64 = (b: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(b)));
const fromB64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return toB64(bits);
}

/** Length-independent comparison so a wrong guess can't be timed. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function getLocalCredential(): LocalCredential | null {
  try {
    const raw = localStorage.getItem(CRED_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as LocalCredential;
    return c?.email && c?.hash && c?.salt ? c : null;
  } catch {
    return null;
  }
}

export const hasLocalCredential = (): boolean => !!getLocalCredential();

/** Remember an identity that the SERVER just accepted. Only ever called after
 *  a real cloud sign-in or sign-up — never on the offline path, or the device
 *  could mint an account the server has never heard of. */
export async function rememberLocalCredential(
  email: string,
  userId: string,
  password: string
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt);
  const cred: LocalCredential = {
    email: email.trim().toLowerCase(),
    userId,
    salt: toB64(salt.buffer as ArrayBuffer),
    hash,
    verifiedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(CRED_KEY, JSON.stringify(cred));
  } catch {
    /* best-effort — an offline sign-in simply won't be available */
  }
}

/** Check an email + password against the remembered identity. */
export async function verifyLocalPassword(
  email: string,
  password: string
): Promise<boolean> {
  const cred = getLocalCredential();
  if (!cred) return false;
  if (cred.email !== email.trim().toLowerCase()) return false;
  const hash = await derive(password, fromB64(cred.salt));
  return sameHash(hash, cred.hash);
}

/** Drop the remembered identity — used when switching the device to a
 *  different account, NOT on ordinary sign-out (that would strand the user
 *  outside their own offline data until they found a connection). */
export function forgetLocalCredential(): void {
  try {
    localStorage.removeItem(CRED_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function isLocalSignedIn(): boolean {
  try {
    return localStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function setLocalSignedIn(on: boolean): void {
  try {
    if (on) localStorage.setItem(SESSION_KEY, "1");
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
