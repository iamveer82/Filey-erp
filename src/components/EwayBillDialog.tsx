import { useMemo, useState } from "react";
import { Download, Truck } from "lucide-react";
import type { InvoiceDoc } from "../lib/api";
import { mergeItemMeta, type DocItem } from "../lib/docItems";
import { downloadText } from "../lib/localPaths";
import { money } from "../lib/format";
import { EWAY_LIMIT, TRANSPORT_MODES, ewayBillJson, ewayProblems, pincodeFrom, type EwayTransport } from "../lib/ewayBill";
import { summarizeGstDoc } from "../lib/gstReturns";
import { Field, Modal } from "./ui";
import { SelectMenu } from "./ui-menu";
import { DateField } from "./DatePicker";
import { toast } from "./Toaster";

/** The open invoice as a saved document: editor lines carry their calculation fields unpacked. */
const asDoc = (form: Record<string, unknown> & { items: DocItem[] }) =>
  ({ ...form, items: form.items.map((item) => ({ ...item, custom: mergeItemMeta(item) })) }) as unknown as InvoiceDoc;

/** E-way bill details for an Indian invoice, saved as the NIC portal's bulk-upload JSON. */
export default function EwayBillDialog({ open, onClose, form }: { open: boolean; onClose: () => void; form: Record<string, unknown> & { items: DocItem[] } }) {
  const doc = useMemo(() => asDoc(form), [form]);
  const [t, setT] = useState<EwayTransport>(() => ({
    mode: "1", distance: 0, vehicleNo: "", transporterId: "", transporterName: "", docNo: "", docDate: "",
    fromPincode: pincodeFrom(String(form.seller_address ?? "")), toPincode: pincodeFrom(String(form.customer_address ?? "")),
  }));
  const set = <K extends keyof EwayTransport>(key: K, value: EwayTransport[K]) => setT({ ...t, [key]: value });
  const value = useMemo(() => summarizeGstDoc(doc, { country_subdivision: String(form.seller_country_subdivision ?? ""), trn: String(form.seller_trn ?? "") }).value, [doc, form]);
  const problems = ewayProblems(doc, t);
  const save = () => {
    downloadText(`EWB_${doc.number.replace(/[^\w-]+/g, "_")}.json`, JSON.stringify(ewayBillJson(doc, t), null, 2), "application/json")
      .then(() => { toast.success("E-way bill JSON saved. Upload it at ewaybillgst.gov.in → E-waybill → Generate Bulk."); onClose(); })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not save the file."));
  };
  const road = t.mode === "1";

  return <Modal open={open} onClose={onClose} title={`E-way bill · ${doc.number}`} size="lg">
    <p className="mb-3 text-sm text-muted-foreground">
      Goods value {money(value, "INR")}. {value > EWAY_LIMIT ? "Above Rs 50,000: an e-way bill is required to move these goods." : "Rs 50,000 or less: an e-way bill is optional, except where your state asks for one."}
    </p>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Transport mode"><SelectMenu ariaLabel="Transport mode" value={t.mode} onChange={(v) => set("mode", v as EwayTransport["mode"])} options={[...TRANSPORT_MODES]} /></Field>
      <Field label="Distance (km)"><input className="input" type="number" min="1" max="4000" value={t.distance || ""} onChange={(e) => set("distance", Number(e.target.value) || 0)} /></Field>
      <Field label="Dispatch PIN code"><input className="input" inputMode="numeric" maxLength={6} value={t.fromPincode} onChange={(e) => set("fromPincode", e.target.value.replace(/\D/g, ""))} /></Field>
      <Field label="Delivery PIN code"><input className="input" inputMode="numeric" maxLength={6} value={t.toPincode} onChange={(e) => set("toPincode", e.target.value.replace(/\D/g, ""))} /></Field>
      {road
        ? <Field label="Vehicle number" hint="Like MH01AB1234. Leave blank if the transporter will add it."><input className="input uppercase" value={t.vehicleNo} onChange={(e) => set("vehicleNo", e.target.value)} /></Field>
        : <>
          <Field label="Transport document number" hint="Railway receipt, airway bill or bill of lading."><input className="input" value={t.docNo} onChange={(e) => set("docNo", e.target.value)} /></Field>
          <Field label="Transport document date"><DateField value={t.docDate} onChange={(v) => set("docDate", v)} /></Field>
        </>}
      <Field label="Transporter ID (optional)" hint="Their GSTIN or TRANSIN."><input className="input uppercase" maxLength={15} value={t.transporterId} onChange={(e) => set("transporterId", e.target.value)} /></Field>
      <Field label="Transporter name (optional)"><input className="input" value={t.transporterName} onChange={(e) => set("transporterName", e.target.value)} /></Field>
    </div>
    {problems.length > 0 && <ul role="alert" className="mt-3 list-disc space-y-1 rounded-xl border border-warning/40 bg-warning/10 p-3 pl-7 text-sm">
      {problems.map((p) => <li key={p}>{p}</li>)}
    </ul>}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Truck size={14} /> Then upload the file at ewaybillgst.gov.in to get the e-way bill number.</p>
      <div className="flex gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={problems.length > 0} onClick={save}><Download size={15} /> Download JSON</button>
      </div>
    </div>
  </Modal>;
}
