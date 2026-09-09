import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Loader2, CheckCircle2 } from "lucide-react";
import { ErrorBanner, Modal } from "./ui";
import { useUI } from "../lib/ui";
import { parseCsvObjects } from "../lib/csv";
import { SelectMenu } from "./ui-menu";

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  /** Coerce the raw cell string into the value to import. */
  transform?: (v: string) => unknown;
}

/** Generic CSV importer: upload → auto-map headers to fields → preview →
 * import. `onImport` receives mapped, transformed row objects. */
export default function ImportCsvModal({
  open,
  title,
  fields,
  onClose,
  onImport,
}: {
  open: boolean;
  title: string;
  fields: ImportField[];
  onClose: () => void;
  onImport: (rows: Record<string, unknown>[]) => Promise<void>;
}) {
  const { toast } = useUI();
  const fileRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [raw, setRaw] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<Record<string, string>>({}); // field.key -> header
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const fileRequest = useRef(0);

  useEffect(() => {
    if (open) {
      fileRequest.current++;
      setHeaders([]);
      setRaw([]);
      setMap({});
      setReading(false);
      setError("");
    }
    return () => {
      // Invalidate file reads started after the modal opened, not just its first read.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      fileRequest.current++;
    };
  }, [open]);

  const onFile = async (f?: File) => {
    if (!f || inFlight.current) return;
    const version = ++fileRequest.current;
    setReading(true);
    setError("");
    try {
      const { headers: h, rows } = parseCsvObjects(await f.text());
      if (version !== fileRequest.current) return;
      setHeaders(h);
      setRaw(rows);
      // Auto-map by case-insensitive name / label match.
      const auto: Record<string, string> = {};
      for (const fl of fields) {
        const hit = h.find(
          (x) =>
            x.toLowerCase() === fl.key.toLowerCase() ||
            x.toLowerCase() === fl.label.toLowerCase()
        );
        if (hit) auto[fl.key] = hit;
      }
      setMap(auto);
    } catch (e) {
      if (version === fileRequest.current) {
        setHeaders([]);
        setRaw([]);
        setMap({});
        setError(`Could not read CSV: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      if (version === fileRequest.current) setReading(false);
    }
  };

  const ready =
    !reading && raw.length > 0 && fields.every((f) => !f.required || map[f.key]);

  const mapped = useMemo(
    () =>
      raw.map((r) => {
        const obj: Record<string, unknown> = {};
        for (const f of fields) {
          const col = map[f.key];
          const v = col ? (r[col] ?? "") : "";
          obj[f.key] = f.transform ? f.transform(v) : v;
        }
        return obj;
      }),
    [raw, map, fields]
  );

  const run = async () => {
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await onImport(mapped);
      toast.success(`Imported ${mapped.length} row(s).`);
      onClose();
    } catch (e) {
      toast.error(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!inFlight.current) onClose();
      }}
      title={title}
      size="lg"
    >
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      {reading && (
        <p role="status" className="text-sm text-muted-foreground mb-4">
          Reading CSV…
        </p>
      )}
      <label className="btn-ghost w-full justify-center mb-4">
        <Upload size={15} /> {raw.length ? "Choose a different file" : "Select CSV file"}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>

      {raw.length > 0 && (
        <>
          <p className="text-xs text-brand-400 mb-2">
            {raw.length} rows found · map your columns:
          </p>
          <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
            {fields.map((f) => (
              <div key={f.key} className="grid grid-cols-2 gap-2 items-center">
                <span className="text-sm font-medium text-ink">
                  {f.label}
                  {f.required && <span className="text-danger"> *</span>}
                </span>
                <SelectMenu
                  disabled={busy || reading}
                  ariaLabel={`CSV column for ${f.label}`}
                  value={map[f.key] ?? ""}
                  onChange={(v) => setMap((m) => ({ ...m, [f.key]: v }))}
                  options={[
                    { value: "", label: "— skip —" },
                    ...headers.map((h) => ({ value: h, label: h })),
                  ]}
                />
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex justify-end gap-2">
        <button
          className="btn-ghost"
          disabled={busy}
          onClick={() => {
            if (!inFlight.current) onClose();
          }}
        >
          Cancel
        </button>
        <button className="btn-primary" disabled={!ready || busy} onClick={run}>
          {busy ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Importing…
            </>
          ) : (
            <>
              <CheckCircle2 size={15} /> Import {raw.length || ""}
            </>
          )}
        </button>
      </div>
    </Modal>
  );
}
