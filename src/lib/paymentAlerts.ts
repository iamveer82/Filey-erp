/* UPI payment check for Indian businesses: read the bank's "credited" alert (SMS or email),
 * pull out the amount, the 12-digit UPI reference (UTR) and the payer, and match it to an
 * unpaid rupee invoice with exactly that balance.
 *
 * The idea of watching bank alerts comes from YouPI-PG (github.com/youpi-pg/YouPI-PG); no code
 * is taken from it. A bank alert is evidence, not proof: alerts can be forged or misread, so
 * only known bank senders are read, every reference counts once, and the owner confirms the
 * match before a payment is recorded. */
import { tools, type InvoiceDocSummary } from "./api";
import { isCreditNote } from "./einvoice";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface PaymentAlert {
  /** Stable key: the UTR when there is one, else a hash of the text. */
  key: string;
  amount: number;
  utr?: string;
  payer?: string;
  vpa?: string;
  /** YYYY-MM-DD */
  date: string;
  source: "email" | "sms" | "pasted";
  sender?: string;
  text: string;
}

/* Bank sender checks. RBI reserves the bank.in domain for banks. */
const BANK_DOMAINS = [
  "bank.in", "hdfcbank.net", "hdfcbank.com", "icicibank.com", "sbi.co.in", "axisbank.com", "kotak.com", "pnb.co.in",
  "bankofbaroda.co.in", "bankofbaroda.com", "canarabank.com", "canarabank.in", "unionbankofindia.co.in", "idfcfirstbank.com",
  "yesbank.in", "indusind.com", "federalbank.co.in", "aubank.in", "rblbank.com", "bandhanbank.com", "idbibank.co.in",
  "indianbank.in", "centralbankofindia.co.in", "iob.in", "ucobank.com", "bankofindia.co.in", "kvb.co.in", "southindianbank.com",
  "dcbbank.com", "equitasbank.com", "ujjivansfb.in", "paytmbank.com",
];
/** Is this email address (or "Name <address>") from a known Indian bank domain? */
export function bankEmail(from: string): boolean {
  const at = (/@([a-z0-9.-]+)/i.exec(from)?.[1] ?? "").toLowerCase();
  return !!at && BANK_DOMAINS.some((d) => at === d || at.endsWith(`.${d}`));
}
/** A bank SMS header ID inside a forwarded message ("SMS from VM-HDFCBK: ..."). */
export const bankSmsIn = (text: string) => (text.match(/\b[A-Z]{2}-[A-Z]{4,8}(?:-[A-Z])?\b/g) ?? []).some(bankSms);
/** Bank SMS come from header IDs such as "VM-HDFCBK", "AD-SBIUPI", "JM-ICICIT-S". */
const BANK_SMS = /^[A-Z]{2}-?(HDFC|ICICI|SBI|AXIS|KOTAK|KMB|PNB|BOB|BARODA|CANARA|CANBNK|UNION|UBI|IDFC|YES|INDUS|IDBI|FEDBNK|FEDERAL|AUBANK|RBL|BANDHN|INDBNK|IOB|UCO|BOI|CBI|KVB|SIB|DCB|PAYTM|PYTM|JUPITR|FIBANK)/i;
export const bankSms = (sender: string) => BANK_SMS.test(sender.trim());

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
function dateIn(text: string): string | undefined {
  let m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/.exec(text);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const mm = Number(m[2]), dd = Number(m[1]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  m = /\b(\d{1,2})[-\s]?([A-Za-z]{3})[a-z]*[-\s,]*(\d{2}|\d{4})\b/.exec(text);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  return m ? m[0] : undefined;
}

const hash = (s: string) => { let h = 5381; for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(36); };

/** A money-received alert, or null when the text is not one (debits, OTPs, offers, statements). */
export function parseAlert(text: string, source: PaymentAlert["source"], sender = "", fallbackDate = ""): PaymentAlert | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || /\b(otp|one time password)\b/i.test(t)) return null;
  const credit = /\b(credited|received|deposited|credit of|has been added|money received|you have received)\b/i;
  const debit = /\b(debited|spent|withdrawn|paid to|sent to|transferred to|purchase of|auto ?pay|emi)\b/i;
  if (!credit.test(t)) return null;
  // "debited from A/c X ... credited to beneficiary" alerts are outgoing: the credit belongs to someone else.
  if (debit.test(t) && !/\b(credited to (your|a\/c|ac|acct|account))\b/i.test(t) && t.search(debit) < t.search(credit)) return null;
  const money = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi;
  let amount = 0;
  for (const m of t.matchAll(money)) {
    // The first sum next to the credit is the payment; "Avl Bal Rs ..." is the balance.
    const before = t.slice(Math.max(0, (m.index ?? 0) - 25), m.index).toLowerCase();
    if (/(bal|balance|limit)\W*$/.test(before)) continue;
    amount = Number(m[1].replace(/,/g, ""));
    break;
  }
  if (!(amount > 0)) return null;
  const utr = /\b(?:utr|rrn|upi[\s/:-]*(?:ref|reference|txn|transaction|cr)?|ref(?:erence)?|txn)\s*(?:no\.?|number|id|#)?[\s.:#/-]*(\d{12})\b/i.exec(t)?.[1]
    ?? /\bUPI\/(?:CR\/)?(\d{12})\b/i.exec(t)?.[1]
    ?? /(?<![\d*xX])(\d{12})(?!\d)/.exec(t)?.[1];
  const vpa = /\b([a-z0-9][\w.-]{1,}@[a-z]{2,}[a-z0-9]*)(?![\w.@-])/i.exec(t)?.[1];
  const payer = /\b(?:from|by)\s+([A-Z][A-Za-z.&' ]{1,40}?)(?=\s+(?:[Oo]n|[Vv]ia|VPA|vpa|UPI|upi|[Rr]ef\w*|UTR|[Aa]\/[Cc]|[Tt]o|thru|[Tt]hrough|is|has)\b|[.,(]|$)/.exec(t)?.[1]?.trim();
  return {
    key: utr ? `utr:${utr}` : `txt:${hash(t)}`,
    amount: r2(amount), ...(utr ? { utr } : {}), ...(vpa ? { vpa } : {}), ...(payer && !/^(your|a\/c|ac)$/i.test(payer) ? { payer } : {}),
    date: dateIn(t) ?? fallbackDate, source, ...(sender ? { sender } : {}), text: t.slice(0, 500),
  };
}

export interface PaymentMatch {
  alert: PaymentAlert;
  /** Unpaid invoices whose balance equals the amount: one = match, more = the owner picks. */
  candidates: { id: number; number: string; customer: string; balance: number }[];
}

/** Unpaid rupee invoices whose balance equals each alert's amount, issued on or before it arrived. */
export function matchAlerts(alerts: PaymentAlert[], invoices: InvoiceDocSummary[]): PaymentMatch[] {
  const open = invoices.filter((d) => (d.currency || "INR") === "INR" && /^(sent|overdue|partial)$/i.test(d.status ?? "")
    && Number(d.balance ?? d.total) > 0.005 && !isCreditNote(d.invoice_type_code ?? ""));
  return alerts.map((alert) => ({
    alert,
    candidates: open
      .filter((d) => Math.abs(Number(d.balance ?? d.total) - alert.amount) < 0.01 && (!alert.date || !d.issue_date || d.issue_date <= alert.date))
      .map((d) => ({ id: d.id, number: d.number, customer: d.customer_name, balance: r2(Number(d.balance ?? d.total)) })),
  }));
}

/* What has been seen and what waits for the owner, shared across the workspace's devices. */
export const PAYMENT_ALERTS_KEY = "payment_alerts";
export interface PaymentAlertState {
  /** Alert keys already handled: a reference is never matched twice. */
  seen: string[];
  /** Alerts waiting for the owner to confirm or dismiss. */
  pending: PaymentAlert[];
  lastChecked?: string;
  /** Automatic checking; on unless the owner turns it off. */
  auto?: boolean;
}
export function parseAlertState(raw?: string | null): PaymentAlertState {
  try {
    const v = raw ? JSON.parse(raw) : {};
    return { seen: Array.isArray(v.seen) ? v.seen.map(String) : [], pending: Array.isArray(v.pending) ? v.pending : [],
      ...(typeof v.lastChecked === "string" ? { lastChecked: v.lastChecked } : {}), auto: v.auto !== false };
  } catch {
    return { seen: [], pending: [], auto: true };
  }
}
/** Add new alerts to the queue, skipping anything seen before. */
export function queueAlerts(state: PaymentAlertState, alerts: PaymentAlert[]): { state: PaymentAlertState; added: PaymentAlert[] } {
  const known = new Set([...state.seen, ...state.pending.map((a) => a.key)]);
  const added = alerts.filter((a) => !known.has(a.key) && (known.add(a.key), true));
  return { state: { ...state, pending: [...added, ...state.pending].slice(0, 100) }, added };
}
/** Take an alert off the queue (recorded or dismissed) and remember it. */
export const settleAlert = (state: PaymentAlertState, key: string): PaymentAlertState => ({
  ...state, pending: state.pending.filter((a) => a.key !== key), seen: [key, ...state.seen.filter((k) => k !== key)].slice(0, 1000),
});

export async function loadAlertState(): Promise<PaymentAlertState> {
  return parseAlertState((await tools.settings()).find((r) => r.key === PAYMENT_ALERTS_KEY)?.value);
}
