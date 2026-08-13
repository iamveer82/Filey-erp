import { useState } from "react";
import { Modal, Field } from "./ui";
import { useUI } from "../lib/ui";
import { submitLead } from "../lib/lead";

/** "I want Freedom" — the buy button while the plan is sold by conversation
 *  rather than by Stripe. Takes the least it can get away with (a name and a
 *  number) and emails the owner. */
export default function FreedomContactModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useUI();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await submitLead({ name, phone, email, message: note, source: "app" });
      toast.success("Thanks — we'll call you about Filey Freedom shortly.");
      setName("");
      setPhone("");
      setEmail("");
      setNote("");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Get Filey Freedom">
      <div className="space-y-3">
        <p className="text-[13px] text-muted-foreground">
          AED 1,499, paid once, yours for good. Leave your details and we'll get
          in touch to set it up.
        </p>
        <Field label="Your name">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
          />
        </Field>
        <Field label="Phone">
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+971 50 000 0000"
          />
        </Field>
        <Field label="Email (optional)">
          <input
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </Field>
        <Field label="Anything we should know? (optional)">
          <textarea
            className="textarea min-h-[72px]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={send}
          disabled={busy || !name.trim() || !phone.trim()}
        >
          {busy ? "Sending…" : "Request Freedom"}
        </button>
      </div>
    </Modal>
  );
}
