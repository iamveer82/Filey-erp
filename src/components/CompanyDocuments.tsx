import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Download, Eye, Trash2, Upload } from "lucide-react";
import { COMPANY_DOCUMENT_TYPES, fileBytes, fileObjectUrl, useFiles, type SavedFile } from "../lib/files";
import { saveMediaFile } from "../lib/mediaDownload";
import { validateDocumentUpload } from "../lib/documentUpload";
import { useUI } from "../lib/ui";
import { errMsg } from "../lib/format";
import { FormField, Modal } from "./ui";
import { SelectMenu } from "./ui-menu";

const PdfCanvas = lazy(() => import("./PdfCanvas"));

export default function CompanyDocuments({country}: {country: string}) {
  const {files, loading, error, refresh, upload, remove} = useFiles();
  const {toast, confirm} = useUI();
  const [type, setType] = useState("company-registration");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SavedFile | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const types = COMPANY_DOCUMENT_TYPES.filter(t => !t.country || t.country === country);
  const selectedType = types.some(t => t.key === type) ? type : "company-registration";
  const documents = files.filter(f => COMPANY_DOCUMENT_TYPES.some(t => t.key === f.tool));

  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await action(); } catch (cause) { toast.error(errMsg(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  const download = (file: SavedFile) => run(async () => {
    const bytes = await fileBytes(file);
    if (!bytes) throw new Error("This document is unavailable.");
    await saveMediaFile(new Blob([bytes.slice()], {type: file.mime}), file.name);
  });

  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Private to your account and kept off invoices. Uploads save immediately in this workspace's My Files.</p>
    <div className="flex flex-wrap items-end gap-3">
      <FormField label="Document type" className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        <SelectMenu value={selectedType} onChange={setType} options={types.map(t => ({value: t.key, label: t.label}))} />
      </FormField>
      <button type="button" className="btn-ghost" disabled={busy || loading || !!error} onClick={() => input.current?.click()}>
        <Upload size={16} /> {busy ? "Working…" : "Upload document"}
      </button>
      <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" aria-label="Upload company document"
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void run(async () => {
            validateDocumentUpload(file);
            await upload(file, selectedType);
            toast.success("Document saved to My Files.");
          });
        }} />
    </div>
    <p className="text-xs text-muted-foreground">PDF, PNG, JPG or WebP · up to 10 MB. For Aadhaar, upload a masked copy.</p>
    {error ? <div role="alert" className="text-sm text-danger">{error} <button type="button" className="btn-ghost" onClick={() => void refresh()}>Retry</button></div>
      : loading ? <p role="status" className="text-sm text-muted-foreground">Loading documents…</p>
      : documents.length === 0 ? <p className="text-sm text-muted-foreground">No company documents saved yet.</p>
      : <ul className="divide-y divide-border">
        {documents.map(file => <li key={file.id} className="flex flex-wrap items-center gap-2 py-3">
          <div className="min-w-0 flex-1 basis-40"><p className="break-all text-sm font-medium">{file.name}</p><p className="text-xs text-muted-foreground">{COMPANY_DOCUMENT_TYPES.find(t => t.key === file.tool)?.label}</p></div>
          <div className="flex gap-1">
            <button type="button" className="btn-ghost" aria-label={`View ${file.name}`} disabled={busy} onClick={() => setPreview(file)}><Eye size={16} /></button>
            <button type="button" className="btn-ghost" aria-label={`Download ${file.name}`} disabled={busy} onClick={() => void download(file)}><Download size={16} /></button>
            <button type="button" className="btn-ghost text-danger" aria-label={`Delete ${file.name}`} disabled={busy} onClick={() => void run(async () => {
              if (!await confirm({title: "Delete document?", message: `Delete ${file.name} from your saved files?`, confirmLabel: "Delete", danger: true})) return;
              await remove(file);
              toast.success("Document deleted.");
            })}><Trash2 size={16} /></button>
          </div>
        </li>)}
      </ul>}
    <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name || "Document"} size="xl">
      {preview && <>
        <button type="button" className="btn-ghost mb-3" disabled={busy} onClick={() => void download(preview)}><Download size={16} /> Download</button>
        <div className="h-[65dvh] min-h-48 overflow-auto bg-muted rounded-xl">
          {preview.mime === "application/pdf" ? <Suspense fallback={<p role="status" className="p-4">Loading preview…</p>}><PdfCanvas file={preview} /></Suspense>
            : <DocumentImage key={preview.id} file={preview} />}
        </div>
      </>}
    </Modal>
  </div>;
}

function DocumentImage({file}: {file: SavedFile}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    fileObjectUrl(file).then(value => {
      if (!active) { if (value) URL.revokeObjectURL(value); return; }
      objectUrl = value;
      if (value) setUrl(value); else setError("This document is unavailable.");
    }).catch(cause => { if (active) setError(errMsg(cause)); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file]);
  return error ? <p role="alert" className="p-4 text-danger">{error}</p>
    : url ? <img src={url} alt={file.name} className="mx-auto max-w-full" onError={() => setError("Could not preview this image. Download it to open the original.")} />
    : <p role="status" className="p-4">Loading preview…</p>;
}
