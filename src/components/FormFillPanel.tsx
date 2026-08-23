import { useEffect, useState } from "react";
import { Loader2, FileType2 } from "lucide-react";
import { readFormFields, fillForm, type PdfFormField } from "../lib/pdfTools";
import { errMsg } from "../lib/format";
import { SelectMenu } from "./ui-menu";

/**
 * Fill Form used to hand the user a textarea and ask them to type JSON, after
 * going away and running "List Form Fields" to discover the names. This reads
 * the field names out of their own PDF and renders one labelled input each, so
 * filling a form is just filling a form.
 */
export default function FormFillPanel({
  file,
  onDone,
}: {
  file?: File;
  /** Hands the filled PDF back to the workspace for preview/download. */
  onDone: (out: { name: string; bytes: Uint8Array }) => void;
}) {
  const [fields, setFields] = useState<PdfFormField[] | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!file) {
      setFields(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    readFormFields(file)
      .then((f) => {
        if (!alive) return;
        setFields(f);
        const seed: Record<string, string | boolean> = {};
        for (const x of f) seed[x.name] = x.value ?? (x.kind === "CheckBox" ? false : "");
        setValues(seed);
      })
      .catch((e) => alive && setError(errMsg(e) || "Could not read this PDF."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [file]);

  const set = (k: string, v: string | boolean) =>
    setValues((prev) => ({ ...prev, [k]: v }));

  const apply = async () => {
    if (!file) return;
    setRunning(true);
    setError("");
    try {
      // Only send fields the user actually set. Passing "" for an untouched
      // dropdown asks pdf-lib to select an option that does not exist, which
      // fails the whole fill with "Attempted to set invalid field value".
      const payload: Record<string, string | boolean> = {};
      for (const [k, v] of Object.entries(values)) {
        if (typeof v === "string" && v.trim() === "") continue;
        payload[k] = v;
      }
      if (Object.keys(payload).length === 0) {
        setError("Nothing to fill in yet. Type into at least one field first.");
        return;
      }
      onDone(await fillForm(file, JSON.stringify(payload)));
    } catch (e) {
      setError(errMsg(e) || "Could not fill this form.");
    } finally {
      setRunning(false);
    }
  };

  if (!file)
    return (
      <p className="py-10 text-center text-[13px] text-muted-foreground">
        Upload a PDF and its form fields appear here.
      </p>
    );

  if (loading)
    return (
      <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-muted-foreground">
        <Loader2 size={15} className="animate-spin" /> Reading the form…
      </p>
    );

  if (fields && fields.length === 0)
    return (
      <div className="py-10 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground">
          <FileType2 size={20} />
        </span>
        <p className="mt-3 text-[13px] font-medium text-foreground">
          This PDF has no fillable fields
        </p>
        <p className="mx-auto mt-1 max-w-[42ch] text-[12.5px] text-muted-foreground">
          It is a flat document, so there is nothing to type into. To write on it
          anyway, use E-sign Document or Add Text Stamp.
        </p>
      </div>
    );

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        {(fields ?? []).map((f) => {
          const id = `ff-${f.name}`;
          if (f.kind === "CheckBox")
            return (
              <label
                key={f.name}
                htmlFor={id}
                className="flex cursor-pointer items-center gap-2.5 self-end py-2"
              >
                <input
                  id={id}
                  type="checkbox"
                  className="cursor-pointer"
                  checked={values[f.name] === true}
                  onChange={(e) => set(f.name, e.target.checked)}
                />
                <span className="text-[13px] text-foreground">{f.name}</span>
              </label>
            );

          if (f.options?.length)
            return (
              <div key={f.name}>
                <label className="mb-1 block text-[12.5px] text-muted-foreground">
                  {f.name}
                </label>
                <SelectMenu
                  ariaLabel={f.name}
                  value={String(values[f.name] ?? "")}
                  onChange={(v) => set(f.name, v)}
                  options={[
                    { value: "", label: "Leave blank" },
                    ...f.options.map((o) => ({ value: o, label: o })),
                  ]}
                />
              </div>
            );

          return (
            <div key={f.name}>
              <label htmlFor={id} className="mb-1 block text-[12.5px] text-muted-foreground">
                {f.name}
              </label>
              <input
                id={id}
                className="input w-full"
                value={String(values[f.name] ?? "")}
                onChange={(e) => set(f.name, e.target.value)}
              />
            </div>
          );
        })}
      </div>

      {error && <p className="mt-4 text-[12.5px] text-danger">{error}</p>}

      <div className="mt-5 flex items-center gap-3">
        <button className="btn-primary" onClick={apply} disabled={running}>
          {running ? <Loader2 size={14} className="animate-spin" /> : null}
          {running ? "Filling…" : "Fill and download"}
        </button>
        <span className="text-[12.5px] text-muted-foreground">
          {(fields ?? []).length} field{(fields ?? []).length === 1 ? "" : "s"} in this PDF
        </span>
      </div>
    </div>
  );
}
