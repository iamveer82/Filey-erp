import { useRef, useState } from "react";
import { Download, FileText, Image, Paperclip, X } from "lucide-react";
import {
  TEAM_ATTACHMENT_ACCEPT,
  readTeamAttachment,
  validateTeamAttachments,
  type TeamAttachment,
} from "../lib/teamAttachments";
import { saveMediaFile } from "../lib/mediaDownload";
import { useUI } from "../lib/ui";

const sizeLabel = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function TeamAttachmentPicker({
  files,
  onChange,
  label,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  label: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { toast } = useUI();
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          multiple
          accept={TEAM_ATTACHMENT_ACCEPT}
          className="sr-only"
          aria-label={label}
          onChange={(event) => {
            const next = [...files, ...Array.from(event.target.files || [])];
            event.target.value = "";
            try {
              validateTeamAttachments(next);
              onChange(next);
            } catch (e) {
              toast.error(
                e instanceof Error ? e.message : "Could not attach these files."
              );
            }
          }}
        />
        <button
          type="button"
          className="btn-ghost"
          onClick={() => input.current?.click()}
          aria-label={label}
        >
          <Paperclip size={15} /> Attach files
        </button>
        <span className="text-xs text-muted-foreground">
          Images and documents · 10 MB each · up to 5
        </span>
      </div>
      {!!files.length && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Files to send">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex max-w-full items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs"
            >
              {file.type.startsWith("image/") ? (
                <Image size={16} className="shrink-0" />
              ) : (
                <FileText size={16} className="shrink-0" />
              )}
              <span className="min-w-0">
                <span className="block truncate font-medium">{file.name}</span>
                <span className="text-muted-foreground">{sizeLabel(file.size)}</span>
              </span>
              <button
                type="button"
                className="btn-ghost h-8 w-8 shrink-0 p-0"
                aria-label={`Remove attachment ${file.name}`}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Fetch on demand: opening a channel does not download every shared file. */
export function TeamMessageAttachment({ attachment }: { attachment: TeamAttachment }) {
  const [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(""),
    [error, setError] = useState("");
  const { toast } = useUI();
  const image = attachment.mime.startsWith("image/");
  const open = async (download: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const blob = await readTeamAttachment(attachment);
      if (download || !image) await saveMediaFile(blob, attachment.name);
      else {
        // Data URLs live only with this row; no persistent cache or expiring public URL.
        const reader = new FileReader();
        const url = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Could not preview this image."));
          reader.readAsDataURL(new Blob([blob], { type: attachment.mime }));
        });
        setPreview(url);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not open this file.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 max-w-sm rounded-xl border border-border bg-background p-2">
      <div className="flex min-w-0 items-center gap-2">
        <button
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left hover:bg-muted"
          disabled={busy}
          onClick={() => void open(false)}
          aria-label={`${image ? "Preview" : "Download"} ${attachment.name}`}
        >
          {image ? (
            <Image size={20} className="shrink-0 text-muted-foreground" />
          ) : (
            <FileText size={20} className="shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{attachment.name}</span>
            <span className="block text-xs text-muted-foreground">
              {busy
                ? "Opening…"
                : `${sizeLabel(attachment.size)} · ${image ? "Preview image" : "Download"}`}
            </span>
          </span>
        </button>
        {image && (
          <button
            className="btn-ghost h-10 w-10 shrink-0 p-0"
            disabled={busy}
            aria-label={`Download ${attachment.name}`}
            onClick={() => void open(true)}
          >
            <Download size={15} />
          </button>
        )}
      </div>
      {preview && (
        <div className="relative mt-2">
          <img
            src={preview}
            alt={attachment.name}
            className="max-h-72 w-full rounded-lg object-contain"
          />
          <button
            className="btn-ghost absolute right-1 top-1 h-8 w-8 bg-background p-0"
            aria-label={`Close preview ${attachment.name}`}
            onClick={() => setPreview("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="p-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
