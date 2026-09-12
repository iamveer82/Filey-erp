import { useRef, useState } from "react";
import { Modal, ErrorBanner } from "../ui";
import { bulkUpdateCrm, crmBulkFields } from "../../lib/crmOrganization";
import {
  label,
  recordName,
  text,
  type CrmData,
  type CrmObject,
  type CrmRow,
} from "../../lib/crmWorkspace";
import { agentStorageScope, requireAgentStorageScope } from "../../lib/agentStorage";
import { errMsg } from "../../lib/format";

export default function CrmBulkEdit({
  kind,
  rows,
  data,
  onClose,
  onSaved,
}: {
  kind: CrmObject;
  rows: CrmRow[];
  data: CrmData;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const fields = crmBulkFields(kind);
  const [key, setKey] = useState(fields[0].key),
    [value, setValue] = useState("");
  const [pending, setPending] = useState(rows),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false),
    scope = useRef(agentStorageScope());
  const field = fields.find((f) => f.key === key)!;
  const owners = [
    ...new Set(data[kind].map((row) => text(row[key])).filter(Boolean)),
  ].sort();
  return (
    <Modal
      open
      title="Update selected records"
      onClose={() => {
        if (!inFlight.current) onClose();
      }}
    >
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (inFlight.current) return;
          inFlight.current = true;
          setBusy(true);
          setError("");
          try {
            requireAgentStorageScope(scope.current ?? "signed-out");
            const result = await bulkUpdateCrm(kind, pending, key, value, data);
            setPending(result.failed.map((item) => item.row));
            setNotice(
              `${result.updated.length} updated. ${result.failed.length} need attention.`
            );
            if (result.failed.length)
              setError(
                result.failed
                  .map((item) => `${recordName(kind, item.row)}: ${item.error}`)
                  .join("\n")
              );
            await onSaved();
          } catch (e) {
            setError(errMsg(e));
          } finally {
            inFlight.current = false;
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-muted-foreground">
          Change one field across {pending.length} selected records. Review the value
          before applying.
        </p>
        <fieldset disabled={busy || !pending.length} className="space-y-4">
          <label className="block">
            <span className="label">Field to update</span>
            <select
              className="select"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setValue("");
              }}
            >
              {fields.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">New {field.label.toLowerCase()}</span>
            {field.options ? (
              <select
                required
                className="select"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              >
                <option value="">Choose {field.label.toLowerCase()}</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {label(option)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.type === "date" ? "date" : "text"}
                list={field.type === "date" ? undefined : "crm-bulk-values"}
                className="input"
                maxLength={500}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </label>
          <datalist id="crm-bulk-values">
            {owners.map((owner) => (
              <option key={owner} value={owner} />
            ))}
          </datalist>
          {!field.options && <p className="help">Leave empty to clear this field.</p>}
          <details>
            <summary className="cursor-pointer text-xs">Review selected records</summary>
            <ul className="max-h-40 overflow-auto text-xs mt-2 space-y-1">
              {pending.map((row) => (
                <li key={row.id}>
                  {recordName(kind, row)} · #{row.id}
                </li>
              ))}
            </ul>
          </details>
        </fieldset>
        {error && <ErrorBanner message={error} />}{" "}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
            {pending.length ? "Cancel" : "Done"}
          </button>
          <button
            className="btn-primary"
            disabled={busy || !pending.length || (!!field.options && !value)}
          >
            {busy ? "Updating…" : `Apply to ${pending.length} records`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
