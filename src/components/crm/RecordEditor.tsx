import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, MessageCircle, Pencil, Plus, Trash2 } from "lucide-react";
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
import { ErrorBanner, Badge, statusTone } from "../ui";
import RecordSheet from "./RecordSheet";
import { RecordAvatar } from "./RecordIdentity";
import RecordSales from "./RecordSales";
import CrmAiActions from "./CrmAiActions";
import { crmDuplicates } from "../../lib/crmOrganization";
import {
  inputTypeFor,
  syncCustomFields,
  type CustomFieldDef,
} from "../../lib/customFields";

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
  mutationDisabled = false,
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
  mutationDisabled?: boolean;
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
  const [section, setSection] = useState<"details" | "documents" | CrmObject>("details");
  const customModule =
    kind === "companies" ? "customers" : kind === "contacts" ? "contacts" : null;
  const [customDefs, setCustomDefs] = useState<CustomFieldDef[] | null>(null);
  const [customError, setCustomError] = useState("");
  const [customAttempt, setCustomAttempt] = useState(0);
  useEffect(() => {
    if (!customModule) return;
    let active = true;
    setCustomDefs(null);
    setCustomError("");
    void syncCustomFields(customModule)
      .then((defs) => {
        if (active) setCustomDefs(defs);
      })
      .catch((e) => {
        if (active) setCustomError(errMsg(e));
      });
    return () => {
      active = false;
    };
  }, [customModule, customAttempt]);
  const customValues =
    row?.custom_fields && typeof row.custom_fields === "object"
      ? (row.custom_fields as Record<string, unknown>)
      : {};
  const customBlocked = !!customModule && customDefs === null;
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
    if (inFlight.current || mutationDisabled) return;
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
  const duplicates = row
    ? crmDuplicates(kind, data[kind]).filter((group) => group.ids.includes(row.id))
    : [];
  return (
    <RecordSheet
      title={row ? recordName(kind, row).slice(0, 100) : `New ${spec.singular}`}
      description={
        row
          ? `${label(spec.singular)} · #${row.id}`
          : `Create ${spec.singular} in your workspace. Required fields are marked *.`
      }
      media={
        <RecordAvatar
          kind={kind}
          name={row ? recordName(kind, row) : spec.singular}
          large
        />
      }
      busy={busy}
      onClose={() => {
        if (!inFlight.current) onClose();
      }}
      onBack={!editing ? onBack : undefined}
      backLabel={backLabel}
    >
      {mutationDisabled && (
        <p role="status" className="mb-4 text-sm text-danger">
          Refresh the workspace successfully before changing this record.
        </p>
      )}
      {!editing && !!duplicates.length && (
        <details className="mb-4 rounded-xl border border-border p-3 text-xs">
          <summary className="cursor-pointer font-medium">
            Review possible duplicates
          </summary>
          <p className="mt-2 text-muted-foreground">
            Matching details can belong to different people. Review each record before
            making changes.
          </p>
          {duplicates.map((group) => (
            <div key={group.reason} className="mt-2">
              <p className="text-muted-foreground">{group.reason}</p>
              {group.ids
                .filter((id) => id !== row?.id)
                .map((id) => (
                  <button
                    key={id}
                    className="btn-ghost"
                    onClick={() =>
                      onOpen(kind, data[kind].find((item) => item.id === id)!)
                    }
                  >
                    {recordName(kind, data[kind].find((item) => item.id === id)!)} · #{id}
                  </button>
                ))}
            </div>
          ))}
        </details>
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
      {customError && (
        <div className="mb-4">
          <ErrorBanner message={`Custom fields could not load: ${customError}`} />
          <button className="btn-ghost" onClick={() => setCustomAttempt((n) => n + 1)}>
            Retry custom fields
          </button>
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
            if (customBlocked) return;
            if (customModule)
              submitted.custom_fields = JSON.stringify(
                Object.fromEntries(
                  (customDefs || []).map((def) => [
                    def.key,
                    def.type === "checkbox"
                      ? fields.has(`custom:${def.key}`)
                      : String(fields.get(`custom:${def.key}`) || ""),
                  ])
                )
              );
            void run(() => onSave(submitted));
          }}
        >
          <fieldset
            disabled={busy || mutationDisabled}
            className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4"
          >
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
                          className="textarea"
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
                          list={
                            ["owner", "assignee"].includes(field.key)
                              ? "crm-record-owners"
                              : undefined
                          }
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
          <datalist id="crm-record-owners">
            {[
              ...new Set(
                OBJECT_KEYS.flatMap((object) =>
                  data[object].map((item) => text(item.owner || item.assignee))
                ).filter(Boolean)
              ),
            ]
              .sort()
              .map((owner) => (
                <option key={owner} value={owner} />
              ))}
          </datalist>
          {customModule && (
            <fieldset
              disabled={busy || mutationDisabled || customBlocked}
              className="mt-5 border-t border-border pt-4 grid sm:grid-cols-2 gap-4"
            >
              <legend className="text-sm font-semibold pt-4">Custom fields</legend>
              {customBlocked && !customError && (
                <p role="status" className="text-xs text-muted-foreground">
                  Loading custom fields…
                </p>
              )}
              {customDefs?.length === 0 && (
                <p className="sm:col-span-2 text-xs text-muted-foreground">
                  Add fields from the CRM toolbar to capture more information.
                </p>
              )}
              {customDefs?.map((def) => (
                <label key={def.key} className="block">
                  <span className="label">
                    {def.label}
                    {def.required ? " *" : ""}
                  </span>
                  {def.type === "select" ? (
                    <select
                      className="select"
                      name={`custom:${def.key}`}
                      defaultValue={text(customValues[def.key])}
                      required={def.required}
                    >
                      <option value="">Choose…</option>
                      {def.options?.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  ) : def.type === "checkbox" ? (
                    <input
                      className="h-4 w-4 accent-primary"
                      name={`custom:${def.key}`}
                      type="checkbox"
                      defaultChecked={[true, "true", 1, "1"].includes(
                        customValues[def.key] as string | number | boolean
                      )}
                      required={def.required}
                    />
                  ) : (
                    <input
                      className="input"
                      name={`custom:${def.key}`}
                      type={inputTypeFor(def.type)}
                      step={def.type === "number" ? "any" : undefined}
                      defaultValue={text(customValues[def.key])}
                      required={def.required}
                      maxLength={500}
                    />
                  )}
                </label>
              ))}
            </fieldset>
          )}
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
            <button
              className="btn-primary"
              disabled={busy || mutationDisabled || customBlocked}
            >
              {busy ? "Saving…" : row ? "Save changes" : `Create ${spec.singular}`}
            </button>
          </div>
        </form>
      ) : (
        row && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-5">
              {text(row[spec.group]) && (
                <Badge tone={statusTone(text(row[spec.group]))}>
                  {label(row[spec.group])}
                </Badge>
              )}
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
                disabled={busy || mutationDisabled}
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
                {["companies", "contacts", "deals"].includes(kind) && (
                  <button
                    className={cn(
                      "btn-ghost shrink-0",
                      section === "documents" && "bg-hover"
                    )}
                    aria-pressed={section === "documents"}
                    onClick={() => setSection("documents")}
                  >
                    Documents
                  </button>
                )}
              </div>
            )}
            {section === "documents" && (
              <RecordSales key={`${kind}:${row.id}`} kind={kind} row={row} />
            )}
            {section === "details" && (
              <dl className="crm-properties grid sm:grid-cols-2 gap-x-6 text-[13px] mb-6">
                {spec.fields
                  .filter((field) => field.type !== "textarea")
                  .map((field) => (
                    <div
                      key={field.key}
                      className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start gap-3 border-b border-border py-3"
                    >
                      <dt className="text-xs text-muted-foreground">{field.label}</dt>
                      <dd className="min-w-0 break-words">
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
                          ) : row.target_type === "invoice" &&
                            Number(row.target_id) > 0 ? (
                            <Link
                              className="underline underline-offset-4"
                              to={`/invoicing?open=${Number(row.target_id)}`}
                            >
                              Invoice #{text(row.target_id)}
                            </Link>
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
                        ) : field.options ? (
                          label(text(row[field.key])) || "—"
                        ) : (
                          text(row[field.key]) ||
                          (["owner", "assignee"].includes(field.key) ? "Unassigned" : "—")
                        )}
                      </dd>
                    </div>
                  ))}
                {spec.fields
                  .filter((field) => field.type === "textarea")
                  .map((field) => (
                    <div
                      className="sm:col-span-2 border-b border-border py-3"
                      key={field.key}
                    >
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
            {section === "details" && !!customDefs?.length && (
              <dl className="grid sm:grid-cols-2 gap-x-6 mb-4">
                {customDefs.map((def) => (
                  <div
                    key={def.key}
                    className="grid grid-cols-2 gap-3 border-b border-border py-3 text-[13px]"
                  >
                    <dt className="text-xs text-muted-foreground">{def.label}</dt>
                    <dd className="break-words">
                      {def.type === "checkbox"
                        ? [true, "true", 1, "1"].includes(
                            customValues[def.key] as string | number | boolean
                          )
                          ? "Yes"
                          : "No"
                        : text(customValues[def.key]) || "—"}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {kind === "leads" && row.status !== "converted" && (
              <div className="border-t border-border py-4 flex flex-wrap items-center gap-3">
                <button
                  className="btn-primary"
                  disabled={busy || mutationDisabled}
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
            {section === "details" && related && (
              <section className="border-t border-border py-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Relationship history</h3>
                </div>
                {[
                  ...relatedRows("activities").map((item) => ({
                    kind: "activities" as const,
                    item,
                  })),
                  ...relatedRows("notes").map((item) => ({
                    kind: "notes" as const,
                    item,
                  })),
                ]
                  .sort((a, b) =>
                    text(b.item.created_at).localeCompare(text(a.item.created_at))
                  )
                  .slice(0, 5)
                  .map(({ kind: object, item }) => (
                    <button
                      key={`${object}:${item.id}`}
                      className="flex w-full items-start gap-3 border-b border-border py-3 text-left hover:bg-hover"
                      onClick={() => onOpen(object, item)}
                    >
                      <RecordAvatar kind={object} name={recordName(object, item)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">
                          {recordName(object, item)}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {object === "notes" ? "Note" : label(item.kind)} ·{" "}
                          {fmtDate(item.created_at)}
                        </span>
                      </span>
                      <ArrowUpRight
                        size={14}
                        className="mt-1 shrink-0 text-muted-foreground"
                      />
                    </button>
                  ))}
                {!relatedRows("activities").length && !relatedRows("notes").length && (
                  <p className="py-3 text-[13px] text-muted-foreground">
                    Add a note or log a conversation to keep this relationship's history
                    in one place.
                  </p>
                )}
              </section>
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
            {section === "details" && <CrmAiActions kind={kind} row={row} />}
            <div className="border-t border-border pt-4 flex flex-wrap gap-3 items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Created {fmtDate(row.created_at)}
              </span>
              <button
                className="btn-ghost text-danger"
                disabled={busy || mutationDisabled}
                onClick={() => void run(onDelete)}
              >
                <Trash2 size={14} />
                Delete {spec.singular}
              </button>
            </div>
          </>
        )
      )}
    </RecordSheet>
  );
}
