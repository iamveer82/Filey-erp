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
