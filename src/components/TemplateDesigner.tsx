import { useState, useRef, useEffect } from "react";
import {
  Save,
  X,
  PaintBucket,
  Type,
  Layout,
  Eye,
  Plus,
  Upload,
  FileImage,
  Image,
  FileText,
  Pencil,
  GripHorizontal,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { cn } from "../lib/format";
import { tools } from "../lib/api";
import {
  LetterheadConfig,
  loadLetterhead,
  saveLetterhead,
  EMPTY_LETTERHEAD,
  type LetterheadInfo,
} from "./Letterhead";

export interface CustomTemplate {
  id: string;
  name: string;
  /** "builder" = designed via our UI; "file" = uploaded image/PDF */
  type: "builder" | "file";
  accent: string;
  font: string;
  layout: "minimal" | "classic" | "modern";
  showLogo: boolean;
  showSeller: boolean;
  showCustomer: boolean;
  showNotes: boolean;
  showTerms: boolean;
  showTax: boolean;
  paperSize: "A4" | "Letter";
  /** Only for type="file" — base64-encoded file data */
  fileData?: string;
  /** "image" (png/jpg/webp) or "pdf" */
  fileType?: "image" | "pdf";
  /** Drag-positioned sections for file templates — % of canvas width/height */
  positions?: Record<string, { x: number; y: number }>;
}

/** Sections the user can drag around on a file template */
export const DRAGGABLE_SECTIONS = [
  { key: "seller", label: "Company Info", w: 180, h: 72 },
  { key: "header", label: "Document Header", w: 160, h: 64 },
  { key: "customer", label: "Customer Info", w: 170, h: 64 },
  { key: "items", label: "Items Table", w: 340, h: 120 },
  { key: "totals", label: "Totals", w: 150, h: 70 },
  { key: "footer", label: "Notes / Terms", w: 280, h: 40 },
];

function defaultPositions(): Record<string, { x: number; y: number }> {
  return {
    seller: { x: 6, y: 6 },
    header: { x: 68, y: 5 },
    customer: { x: 6, y: 22 },
    items: { x: 6, y: 38 },
    totals: { x: 70, y: 38 },
    footer: { x: 6, y: 88 },
  };
}

const FONTS = [
  {
    label: "Plus Jakarta Sans (Default)",
    value: "'Plus Jakarta Sans', system-ui, sans-serif",
  },
  { label: "Lora (Serif)", value: "'Lora', Georgia, serif" },
  { label: "IBM Plex Mono", value: "'IBM Plex Mono', monospace" },
];

const STORAGE_KEY = "filey.customTemplates";
/** Key under which the full template list is mirrored to Supabase
 * (app_settings) so it follows the user across devices. */
const SETTING_KEY = "custom_templates";

export function loadCustomTemplates(): CustomTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn("Failed to parse custom templates from localStorage:", e);
    return [];
  }
}

function saveCustomTemplates(templates: CustomTemplate[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  // Write-through to Supabase so templates created on one device appear
  // on every device the user logs in from. Fire-and-forget: offline writes
  // simply stay local until the next successful save.
  void tools.setSetting(SETTING_KEY, JSON.stringify(templates)).catch((e) => console.warn("Failed to sync custom templates to server", e));
}

/** Pull the user's templates saved on other devices into local storage.
 * Remote (Supabase) is treated as the source of truth when present so that
 * deletions propagate correctly; on first run any local-only templates are
 * pushed up. Falls back to the local list when offline / not configured.
 * Call on mount in pages that render the template picker. */
export async function syncCustomTemplates(): Promise<CustomTemplate[]> {
  try {
    const settings = await tools.settings();
    const row = settings.find((s) => s.key === SETTING_KEY);
    if (row?.value) {
      const remote: CustomTemplate[] = JSON.parse(row.value);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
      return remote;
    }
    // No remote record yet — seed it from whatever is local.
    const local = loadCustomTemplates();
    if (local.length) {
      void tools.setSetting(SETTING_KEY, JSON.stringify(local)).catch((e) => console.warn("Failed to sync custom templates to server", e));
    }
    return local;
  } catch (e) {
    console.warn("Failed to sync custom templates:", e);
    return loadCustomTemplates();
  }
}

/** Remove a custom template by id; returns the updated list so callers
 * can sync their local state without a re-read. */
export function deleteCustomTemplate(id: string): CustomTemplate[] {
  const next = loadCustomTemplates().filter((t) => t.id !== id);
  saveCustomTemplates(next);
  return next;
}

function blankTemplate(): CustomTemplate {
  return {
    id: `custom-${Date.now()}`,
    name: "",
    type: "builder",
    accent: "#222222",
    font: "'Plus Jakarta Sans', system-ui, sans-serif",
    layout: "minimal",
    showLogo: true,
    showSeller: true,
    showCustomer: true,
    showNotes: true,
    showTerms: true,
    showTax: true,
    paperSize: "A4",
  };
}

export default function TemplateDesigner({
  onSave,
  onClose,
}: {
  onSave: (t: CustomTemplate) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"design" | "upload" | "letterhead">("design");
  const [step, setStep] = useState<"upload" | "position">("upload"); // for file flow
  const [tpl, setTpl] = useState<CustomTemplate>(blankTemplate());
  const [saved, setSaved] = useState(false);
  const [lh, setLh] = useState<LetterheadInfo>(EMPTY_LETTERHEAD);
  const [lhSaved, setLhSaved] = useState(false);
  useEffect(() => {
    loadLetterhead()
      .then(setLh)
      .catch((e) => console.warn("Failed to load letterhead", e));
  }, []);
  const handleSaveLetterhead = async () => {
    try {
      await saveLetterhead(lh);
      setLhSaved(true);
      setTimeout(() => onClose(), 700);
    } catch (e) {
      /* offline writes stay local until the next sync */
      console.warn("Failed to save letterhead:", e);
    }
  };
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string>("");
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Position state
  const [positions, setPositions] =
    useState<Record<string, { x: number; y: number }>>(defaultPositions);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  const set = (key: keyof CustomTemplate, value: any) =>
    setTpl((prev) => ({ ...prev, [key]: value }));

  const handleSaveBuilder = () => {
    if (!tpl.name.trim()) return;
    const templates = loadCustomTemplates();
    templates.push({ ...tpl, type: "builder" as const });
    saveCustomTemplates(templates);
    setSaved(true);
    onSave(tpl);
    setTimeout(() => onClose(), 600);
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setFileName(f.name.replace(/\.[^.]+$/, ""));
    const reader = new FileReader();
    reader.onload = () => setFilePreview(reader.result as string);
    reader.readAsDataURL(f);
  };

  const goToPosition = () => {
    if (!filePreview || !fileName.trim()) return;
    setStep("position");
  };

  // --- Drag handlers ---
  const onDragStart = (key: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    dragOffset.current = {
      x: px - positions[key].x,
      y: py - positions[key].y,
    };
    setDragging(key);
  };

  const onDragMove = (e: React.MouseEvent) => {
    if (!dragging || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    setPositions((prev) => ({
      ...prev,
      [dragging]: {
        x: Math.max(0, Math.min(100, px - dragOffset.current.x)),
        y: Math.max(0, Math.min(100, py - dragOffset.current.y)),
      },
    }));
  };

  const onDragEnd = () => setDragging(null);

  const handleSaveFile = () => {
    if (!filePreview || !fileName.trim()) return;
    const isImage = file?.type?.startsWith("image/");
    const template: CustomTemplate = {
      id: `custom-${Date.now()}`,
      name: fileName.trim(),
      type: "file",
      fileData: filePreview,
      fileType: isImage ? "image" : "pdf",
      positions: { ...positions },
      accent: tpl.accent,
      font: tpl.font,
      layout: "minimal",
      showLogo: true,
      showSeller: true,
      showCustomer: true,
      showNotes: true,
      showTerms: true,
      showTax: true,
      paperSize: tpl.paperSize,
    };
    const templates = loadCustomTemplates();
    templates.push(template);
    saveCustomTemplates(templates);
    setSaved(true);
    onSave(template);
    setTimeout(() => onClose(), 600);
  };

  const paperW = tpl.paperSize === "Letter" ? 816 : 794;
  const paperH = tpl.paperSize === "Letter" ? 1056 : 1122;
  const previewScale = 0.35; // scale down for sidebar display

  return (
    <div className="card !p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-display font-medium text-ink">Create Template</p>
          <p className="text-xs text-brand-400 mt-0.5">
            {step === "position"
              ? "Drag boxes to position them"
              : "Design your own document layout"}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-xl p-1.5 text-brand-400 hover:bg-brand-50 hover:text-ink cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>

      {saved ? (
        <div className="text-center py-8">
          <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 grid place-items-center mx-auto mb-3">
            <Save size={24} />
          </div>
          <p className="font-medium text-ink">Template saved!</p>
          <p className="text-sm text-brand-400 mt-1">
            "{fileName || tpl.name}" is ready to use
          </p>
        </div>
      ) : step === "position" ? (
        <>
          {/* Back button */}
          <button
            onClick={() => setStep("upload")}
            className="text-xs text-brand-500 hover:text-ink flex items-center gap-1 cursor-pointer"
          >
            <ChevronLeft size={14} /> Back to upload
          </button>

          {/* Canvas */}
          <div
            ref={canvasRef}
            onMouseMove={onDragMove}
            onMouseUp={onDragEnd}
            onMouseLeave={onDragEnd}
            className="relative rounded-xl border-2 border-dashed border-brand-200 bg-brand-50 overflow-hidden select-none cursor-crosshair mx-auto"
            style={{
              width: paperW * previewScale,
              height: paperH * previewScale,
            }}
          >
            {/* Background image */}
            {filePreview && file?.type?.startsWith("image/") && (
              <img
                src={filePreview}
                alt=""
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                style={{ opacity: 0.7 }}
              />
            )}

            {/* Grid lines */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ opacity: 0.15 }}
            >
              {Array.from({ length: 9 }).map((_, i) => (
                <line
                  key={`h${i}`}
                  x1="0"
                  y1={`${(i + 1) * 10}%`}
                  x2="100%"
                  y2={`${(i + 1) * 10}%`}
                  stroke="#94a3b8"
                  strokeWidth="0.5"
                />
              ))}
              {Array.from({ length: 9 }).map((_, i) => (
                <line
                  key={`v${i}`}
                  x1={`${(i + 1) * 10}%`}
                  y1="0"
                  x2={`${(i + 1) * 10}%`}
                  y2="100%"
                  stroke="#94a3b8"
                  strokeWidth="0.5"
                />
              ))}
            </svg>

            {/* Draggable boxes */}
            {DRAGGABLE_SECTIONS.map((sec) => {
              const pos = positions[sec.key];
              if (!pos) return null;
              const isActive = dragging === sec.key;
              return (
                <div
                  key={sec.key}
                  onMouseDown={onDragStart(sec.key)}
                  className={cn(
                    "absolute rounded-lg border-2 bg-white/80 px-2 py-1.5 flex items-center gap-1 cursor-grab active:cursor-grabbing transition-shadow select-none",
                    isActive
                      ? "border-primary-400 shadow-lg shadow-primary-200/40 z-20 scale-105"
                      : "border-brand-200 hover:border-primary-300 hover: z-10"
                  )}
                  style={{
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    width: `${(sec.w / paperW) * 100}%`,
                    maxWidth: "95%",
                  }}
                >
                  <GripHorizontal size={10} className="text-brand-300 shrink-0" />
                  <span className="text-[9px] font-medium text-brand-600 truncate">
                    {sec.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Accent colour picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-brand-500 flex items-center gap-1">
              <PaintBucket size={13} /> Accent Color
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={tpl.accent}
                onChange={(e) => set("accent", e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-xl border border-brand-200 bg-transparent"
              />
              <input
                className="input h-9 flex-1 font-mono text-xs"
                value={tpl.accent}
                onChange={(e) => set("accent", e.target.value)}
              />
            </div>
          </div>

          <p className="text-[10px] text-brand-400 text-center -mt-1">
            Drag each box to where you want text to appear on the template
          </p>

          {/* Save */}
          <button
            onClick={handleSaveFile}
            className="btn-primary w-full h-10 flex items-center justify-center gap-2"
          >
            <Save size={16} />
            Save Template
          </button>
        </>
      ) : (
        <>
          {/* Tab Switcher */}
          <div className="flex rounded-xl bg-brand-50 p-1 gap-1">
            <button
              onClick={() => {
                setTab("design");
                setStep("upload");
              }}
              className={cn(
                "flex-1 rounded-lg py-2 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all",
                tab === "design"
                  ? "bg-white text-ink "
                  : "text-brand-400 hover:text-brand-600"
              )}
            >
              <Pencil size={13} /> Design
            </button>
            <button
              onClick={() => {
                setTab("upload");
                setStep("upload");
              }}
              className={cn(
                "flex-1 rounded-lg py-2 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all",
                tab === "upload"
                  ? "bg-white text-ink "
                  : "text-brand-400 hover:text-brand-600"
              )}
            >
              <Upload size={13} /> Upload
            </button>
            <button
              onClick={() => {
                setTab("letterhead");
                setStep("upload");
              }}
              className={cn(
                "flex-1 rounded-lg py-2 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all",
                tab === "letterhead"
                  ? "bg-white text-ink "
                  : "text-brand-400 hover:text-brand-600"
              )}
            >
              <FileText size={13} /> Letterhead
            </button>
          </div>

          {tab === "design" ? (
            <>
              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-brand-500 flex items-center gap-1">
                  <Type size={13} /> Template Name
                </label>
                <input
                  className="input h-9"
                  placeholder="My Custom Template"
                  value={tpl.name}
                  onChange={(e) => set("name", e.target.value)}
                  autoFocus
                />
              </div>

              {/* Accent Color */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-brand-500 flex items-center gap-1">
                  <PaintBucket size={13} /> Accent Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={tpl.accent}
                    onChange={(e) => set("accent", e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-xl border border-brand-200 bg-transparent"
                  />
                  <input
                    className="input h-9 flex-1 font-mono text-xs"
                    value={tpl.accent}
                    onChange={(e) => set("accent", e.target.value)}
                  />
                </div>
              </div>

              {/* Font */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-brand-500 flex items-center gap-1">
                  <Type size={13} /> Font Family
                </label>
                <select
                  className="select h-9"
                  value={tpl.font}
                  onChange={(e) => set("font", e.target.value)}
                >
                  {FONTS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Layout */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-brand-500 flex items-center gap-1">
                  <Layout size={13} /> Layout Style
                </label>
                <div className="flex gap-2">
                  {(["minimal", "classic", "modern"] as const).map((l) => (
                    <button
                      key={l}
                      onClick={() => set("layout", l)}
                      className={cn(
                        "flex-1 rounded-lg border px-3 py-2 text-xs font-semibold capitalize transition-all cursor-pointer",
                        tpl.layout === l
                          ? "border-primary-400 bg-primary-50 text-ink"
                          : "border-brand-200 text-brand-400 hover:border-brand-300"
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Section Toggles */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-brand-500 flex items-center gap-1 mb-2">
                  <Eye size={13} /> Visible Sections
                </label>
                <div className="space-y-1.5">
                  {(
                    [
                      ["showLogo", "Company Logo"],
                      ["showSeller", "Seller Details"],
                      ["showCustomer", "Customer Info"],
                      ["showNotes", "Notes"],
                      ["showTerms", "Terms & Conditions"],
                      ["showTax", "Tax Breakdown"],
                    ] as [keyof CustomTemplate, string][]
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center justify-between py-1.5 px-3 rounded-xl hover:bg-brand-50 cursor-pointer"
                    >
                      <span className="text-sm text-ink">{label}</span>
                      <button
                        onClick={() => set(key, !tpl[key])}
                        className={cn(
                          "w-9 h-5 rounded-full relative transition-colors cursor-pointer",
                          tpl[key] ? "bg-primary-400" : "bg-brand-200"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                            tpl[key] ? "left-4" : "left-0.5"
                          )}
                        />
                      </button>
                    </label>
                  ))}
                </div>
              </div>

              {/* Mini Preview */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-brand-500">Preview</label>
                <div
                  className="rounded-xl border border-brand-200 p-4 space-y-2 overflow-hidden"
                  style={{ fontFamily: tpl.font }}
                >
                  <div
                    className="h-1.5 rounded w-24"
                    style={{ background: tpl.accent }}
                  />
                  {tpl.showLogo && <div className="w-10 h-10 rounded bg-brand-100" />}
                  {tpl.showSeller && (
                    <div className="space-y-1">
                      <div className="h-2 rounded bg-brand-200 w-32" />
                      <div className="h-1.5 rounded bg-brand-100 w-48" />
                    </div>
                  )}
                  {tpl.showCustomer && (
                    <div className="space-y-1 mt-2 pt-2 border-t border-brand-100">
                      <div className="h-1.5 rounded bg-brand-200 w-20" />
                      <div className="h-2 rounded bg-brand-300 w-36" />
                    </div>
                  )}
                  <div className="space-y-1 pt-2 border-t border-brand-100">
                    <div className="flex justify-between">
                      <div className="h-1.5 rounded bg-brand-100 w-16" />
                      <div className="h-1.5 rounded bg-brand-100 w-12" />
                    </div>
                    <div className="flex justify-between">
                      <div className="h-1.5 rounded bg-brand-100 w-20" />
                      <div className="h-1.5 rounded bg-brand-100 w-14" />
                    </div>
                  </div>
                  {tpl.showTax && (
                    <div className="flex justify-between pt-1 border-t border-brand-100">
                      <div className="h-2 rounded bg-brand-200 w-12" />
                      <div
                        className="h-2 rounded w-16"
                        style={{ background: tpl.accent }}
                      />
                    </div>
                  )}
                  {tpl.showNotes && (
                    <div className="h-1 rounded bg-brand-100 w-full mt-2" />
                  )}
                </div>
              </div>

              <button
                onClick={handleSaveBuilder}
                disabled={!tpl.name.trim()}
                className="btn-primary w-full h-10 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={16} /> Create Template
              </button>
            </>
          ) : tab === "upload" ? (
            <>
              {/* Upload Tab */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-brand-500 flex items-center gap-1">
                  <FileImage size={13} /> Template Name
                </label>
                <input
                  className="input h-9"
                  placeholder="My Uploaded Template"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  autoFocus
                />
              </div>

              {/* Upload Area */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-brand-500 flex items-center gap-1">
                  <Upload size={13} /> Upload Image or PDF
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={handleFilePick}
                />
                {filePreview ? (
                  <div className="space-y-2">
                    <div className="relative rounded-xl border-2 border-dashed border-primary-300 bg-primary-50/30 p-3 overflow-hidden">
                      {file?.type?.startsWith("image/") ? (
                        <img
                          src={filePreview}
                          alt="Template preview"
                          className="w-full max-h-48 object-contain rounded-xl"
                        />
                      ) : (
                        <div className="flex items-center justify-center gap-3 py-10 text-brand-400">
                          <FileText size={48} />
                          <div className="text-left">
                            <p className="font-medium text-sm text-ink">{file?.name}</p>
                            <p className="text-xs">PDF — first page used as background</p>
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => {
                          setFile(null);
                          setFilePreview("");
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/80 text-brand-500 grid place-items-center hover:bg-white cursor-pointer"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full rounded-xl border-2 border-dashed border-brand-200 hover:border-primary-400 hover:bg-primary-50/30 py-10 flex flex-col items-center gap-2 cursor-pointer transition-all group"
                  >
                    <div className="w-12 h-12 rounded-full bg-brand-50 group-hover:bg-primary-100 grid place-items-center transition-colors">
                      <Image
                        size={24}
                        className="text-brand-400 group-hover:text-primary-600"
                      />
                    </div>
                    <p className="text-sm font-medium text-brand-500 group-hover:text-ink">
                      Click to upload
                    </p>
                    <p className="text-xs text-brand-400">PNG, JPG, WebP, or PDF</p>
                  </button>
                )}
              </div>

              {/* Paper Size */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-brand-500 flex items-center gap-1">
                  <Layout size={13} /> Paper Size
                </label>
                <div className="flex gap-2">
                  {(["A4", "Letter"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => set("paperSize", s)}
                      className={cn(
                        "flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-all cursor-pointer",
                        tpl.paperSize === s
                          ? "border-primary-400 bg-primary-50 text-ink"
                          : "border-brand-200 text-brand-400 hover:border-brand-300"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Next button */}
              <button
                onClick={goToPosition}
                disabled={!filePreview || !fileName.trim()}
                className="btn-primary w-full h-10 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next: Position Elements <ChevronRight size={14} />
              </button>
            </>
          ) : (
            <>
              {/* Letterhead Tab */}
              {lhSaved ? (
                <div className="text-center py-8">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 grid place-items-center mx-auto mb-3">
                    <Save size={24} />
                  </div>
                  <p className="font-medium text-ink">Letterhead saved!</p>
                  <p className="text-sm text-brand-400 mt-1">
                    Toggle “Use letterhead” on any document to apply it.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-brand-400 -mt-1">
                    Upload a header strip (logos) and a footer strip (contact band). They
                    print across the top and bottom of every document where you enable
                    “Use letterhead”. Saved to your account and shared across devices.
                  </p>
                  <LetterheadConfig value={lh} onChange={setLh} />
                  <button
                    onClick={handleSaveLetterhead}
                    className="btn-primary w-full h-10 flex items-center justify-center gap-2"
                  >
                    <Save size={16} /> Save Letterhead
                  </button>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
