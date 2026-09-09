import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  MessageCircle,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  CRM_OBJECTS,
  OBJECT_KEYS,
  targetTypes,
  objectForTarget,
  STAGE_PROB,
  recordDraft,
  recordName,
  linkedName,
  text,
  label,
  type CrmObject,
  type CrmRow,
  type CrmData,
} from "../../lib/crmWorkspace";
import { aed, fmtDate, errMsg, cn } from "../../lib/format";
import { Modal, ErrorBanner, Badge } from "../ui";

export default function RecordEditor({
  kind,
  row,
  data,
  initial,
  onClose,
  onSave,
  onDelete,
  onConvert,
  onOpen,
  onAdd,
  onBack,
  backLabel,
}: {
  kind: CrmObject;
  row?: CrmRow;
  data: CrmData;
  initial?: Record<string, string>;
  onClose: () => void;
  onSave: (draft: Record<string, string>) => Promise<void>;
  onDelete: () => Promise<void>;
  onConvert: () => Promise<void>;
  onOpen: (kind: CrmObject, row: CrmRow) => void;
  onAdd: (kind: CrmObject, initial: Record<string, string>) => void;
  onBack?: () => void;
  backLabel?: string;
}) {
  const spec = CRM_OBJECTS[kind];
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    ...recordDraft(kind, row),
    ...(kind === "deals" && initial?.stage && STAGE_PROB[initial.stage] != null
      ? { probability: String(STAGE_PROB[initial.stage]) }
      : {}),
    ...initial,
  }));
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(!row);
  const [section, setSection] = useState<"details" | CrmObject>("details");
  const set = (key: string, value: string) =>
    setDraft((d) => ({
      ...d,
      [key]: value,
      ...(key === "customer_id" ? { person_id: "" } : {}),
      ...(kind === "deals" && key === "stage" && STAGE_PROB[value] != null
        ? { probability: String(STAGE_PROB[value]) }
        : {}),
    }));
  const run = async (fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const related = row && targetTypes[kind] ? `${targetTypes[kind]}:${row.id}` : "";
  const targetOptions = OBJECT_KEYS.filter((k) => targetTypes[k]).flatMap((k) =>
    data[k].map((r) => ({
      value: `${targetTypes[k]}:${r.id}`,
      title: `${CRM_OBJECTS[k].singular}: ${recordName(k, r)}`,
    }))
  );
  const company = data.companies.find(
    (r) => r.id === Number(row?.company_id || row?.customer_id)
  );
  const contact = data.contacts.find((r) => r.id === Number(row?.person_id));
  const targetKind = objectForTarget(row?.target_type);
  const targetRecord =
    targetKind && data[targetKind].find((r) => r.id === Number(row?.target_id));
  const phone = text(row?.phone_e164 || row?.phone).replace(/[^\d+]/g, "");
  const whatsapp = /^\+[1-9]\d{6,14}$/.test(phone)
    ? `https://wa.me/${phone.slice(1)}`
    : "";
  const email = text(row?.email);
  const relatedRows = (object: CrmObject) => {
    if (!row) return [];
    if (object === "contacts" && kind === "companies")
      return data.contacts.filter((r) => Number(r.company_id) === row.id);
    if (object === "deals" && (kind === "companies" || kind === "contacts"))
      return data.deals.filter(
        (r) => Number(r[kind === "companies" ? "customer_id" : "person_id"]) === row.id
      );
    return related
      ? data[object].filter((r) => `${r.target_type}:${r.target_id}` === related)
      : [];
  };
  const relatedKinds: CrmObject[] = related
    ? [
        ...(kind === "companies" ? ["contacts" as const] : []),
        ...(["companies", "contacts"].includes(kind) ? ["deals" as const] : []),
        "tasks",
        "notes",
        "activities",
      ]
    : [];
  return (
    <Modal
      open
      title={row ? recordName(kind, row).slice(0, 100) : `New ${spec.singular}`}
      onClose={() => {
        if (!inFlight.current) onClose();
      }}
      size="xl"
    >
      {onBack && !editing && (
        <button
          type="button"
          className="btn-ghost mb-4 max-w-full"
          onClick={onBack}
          disabled={busy}
        >
          <ArrowLeft size={14} className="shrink-0" />
          <span className="truncate">Back to {backLabel || "record"}</span>
        </button>
      )}
      {onBack && editing && (
        <p className="text-xs text-muted-foreground mb-4">
          {row
            ? `Save changes to return to ${backLabel || "the previous record"}. Cancel keeps you on this record.`
            : `Adding a record from ${backLabel || "the previous record"}. Save or cancel to return.`}
        </p>
      )}
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // Read the submitted controls too: browser autofill and native date
            // pickers can change a value without React receiving onChange.
            const fields = new FormData(e.currentTarget);
            const submitted = Object.fromEntries(
              spec.fields.map((field) => [
                field.key,
                field.type === "checkbox"
                  ? String(fields.has(field.key))
                  : String(fields.get(field.key) || ""),
              ])
            );
            void run(() => onSave(submitted));
          }}
        >
          <fieldset disabled={busy} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {spec.fields.map((field) => {
              const id = `crm-${kind}-${field.key}`;
              let options = field.options?.map((value) => ({
                value,
                title: label(value),
              }));
              if (field.type === "company")
                options = data.companies.map((r) => ({
                  value: String(r.id),
                  title: recordName("companies", r),
                }));
              if (field.type === "contact")
                options = data.contacts
                  .filter(
                    (r) => !r.company_id || text(r.company_id) === draft.customer_id
                  )
                  .map((r) => ({
                    value: String(r.id),
                    title: recordName("contacts", r),
                  }));
              if (field.type === "target") options = targetOptions;
              if (
                kind === "leads" &&
                field.key === "status" &&
                row?.status === "converted"
              )
                options = [{ value: "converted", title: "Converted" }];
              // Keep historical values visible; never silently rewrite them on edit.
              if (
                options &&
                draft[field.key] &&
                !options.some((o) => o.value === draft[field.key])
              )
                options = [
                  ...options,
                  {
                    value: draft[field.key],
                    title: `${label(draft[field.key])} (current)`,
                  },
                ];
              return (
                <div
                  key={field.key}
                  className={
                    field.type === "textarea" || field.type === "target"
                      ? "sm:col-span-2"
                      : ""
                  }
                >
                  {field.type === "checkbox" ? (
                    <label className="flex items-center gap-2 text-sm min-h-10">
                      <input
                        type="checkbox"
                        name={field.key}
                        value="true"
                        checked={draft[field.key] === "true"}
                        onChange={(e) => set(field.key, String(e.target.checked))}
                      />
                      {field.label}
                    </label>
                  ) : (
                    <>
                      <label htmlFor={id} className="label">
                        {field.label}
                        {field.required ? " *" : ""}
                      </label>
                      {options ? (
                        <select
                          id={id}
                          name={field.key}
                          className="select"
                          value={draft[field.key]}
                          required={field.required}
                          onChange={(e) => set(field.key, e.target.value)}
                        >
                          {!field.options && (
                            <option value="">Select {field.label.toLowerCase()}</option>
                          )}
                          {options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.title}
                            </option>
                          ))}
                        </select>
                      ) : field.type === "textarea" ? (
                        <textarea
                          id={id}
                          name={field.key}
                          className="textarea min-h-28"
                          value={draft[field.key]}
                          required={field.required}
                          maxLength={20000}
                          onChange={(e) => set(field.key, e.target.value)}
                        />
                      ) : (
                        <input
                          id={id}
                          name={field.key}
                          className="input"
                          type={field.type || "text"}
                          value={field.type === "date" ? undefined : draft[field.key]}
                          defaultValue={
                            field.type === "date" ? draft[field.key] : undefined
                          }
                          required={field.required}
                          maxLength={500}
                          min={field.min}
                          max={field.max}
                          step={
                            field.type === "number"
                              ? field.key === "probability"
                                ? "1"
                                : "0.01"
                              : undefined
                          }
                          onChange={(e) => set(field.key, e.target.value)}
                        />
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </fieldset>
          <div className="sticky -bottom-5 z-10 flex flex-wrap justify-end gap-2 bg-card py-4 mt-5 border-t border-border">
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => {
                if (row) {
                  setDraft(recordDraft(kind, row));
                  setError("");
                  setEditing(false);
                } else (onBack || onClose)();
              }}
            >
              Cancel
            </button>
            <button className="btn-primary" disabled={busy}>
              {busy ? "Saving…" : row ? "Save changes" : `Create ${spec.singular}`}
            </button>
          </div>
        </form>
      ) : (
        row && (
          <>
            <div className="flex flex-wrap gap-2 mb-5">
              <Badge tone="neutral">
                {spec.singular} #{row.id}
              </Badge>
              <span className="flex-1" />
              {email && (
                <a className="btn-ghost" href={`mailto:${encodeURIComponent(email)}`}>
                  Email <ArrowUpRight size={13} />
                </a>
              )}
              {phone && (
                <a className="btn-ghost" href={`tel:${phone}`}>
                  Call <ArrowUpRight size={13} />
                </a>
              )}
              {whatsapp && (
                <a
                  className="btn-ghost"
                  href={whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle size={14} />
                  WhatsApp
                </a>
              )}
              {typeof row.telegram === "string" &&
                /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(row.telegram) && (
                  <a
                    className="btn-ghost"
                    href={`https://t.me/${row.telegram}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Telegram <ArrowUpRight size={13} />
                  </a>
                )}
              <button
                className="btn-ghost"
                onClick={() => {
                  setDraft(recordDraft(kind, row));
                  setError("");
                  setEditing(true);
                }}
                disabled={busy}
              >
                <Pencil size={14} />
                Edit
              </button>
            </div>
            {!!relatedKinds.length && (
              <div
                className="flex gap-2 overflow-x-auto pb-2 mb-4"
                role="group"
                aria-label="Record sections"
              >
                <button
                  className={cn(
                    "btn-ghost shrink-0",
                    section === "details" && "bg-hover"
                  )}
                  aria-pressed={section === "details"}
                  onClick={() => setSection("details")}
                >
                  Details
                </button>
                {relatedKinds.map((object) => (
                  <button
                    key={object}
                    className={cn("btn-ghost shrink-0", section === object && "bg-hover")}
                    aria-pressed={section === object}
                    onClick={() => setSection(object)}
                  >
                    {CRM_OBJECTS[object].label}{" "}
                    <span className="text-muted-foreground tabular-nums">
                      {relatedRows(object).length}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {section === "details" && (
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-4 text-sm mb-6">
                {spec.fields
                  .filter((field) => field.type !== "textarea")
                  .map((field) => (
                    <div key={field.key}>
                      <dt className="text-xs text-muted-foreground mb-1">
                        {field.label}
                      </dt>
                      <dd className="break-words">
                        {field.type === "company" && company ? (
                          <button
                            className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                            disabled={busy}
                            onClick={() => onOpen("companies", company)}
                          >
                            {recordName("companies", company)}
                          </button>
                        ) : field.type === "target" ? (
                          targetKind && targetRecord ? (
                            <button
                              className="underline decoration-border underline-offset-4 hover:decoration-foreground"
                              disabled={busy}
                              onClick={() => onOpen(targetKind, targetRecord)}
                            >
                              {linkedName(row, data)}
                            </button>
                          ) : (
                            linkedName(row, data)
                          )
                        ) : field.type === "contact" ? (
                          contact ? (
                            <button
                              className="underline decoration-border underline-offset-4 hover:decoration-foreground"
                              disabled={busy}
                              onClick={() => onOpen("contacts", contact)}
                            >
                              {recordName("contacts", contact)}
                            </button>
                          ) : (
                            "—"
                          )
                        ) : field.type === "date" ? (
                          fmtDate(text(row[field.key]))
                        ) : field.type === "checkbox" ? (
                          row[field.key] ? (
                            "Yes"
                          ) : (
                            "No"
                          )
                        ) : field.key === "value" || field.key === "est_value" ? (
                          aed(Number(row[field.key]) || 0)
                        ) : (
                          text(row[field.key]) || "—"
                        )}
                      </dd>
                    </div>
                  ))}
                {spec.fields
                  .filter((field) => field.type === "textarea")
                  .map((field) => (
                    <div className="sm:col-span-2" key={field.key}>
                      <dt className="text-xs text-muted-foreground mb-1">
                        {field.label}
                      </dt>
                      <dd className="whitespace-pre-wrap break-words">
                        {text(row[field.key]) || "—"}
                      </dd>
                    </div>
                  ))}
              </dl>
            )}
            {kind === "leads" && row.status !== "converted" && (
              <div className="border-t border-border py-4 flex flex-wrap items-center gap-3">
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => void run(onConvert)}
                >
                  <Check size={14} />
                  Convert lead
                </button>
                <span className="text-xs text-muted-foreground">
                  Creates a linked company, contact, and deal.
                </span>
              </div>
            )}
            {kind === "leads" && row.converted_deal_id != null && (
              <button
                className="btn-ghost mb-4"
                disabled={
                  busy || !data.deals.some((r) => r.id === Number(row.converted_deal_id))
                }
                onClick={() => {
                  const deal = data.deals.find(
                    (r) => r.id === Number(row.converted_deal_id)
                  );
                  if (deal) onOpen("deals", deal);
                }}
              >
                {data.deals.some((r) => r.id === Number(row.converted_deal_id))
                  ? "Open converted deal"
                  : "Converted deal unavailable"}
              </button>
            )}
            {related && (
              <div className="border-t border-border py-4 flex gap-2 flex-wrap">
                {(["tasks", "notes", "activities"] as CrmObject[]).map((k) => (
                  <button
                    key={k}
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() => onAdd(k, { target: related })}
                  >
                    <Plus size={14} />
                    {k === "activities"
                      ? "Log activity"
                      : `Add ${CRM_OBJECTS[k].singular}`}
                  </button>
                ))}
                {kind === "companies" && (
                  <button
                    className="btn-ghost"
                    onClick={() => onAdd("contacts", { company_id: String(row.id) })}
                    disabled={busy}
                  >
                    <Plus size={14} />
                    Add contact
                  </button>
                )}
                {(kind === "companies" || (kind === "contacts" && company)) && (
                  <button
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() =>
                      onAdd("deals", {
                        customer_id: String(kind === "companies" ? row.id : company!.id),
                        ...(kind === "contacts" ? { person_id: String(row.id) } : {}),
                      })
                    }
                  >
                    <Plus size={14} /> Add deal
                  </button>
                )}
              </div>
            )}
            {relatedKinds
              .filter((object) => section === object)
              .map((k) => {
                const items = relatedRows(k).sort((a, b) =>
                  text(b.created_at).localeCompare(text(a.created_at))
                );
                return (
                  <section key={k} className="border-t border-border py-4">
                    <h3 className="font-medium text-sm mb-2">
                      {CRM_OBJECTS[k].label}{" "}
                      <span className="text-muted-foreground">{items.length}</span>
                    </h3>
                    {!items.length && (
                      <p className="text-sm text-muted-foreground py-3">
                        No {CRM_OBJECTS[k].label.toLowerCase()} linked to this{" "}
                        {spec.singular} yet. Use the add actions above to keep its history
                        connected.
                      </p>
                    )}
                    <div className="max-h-60 overflow-auto divide-y divide-border">
                      {items.map((item) => (
                        <button
                          key={item.id}
                          className="w-full text-left py-3 px-2 hover:bg-hover rounded flex items-center gap-3"
                          disabled={busy}
                          onClick={() => onOpen(k, item)}
                        >
                          <span className="min-w-0 flex-1 text-sm truncate">
                            {recordName(k, item)}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {label(item.status || item.stage || item.kind) ||
                              fmtDate(item.created_at)}
                          </span>
                          <ArrowUpRight size={13} />
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            <div className="border-t border-border pt-4 flex flex-wrap gap-3 items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Created {fmtDate(row.created_at)}
              </span>
              <button
                className="btn-ghost text-danger"
                disabled={busy}
                onClick={() => void run(onDelete)}
              >
                <Trash2 size={14} />
                Delete {spec.singular}
              </button>
            </div>
          </>
        )
      )}
    </Modal>
  );
}
