/* How an action waiting for the owner's OK reads on its card: the figure that matters,
 * who or what it is for, and the action in plain words. The full arguments stay one tap
 * away; the card never hides what will actually run. */
import { money } from "./format";

export interface ApprovalView {
  /** The large line: an amount when there is one, otherwise the action. */
  headline: string;
  /** Who or what it concerns, e.g. "INV-0023 · Rennox Trading". */
  subtitle: string;
  /** The action in plain words, e.g. "Record invoice payment". */
  action: string;
  /** Every argument as label → value, for the detail view. */
  details: [string, string][];
}

const AMOUNT_KEYS = ["amount", "total", "price", "unit_price", "value", "fee"];
const WHO_KEYS = ["invoice_number", "quote_number", "po_number", "number", "customer_name", "customer", "supplier", "party", "name", "to", "recipient", "phone", "email", "product", "title", "file"];

const words = (key: string) => key.replace(/_/g, " ");
export const actionLabel = (tool: string): string => {
  const text = words(tool);
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value.length > 240 ? `${value.slice(0, 237)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = JSON.stringify(value);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

export function describeApproval(tool: string, args: Record<string, unknown>): ApprovalView {
  const amountKey = AMOUNT_KEYS.find(key => typeof args[key] === "number" && Number.isFinite(args[key] as number));
  const currency = typeof args.currency === "string" && /^[A-Z]{3}$/.test(args.currency) ? args.currency : undefined;
  const action = actionLabel(tool);
  const who = WHO_KEYS.map(key => show(args[key])).filter(Boolean);
  const details = Object.entries(args)
    .map(([key, value]) => [words(key), show(value)] as [string, string])
    .filter(([, value]) => !!value);
  return {
    headline: amountKey ? money(args[amountKey] as number, currency) : action,
    subtitle: [...new Set(who)].slice(0, 2).join(" · ") || (amountKey ? action : details[0]?.[1] ?? ""),
    action,
    details,
  };
}

/** "Expires in 8 min", "Expires in 2 h", "Expires in 3 days"; null once past. */
export function expiresIn(at: number, now = Date.now()): string | null {
  const left = at - now;
  if (left <= 0) return null;
  const minutes = Math.ceil(left / 60_000);
  if (minutes < 60) return `Expires in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Expires in ${hours} h`;
  return `Expires in ${Math.round(hours / 24)} days`;
}
