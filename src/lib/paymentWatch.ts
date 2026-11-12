/* Finds bank "credited" alerts and queues them against unpaid invoices. Sources:
 *  - Gmail connected under Integrations: bank emails, plus bank SMS that a phone's
 *    SMS-forwarding app sends to that mailbox;
 *  - a bank SMS or email pasted in by the owner.
 * Nothing is recorded here: confirmMatch does that, after the owner chooses. */
import { billing, tools } from "./api";
import { composioExecute, composioList } from "./composio";
import { todayYmd } from "./format";
import {
  PAYMENT_ALERTS_KEY, bankEmail, bankSmsIn, loadAlertState, matchAlerts, parseAlert, queueAlerts, settleAlert,
  type PaymentAlert, type PaymentAlertState, type PaymentMatch,
} from "./paymentAlerts";

const BANK_SENDERS = ["bank.in", "hdfcbank.net", "icicibank.com", "sbi.co.in", "axisbank.com", "kotak.com", "pnb.co.in",
  "bankofbaroda.co.in", "canarabank.com", "unionbankofindia.co.in", "idfcfirstbank.com", "yesbank.in", "indusind.com",
  "federalbank.co.in", "aubank.in", "rblbank.com", "idbibank.co.in", "indianbank.in"];
/** Bank emails, or forwarded SMS, that mention money coming in, from the last three days. */
export const GMAIL_ALERT_QUERY = `(from:(${BANK_SENDERS.join(" OR ")}) OR subject:sms) (credited OR received) newer_than:3d`;

export async function gmailConnected(): Promise<boolean> {
  try {
    return !!(await composioList()).items?.some((i) => i.toolkit?.slug === "gmail" && i.status === "ACTIVE");
  } catch {
    return false;
  }
}

const text = (v: unknown) => (typeof v === "string" ? v : "");
const ymd = (v: unknown) => {
  const n = Number(v);
  const d = Number.isFinite(n) && n > 0 ? new Date(n < 1e12 ? n * 1000 : n) : new Date(text(v));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

/** Alerts in the Gmail messages the connector returned. Only bank senders, or forwarded bank SMS, count. */
export function alertsFromGmail(data: unknown): PaymentAlert[] {
  const root = (data ?? {}) as Record<string, unknown>;
  const list = (root.messages ?? (root.response_data as Record<string, unknown> | undefined)?.messages ?? []) as Record<string, unknown>[];
  if (!Array.isArray(list)) return [];
  return list.flatMap((m) => {
    const from = text(m.sender ?? m.from);
    const preview = (m.preview ?? {}) as Record<string, unknown>;
    const body = [text(m.subject ?? preview.subject), text(m.messageText ?? preview.body ?? m.snippet)].filter(Boolean).join(" ");
    const sms = !bankEmail(from) && bankSmsIn(body);
    if (!bankEmail(from) && !sms) return [];
    const alert = parseAlert(body, sms ? "sms" : "email", from, ymd(m.messageTimestamp ?? m.internalDate ?? m.date));
    return alert ? [alert] : [];
  });
}

export async function fetchGmailAlerts(): Promise<PaymentAlert[]> {
  const res = await composioExecute("GMAIL_FETCH_EMAILS", { query: GMAIL_ALERT_QUERY, max_results: 25, include_payload: false });
  if (res.error) throw new Error(typeof res.error === "string" ? res.error : res.error.message);
  return alertsFromGmail(res.data);
}

export { loadAlertState };
const saveAlertState = (state: PaymentAlertState) => tools.setSetting(PAYMENT_ALERTS_KEY, JSON.stringify(state));

export interface PaymentCheck { added: PaymentAlert[]; state: PaymentAlertState; matches: PaymentMatch[]; gmail: boolean }

/** Look for new alerts (Gmail, plus any pasted ones) and match the waiting ones to unpaid invoices. */
export async function checkPayments(extra: PaymentAlert[] = [], useGmail = true): Promise<PaymentCheck> {
  const gmail = useGmail && await gmailConnected();
  const found = [...extra, ...(gmail ? await fetchGmailAlerts() : [])];
  const queued = queueAlerts(await loadAlertState(), found);
  const state = { ...queued.state, lastChecked: new Date().toISOString() };
  await saveAlertState(state);
  return { added: queued.added, state, gmail, matches: matchAlerts(state.pending, await billing.listDocs("sales")) };
}

/** Record the payment the owner confirmed, then take the alert off the queue for good. */
export async function confirmMatch(alert: PaymentAlert, invoiceId: number): Promise<void> {
  await billing.addPayment(invoiceId, alert.amount, `UPI${alert.utr ? ` ${alert.utr}` : ""}`, alert.date || todayYmd());
  await saveAlertState(settleAlert(await loadAlertState(), alert.key));
}

export async function dismissAlert(key: string): Promise<void> {
  await saveAlertState(settleAlert(await loadAlertState(), key));
}

export async function setAutoCheck(on: boolean): Promise<void> {
  await saveAlertState({ ...(await loadAlertState()), auto: on });
}
