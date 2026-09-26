// One password policy, used everywhere a password is set.
//
// There were three. Signup asked for 8 characters, the security panel asked for
// 8, and the account panel asked for 8 plus mixed case plus a digit or symbol —
// so the weakest rule guarded the front door, and a password accepted at signup
// could be rejected when the same user tried to set it again later.
//
// The rules here follow NIST SP 800-63B, which is not what most signup forms do:
//
//   - Length is the thing that matters. Minimum 8.
//   - Do NOT demand mixed case and symbols. Composition rules push people to
//     "Password1!" and forbid "correct horse battery staple", which is the wrong
//     way round. Those rules are gone.
//   - DO screen against passwords already known to attackers. That is the check
//     none of the three were doing, and it is the one that stops the guesses
//     actually used in credential-stuffing runs.
//
// The list below is not exhaustive and is not meant to be — a full breach corpus
// is millions of entries and belongs behind an API. These are the ones that turn
// up at the top of every leak, plus the ones this product invites specifically.
// ponytail: swap in a k-anonymity range query against a breach API if password
// stuffing ever shows up in the logs; the shape of checkPassword won't change.

/** bcrypt, which Supabase hashes with, silently ignores everything past 72
 *  bytes. Better to say so than to let someone believe in a 100-character
 *  passphrase that is really a 72-character one. */
export const MAX_BYTES = 72;
export const MIN_LENGTH = 8;

const COMMON = new Set([
  "password", "123456", "12345678", "123456789", "1234567890", "qwerty",
  "qwertyui", "qwertyuiop", "abc123", "111111", "1234567", "iloveyou",
  "000000", "123123", "admin", "letmein", "welcome", "monkey", "dragon",
  "sunshine", "princess", "football", "baseball", "master", "shadow",
  "superman", "trustno1", "passw0rd", "password1", "password123", "qwerty123",
  "1q2w3e4r", "zaq12wsx", "asdfghjk", "asdfghjkl", "loveyou", "whatever",
  "starwars", "computer", "michael", "jennifer", "jordan", "harley",
  "hunter", "ranger", "batman", "soccer", "killer", "charlie", "andrew",
  "matthew", "thomas", "robert", "daniel", "hockey", "ginger", "summer",
  "chocolate", "internet", "samsung", "google", "facebook", "linkedin",
  // This product and its context — the first things anyone would try here.
  "filey", "filey123", "fileyerp", "invoice", "accounts", "company",
  "business", "dubai", "dubai123", "uae12345", "emirates",
]);

const unleet = (s: string): string =>
  s
    .replace(/@/g, "a")
    .replace(/[$5]/g, "s")
    .replace(/0/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/7/g, "t");

const trimTail = (s: string): string => s.replace(/[^a-z]+$/, "");

/** The forms of a password that are all the same guess.
 *
 *  People decorate a common word to satisfy a rules-based form: capitalise it,
 *  stick digits on the end, swap a letter for a symbol. "P@ssw0rd123!" is
 *  "password" with a hat on. Order matters — the trailing "123" has to come off
 *  before the leet swap turns its 1 into an i and welds it to the word — so
 *  rather than pick one order, compare every form. */
function variants(pw: string): string[] {
  const low = pw.toLowerCase();
  const forms = new Set([low, trimTail(low), unleet(low), trimTail(unleet(low))]);
  // And the same again on the digit-stripped form, for "passw0rd123".
  forms.add(unleet(trimTail(low)));
  forms.add(trimTail(unleet(trimTail(low))));
  return [...forms];
}

/** A single run of one character, or a straight walk up or down the alphabet or
 *  the number row. Long enough to pass a length check, guessed almost first. */
function isSequential(pw: string): boolean {
  const s = pw.toLowerCase();
  if (/^(.)\1+$/.test(s)) return true;
  let up = true;
  let down = true;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (d !== 1) up = false;
    if (d !== -1) down = false;
  }
  return up || down;
}

export interface PasswordVerdict {
  ok: boolean;
  /** 0-4, for a strength meter. Only meaningful when `ok`. */
  score: number;
  /** What to fix, in words a person can act on. Null when `ok`. */
  problem: string | null;
}

/**
 * Judge a password. `email` (or any identifier) is optional but worth passing:
 * a password built from the address it protects is one guess away.
 */
export function checkPassword(pw: string, email?: string): PasswordVerdict {
  const bad = (problem: string): PasswordVerdict => ({ ok: false, score: 0, problem });

  if (!pw) return bad("Password is required");
  if (pw.length < MIN_LENGTH)
    return bad(`Password must be at least ${MIN_LENGTH} characters`);
  if (new TextEncoder().encode(pw).length > MAX_BYTES)
    return bad(`Password must be ${MAX_BYTES} characters or fewer`);
  if (isSequential(pw))
    return bad("That is a straight run of characters — mix it up");

  if (variants(pw).some((v) => COMMON.has(v)))
    return bad("That password is one of the most commonly used — pick another");

  // The local part of the address, when it is long enough to be distinctive.
  const local = (email ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && pw.toLowerCase().includes(local))
    return bad("Password must not contain your email address");

  // Passed. Score is for encouragement only — it never blocks.
  //
  // Length drives it, because length is what actually costs an attacker. A
  // variety bonus would otherwise let a decorated eight-character password
  // ("Tr4ffic!") score the same as a passphrase three times its length, which
  // is the exact misconception the composition rules taught and this module
  // exists to stop repeating.
  let score = pw.length >= 20 ? 4 : pw.length >= 14 ? 3 : pw.length >= 10 ? 2 : 1;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(pw)
  ).length;
  if (classes >= 3) score++;
  return { ok: true, score: Math.min(4, score), problem: null };
}

/** Label for the meter. */
export const strengthLabel = (score: number): string =>
  ["Weak", "Weak", "Fair", "Good", "Strong"][Math.max(0, Math.min(4, score))];
