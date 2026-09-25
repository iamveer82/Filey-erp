/* Delivery challans share one record shape and persistence boundary for the
 * editor and AI tools. app_settings belongs to the active local/cloud workspace;
 * the former shared browser blob is retained only as a legacy device fallback. */
import type { StampSig } from "../components/StampSignature";
import { tools } from "./api";
import { todayYmd } from "./format";
import { isLocalMode } from "./dataMode";

export type DcItem = { description: string; qty: number };

/** Shipment lifecycle for the list's status pills / filters (DEMO parity). */
export type DcStatus = "preparing" | "in_transit" | "delivered" | "failed";

export type DcForm = {
  number: string;
  template: string;
  accent: string;
  dc_type: "delivery" | "goods_received" | "return";
  company_name: string;
  company_address: string;
  company_trn: string;
  party_name: string;
  party_address: string;
  party_trn: string;
  ref_number: string;
  issue_date: string;
  vehicle_number: string;
  driver_name: string;
  status: DcStatus;
  destination: string;
  eta: string;
  notes: string;
  font: string;
  items: DcItem[];
  stamp?: StampSig;
  signature?: StampSig;
  show_stamp?: boolean;
  show_signature?: boolean;
};

export interface DcRecord {
  id: number;
  number: string;
  dc_type: string;
  party_name: string;
  issue_date: string;
  item_count: number;
  show_stamp?: boolean;
  show_signature?: boolean;
  /** Shipment tracking — optional so records saved before it existed still render. */
  status?: DcStatus;
  destination?: string;
  eta?: string;
  created_at: string;
  /** Full editor payload — present on records saved after edit/quick-view
   *  support; older records only carry the summary fields above. */
  form?: DcForm;
}

export const DC_TYPES = [
  { id: "delivery", label: "Delivery Challan" },
  { id: "goods_received", label: "Goods Received Note" },
  { id: "return", label: "Return Challan" },
];

export const DC_STATUSES: {
  id: DcStatus;
  label: string;
  tone: "info" | "warn" | "success" | "danger";
}[] = [
  { id: "preparing", label: "Preparing", tone: "info" },
  { id: "in_transit", label: "In Transit", tone: "warn" },
  { id: "delivered", label: "Delivered", tone: "success" },
  { id: "failed", label: "Failed", tone: "danger" },
];

// Legacy browser key and the active workspace's app_settings key.
export const DC_STORAGE_KEY = "filey_delivery_challans";
export const DC_SETTING_KEY = "delivery_challans";

export async function loadChallans(): Promise<DcRecord[]> {
  const settings = await tools.settings();
  const saved = settings.find((row) => row.key === DC_SETTING_KEY)?.value;
  // Old unscoped browser records belong to the device. Never import them
  // into cloud mode, or mirror cloud reads over them when switching modes.
  const value = saved ?? (isLocalMode() ? localStorage.getItem(DC_STORAGE_KEY) : null);
  if (value == null) return [];
  const records: unknown = JSON.parse(value);
  if (!Array.isArray(records)) throw new Error("Delivery challan data could not be read.");
  return records as DcRecord[];
}

export async function saveChallans(records: DcRecord[]): Promise<void> {
  await tools.setSetting(DC_SETTING_KEY, JSON.stringify(records));
}

/** A blank editor payload. The number is passed in rather than generated here:
 *  the page and the agent reach the saved numbering format by different routes
 *  (sync module state vs an async load), and neither should be forced into the
 *  other's shape just to share this. */
export function blankChallanForm(number: string): DcForm {
  return {
    number,
    template: "standard",
    accent: "#222222",
    dc_type: "delivery",
    company_name: "",
    company_address: "",
    company_trn: "",
    party_name: "",
    party_address: "",
    party_trn: "",
    ref_number: "",
    issue_date: todayYmd(),
    vehicle_number: "",
    driver_name: "",
    status: "preparing",
    destination: "",
    eta: todayYmd(),
    notes: "",
    font: "'Plus Jakarta Sans', system-ui, sans-serif",
    show_stamp: false,
    show_signature: false,
    items: [{ description: "", qty: 1 }],
  };
}

/** Build the list record that wraps a form. Kept next to the form builder so
 *  the summary fields cannot fall out of step with the payload they summarise —
 *  the list renders from the summary, the editor from `form`. */
export function challanRecord(form: DcForm, id = Date.now()): DcRecord {
  return {
    id,
    number: form.number,
    dc_type: form.dc_type,
    party_name: form.party_name,
    issue_date: form.issue_date,
    item_count: form.items.length,
    show_stamp: form.show_stamp,
    show_signature: form.show_signature,
    status: form.status,
    destination: form.destination,
    eta: form.eta,
    created_at: new Date().toISOString(),
    form,
  };
}
