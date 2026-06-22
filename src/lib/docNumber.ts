// Sequential document-number generator.
//
// Replaces the old `PREFIX-YYYY-<Math.random()>` scheme used across
// Invoicing, Quoting, Orders, Purchase Orders, Delivery Challans and
// Payment Receipts. Random numbers collide (only ~9k values/year) and
// look unprofessional on a printed document. This derives the next
// number deterministically from the documents already loaded on the
// client: highest sequence for the current year + 1, zero-padded.
//
// Pure function — callers pass the list they already hold (no extra
// fetch). When no prior documents exist for the year it starts at 1.

export interface NextNumberOpts {
  /** Document prefix, e.g. "INV", "QT", "SO", "LPO", "DC", "RCPT". */
  prefix: string;
  /** Numbers already issued, e.g. ["INV-2026-0007", "INV-2026-0012"]. */
  existing: string[];
  /** Four-digit year. Defaults to the current year. */
  year?: number;
  /** Zero-pad width for the sequence. Defaults to 4. */
  pad?: number;
}

/**
 * Returns the next sequential number for the year, e.g. "INV-2026-0013".
 *
 * Matching is tolerant of the legacy random format — it parses the
 * trailing integer of any `PREFIX-YYYY-<n>` string for the same year and
 * continues from the maximum, so a list mixing old random numbers and new
 * sequential ones still advances monotonically (never reissuing a value).
 */
export function nextDocNumber({
  prefix,
  existing,
  year,
  pad = 4,
}: NextNumberOpts): string {
  const y = year ?? new Date().getFullYear();
  const re = new RegExp(`^${escapeRe(prefix)}-${y}-0*(\\d+)$`, "i");
  let max = 0;
  for (const n of existing) {
    const m = typeof n === "string" && n.match(re);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > max) max = v;
    }
  }
  const seq = String(max + 1).padStart(pad, "0");
  return `${prefix}-${y}-${seq}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── User-defined number formats ────────────────────────────────────────────
//
// A format is a plain string the user controls. One token marks the part that
// auto-increments; everything else is fixed text printed verbatim.
//
//   {001}   the counter. The digits set BOTH the zero-pad width (3) and the
//           starting value (1). {0001} → width 4 start 1; {050} → width 3 start 50.
//   {YY}    two-digit year (26).   {YYYY}  four-digit year (2026).
//
// Example: "INV-DLS-{001}-26" → INV-DLS-001-26, then INV-DLS-002-26, …

const COUNTER_RE = /\{(\d+)\}/;
const YEAR_RE = /\{(YYYY|YY)\}/gi;

function resolveYear(pattern: string, year: number): string {
  return pattern.replace(YEAR_RE, (_, t) =>
    t.toUpperCase() === "YYYY" ? String(year) : String(year).slice(-2)
  );
}

/** True when the pattern has a counter token (and so can auto-increment). */
export function hasCounter(pattern: string): boolean {
  return COUNTER_RE.test(pattern);
}

/** Render a format at a specific sequence value, e.g. ("INV-{001}", 7) → "INV-007". */
export function renderPattern(
  pattern: string,
  seq: number,
  year: number = new Date().getFullYear()
): string {
  const withYear = resolveYear(pattern, year);
  const m = withYear.match(COUNTER_RE);
  if (!m) return withYear;
  return withYear.replace(COUNTER_RE, String(seq).padStart(m[1].length, "0"));
}

/**
 * Next number for a user-defined format. Reads the highest counter already
 * issued for the resolved year and adds one; if none exist yet it starts at the
 * value baked into the token. Falls back to a plain render when the pattern has
 * no counter token. Pure — the caller passes the numbers it already holds.
 */
export function nextFromPattern({
  pattern,
  existing = [],
  year,
}: {
  pattern: string;
  existing?: string[];
  year?: number;
}): string {
  const y = year ?? new Date().getFullYear();
  const m = pattern.match(COUNTER_RE);
  if (!m) return renderPattern(pattern, 1, y);
  const start = parseInt(m[1], 10) || 1;

  // Build a matcher from the year-resolved pattern: literals escaped, the
  // counter slot becomes 0*(\d+) so old/new pad widths both parse.
  const resolved = resolveYear(pattern, y);
  const i = resolved.indexOf(m[0]);
  const reSrc =
    "^" +
    escapeRe(resolved.slice(0, i)) +
    "0*(\\d+)" +
    escapeRe(resolved.slice(i + m[0].length)) +
    "$";
  const re = new RegExp(reSrc, "i");

  let max = 0;
  for (const n of existing) {
    const mm = typeof n === "string" && n.match(re);
    if (mm) {
      const v = parseInt(mm[1], 10);
      if (v > max) max = v;
    }
  }
  return renderPattern(pattern, max > 0 ? max + 1 : start, y);
}
