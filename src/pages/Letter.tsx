import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  GripVertical,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { billing, type CompanyProfile } from "../lib/api";
import {
  AGENT_STORAGE_EVENT,
  agentStorageScope,
  requireAgentStorageScope,
} from "../lib/agentStorage";
import { errMsg, fmtDate, todayYmd } from "../lib/format";
import { loadDocFormats, type DocFormats } from "../lib/numberFormat";
import { allocateDocumentNumber } from "../lib/documentNumbers";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { safeName } from "../lib/files";
import { downloadFile } from "../lib/pdfTools";
import { reactToPdfBytes } from "../lib/reactPdf";
import {
  blankLetterForm,
  deleteLetter,
  letterDisplayForm,
  loadLetters,
  saveLetter,
  validateLetterForm,
  type LetterBlock,
  type LetterForm,
  type LetterRecord,
  type LetterTextStyle,
} from "../lib/letters";
import {
  Badge,
  Card,
  DataTable,
  ErrorBanner,
  Field,
  FilterChip,
  Modal,
  PageHeader,
  SearchInput,
  Switch,
} from "../components/ui";
import { DateField } from "../components/DatePicker";
import { SelectMenu } from "../components/ui-menu";
import { RowActions } from "../components/RowActions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/Tabs";
import { ResizablePanels } from "../components/ResizablePanels";
import FitPreview from "../components/FitPreview";
import {
  EMPTY_STAMP_SIG,
  loadCompanyStampSig,
  type CompanyStampSig,
} from "../components/StampSignatureSettings";
import {
  EMPTY_LETTERHEAD,
  hasLetterhead,
  loadLetterhead,
  type LetterheadInfo,
} from "../components/Letterhead";
import LetterDocument, {
  LETTER_TEMPLATES,
  useLetterPages,
} from "../components/LetterDocument";
import { LetterFormatToolbar } from "../components/LetterFormatToolbar";

const filename = (form: LetterForm) =>
  safeName(form.number || "letter")
    .replace(/\.+$/, "")
    .slice(0, 100) || "letter";
const BLOCKS = [
  { value: "", label: "Add block…" },
  { value: "text", label: "Text / paragraph" },
  { value: "field", label: "Custom field" },
  { value: "date", label: "Date field" },
  { value: "signature", label: "Signature" },
  { value: "stamp", label: "Company stamp" },
];

export default function Letter() {
  const { toast, confirm } = useUI();
  const [records, setRecords] = useState<LetterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [marks, setMarks] = useState<CompanyStampSig>(EMPTY_STAMP_SIG);
  const [letterhead, setLetterhead] = useState<LetterheadInfo>(EMPTY_LETTERHEAD);
  const [formats, setFormats] = useState<DocFormats>({});
  const [lookupsLoading, setLookupsLoading] = useState(true);
  const [lookupError, setLookupError] = useState("");
  const lookupRequest = useRef(0);
  const [form, setForm] = useState<LetterForm | null>(null);
  const [editing, setEditing] = useState<LetterRecord | null>(null);
  const [preview, setPreview] = useState<LetterForm | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const operation = useRef<object | null>(null);
  const baseline = useRef("");
  const editorScope = useRef<string | null>(null);
  const workspaceScope = useRef(agentStorageScope());

  const refresh = useCallback(async () => {
    const scope = agentStorageScope();
    try {
      const rows = await loadLetters();
      if (scope === agentStorageScope()) {
        setRecords(rows);
        setError("");
      }
    } catch (failure) {
      if (scope === agentStorageScope()) setError(errMsg(failure));
    } finally {
      if (scope === agentStorageScope()) setLoading(false);
    }
  }, []);
  const loadCompany = useCallback(async () => {
    const scope = agentStorageScope(),
      request = ++lookupRequest.current;
    setLookupsLoading(true);
    const results = await Promise.allSettled([
      billing.getCompany(),
      loadCompanyStampSig(),
      loadLetterhead(),
      loadDocFormats(),
    ]);
    if (scope !== agentStorageScope() || request !== lookupRequest.current) return;
    const [profile, assets, head, numbers] = results;
    if (profile.status === "fulfilled") setCompany(profile.value);
    if (assets.status === "fulfilled") setMarks(assets.value);
    if (head.status === "fulfilled") setLetterhead(head.value);
    if (numbers.status === "fulfilled") setFormats(numbers.value);
    setLookupError(
      results.some((result) => result.status === "rejected")
        ? "Some company details could not be loaded. Retry or enter them in the letter."
        : ""
    );
    setLookupsLoading(false);
  }, []);
  useEffect(() => {
    void refresh();
    void loadCompany();
  }, [refresh, loadCompany]);
  useLiveSync(() => {
    void refresh();
  }, ["app_settings"]);
  useEffect(() => {
    const changed = () => {
      const scope = agentStorageScope();
      if (scope === workspaceScope.current) return;
      workspaceScope.current = scope;
      operation.current = null;
      setBusy(false);
      setForm(null);
      setEditing(null);
      setPreview(null);
      setRecords([]);
      setCompany(null);
      setMarks(EMPTY_STAMP_SIG);
      setLetterhead(EMPTY_LETTERHEAD);
      setFormats({});
      setLoading(true);
      void refresh();
      void loadCompany();
    };
    window.addEventListener(AGENT_STORAGE_EVENT, changed);
    window.addEventListener("filey:workspace-changed", changed);
    window.addEventListener("storage", changed);
    return () => {
      window.removeEventListener(AGENT_STORAGE_EVENT, changed);
      window.removeEventListener("filey:workspace-changed", changed);
      window.removeEventListener("storage", changed);
    };
  }, [refresh, loadCompany]);
  const dirty = !!form && JSON.stringify(form) !== baseline.current;
  const renderScope = workspaceScope.current;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const open = (next: LetterForm, record: LetterRecord | null = null) => {
    if (renderScope !== agentStorageScope()) return;
    editorScope.current = agentStorageScope();
    baseline.current = JSON.stringify(next);
    setEditing(record);
    setForm(next);
  };
  const showPreview = (document: LetterForm) => {
    if (renderScope === agentStorageScope()) setPreview(document);
  };
  const nextNumber = () =>
    allocateDocumentNumber(
      "letter",
      records.map((record) => record.form.number),
      formats
    );
  const create = () => run(async () => {
    const blank = blankLetterForm(await nextNumber());
    open({
      ...blank,
      company_name: company?.name || "",
      company_address: company?.address || "",
      company_trn: company?.trn || "",
      company_phone: company?.phone || "",
      company_email: company?.email || "",
      company_logo: company?.logo || "",
      show_logo: !!company?.logo,
      use_letterhead: hasLetterhead(letterhead),
      show_company_header: !hasLetterhead(letterhead),
      letterhead: { ...letterhead },
      stamp: marks.stamp && { ...marks.stamp, opacity: 100 },
      signature: marks.signature && { ...marks.signature, opacity: 100 },
    });
  });
  const duplicate = (record: LetterRecord) => run(async () => {
    const source = structuredClone(letterDisplayForm(record));
    open({
      ...source,
      number: await nextNumber(),
      issue_date: todayYmd(),
      status: "draft",
      blocks: source.blocks.map((block) => ({ ...block, id: crypto.randomUUID() })),
    });
  });
  const run = async (action: () => Promise<void>) => {
    if (operation.current) return;
    const token = {},
      scope = renderScope;
    operation.current = token;
    setBusy(true);
    try {
      requireAgentStorageScope(scope ?? "signed-out");
      await action();
    } catch (failure) {
      if (scope === agentStorageScope()) toast.error(errMsg(failure));
    } finally {
      if (operation.current === token) {
        operation.current = null;
        setBusy(false);
      }
    }
  };
  const persist = (issued: boolean) =>
    run(async () => {
      if (!form) return;
      const scope = editorScope.current;
      requireAgentStorageScope(scope ?? "signed-out");
      const next = { ...form, status: issued ? ("issued" as const) : ("draft" as const) };
      validateLetterForm(next);
      if (
        issued &&
        !(await confirm({
          title: "Issue this letter?",
          message:
            "The current content, layout and company details will be kept with this issued letter. To change it later, create a duplicate draft.",
          confirmLabel: "Issue letter",
        }))
      )
        return;
      requireAgentStorageScope(scope ?? "signed-out");
      const saved = await saveLetter(
        next,
        editing?.id,
        editing?.revision,
        editing?.updated_at
      );
      requireAgentStorageScope(scope ?? "signed-out");
      const displayed = letterDisplayForm(saved);
      baseline.current = JSON.stringify(displayed);
      setForm(displayed);
      setEditing(saved);
      await refresh();
      requireAgentStorageScope(scope ?? "signed-out");
      toast.success(issued ? "Letter issued." : "Draft saved.");
    });
  const download = (document: LetterForm) =>
    run(async () => {
      const scope = renderScope;
      requireAgentStorageScope(scope ?? "signed-out");
      validateLetterForm(document);
      const pdf = await reactToPdfBytes(
        <LetterDocument form={document} />,
        filename(document)
      );
      requireAgentStorageScope(scope ?? "signed-out");
      await downloadFile(pdf);
    });
  const back = async () => {
    if (renderScope !== agentStorageScope()) return;
    if (
      dirty &&
      !(await confirm({
        title: "Discard changes?",
        message: "This letter has unsaved changes.",
        confirmLabel: "Discard changes",
        danger: true,
      }))
    )
      return;
    if (renderScope !== agentStorageScope()) return;
    setForm(null);
    setEditing(null);
    void refresh();
  };
  const remove = (record: LetterRecord) =>
    run(async () => {
      const scope = agentStorageScope();
      if (
        !(await confirm({
          title: "Delete letter",
          message: `Delete ${record.form.number}? This removes its saved record.`,
          confirmLabel: "Delete",
          danger: true,
        }))
      )
        return;
      requireAgentStorageScope(scope ?? "signed-out");
      await deleteLetter(record.id, record.revision, record.updated_at);
      requireAgentStorageScope(scope ?? "signed-out");
      await refresh();
      toast.success("Letter deleted.");
    });
  const query = search.trim().toLocaleLowerCase();
  const filtered = records.filter(
    (record) =>
      (filter === "all" || record.form.status === filter) &&
      (!query ||
        `${record.form.number} ${record.form.title} ${record.form.recipient_name}`
          .toLocaleLowerCase()
          .includes(query))
  );

  return (
    <>
      {form ? (
        <LetterEditor
          form={form}
          setForm={setForm}
          busy={busy}
          lookupError={lookupError}
          onRetry={() => {
            void loadCompany();
          }}
          onBack={() => {
            void back();
          }}
          onSave={() => {
            void persist(false);
          }}
          onIssue={() => {
            void persist(true);
          }}
          onPreview={() => showPreview(form)}
          onDownload={() => {
            void download(form);
          }}
          onDuplicate={editing ? () => duplicate(editing) : undefined}
        />
      ) : (
        <>
          <PageHeader
            title="Letter"
            subtitle="Create company letters and keep every issued document together."
            action={
              <button
                type="button"
                className="btn-primary"
                disabled={busy || loading || !!error || lookupsLoading}
                onClick={create}
              >
                <Plus size={16} /> New letter
              </button>
            }
          />
          {error && (
            <div className="mb-4">
              <ErrorBanner message={error} />
              <button
                type="button"
                className="btn-ghost mt-2"
                onClick={() => {
                  setLoading(true);
                  void refresh();
                }}
              >
                Retry
              </button>
            </div>
          )}
          <div className="mb-5 grid grid-cols-3 gap-3">
            {[
              ["All letters", records.length],
              [
                "Drafts",
                records.filter((record) => record.form.status === "draft").length,
              ],
              [
                "Issued",
                records.filter((record) => record.form.status === "issued").length,
              ],
            ].map(([label, count]) => (
              <Card key={label} className="!p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{count}</p>
              </Card>
            ))}
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search letters…"
            />
            {["all", "draft", "issued"].map((value) => (
              <FilterChip
                key={value}
                active={filter === value}
                onClick={() => setFilter(value)}
              >
                {value === "all" ? "All" : value === "draft" ? "Drafts" : "Issued"}
              </FilterChip>
            ))}
          </div>
          <DataTable<LetterRecord>
            rows={filtered}
            loading={loading}
            pageSize={10}
            empty={
              query || filter !== "all"
                ? "No letters match your filters."
                : "Create your first company letter."
            }
            onRowClick={(record) => showPreview(letterDisplayForm(record))}
            columns={[
              {
                key: "number",
                label: "Number",
                summary: true,
                sortValue: (record) => record.form.number,
                render: (record) => (
                  <span className="font-mono text-xs">{record.form.number}</span>
                ),
              },
              {
                key: "title",
                label: "Letter",
                summary: true,
                sortValue: (record) => record.form.title,
                render: (record) => (
                  <span className="block max-w-64 truncate" title={record.form.title}>
                    {record.form.title || "Untitled draft"}
                  </span>
                ),
              },
              {
                key: "recipient",
                label: "Recipient",
                sortValue: (record) => record.form.recipient_name,
                render: (record) => record.form.recipient_name || "—",
              },
              {
                key: "date",
                label: "Date",
                sortValue: (record) => record.form.issue_date,
                render: (record) => fmtDate(record.form.issue_date),
              },
              {
                key: "status",
                label: "Status",
                summary: true,
                render: (record) => (
                  <Badge tone={record.form.status === "issued" ? "success" : "neutral"}>
                    {record.form.status === "issued" ? "Issued" : "Draft"}
                  </Badge>
                ),
              },
              {
                key: "actions",
                label: "Actions",
                actions: true,
                render: (record) => (
                  <div
                    className={`flex justify-end gap-1 ${busy ? "pointer-events-none opacity-50" : ""}`}
                  >
                    <RowActions
                      onView={() =>
                        open(structuredClone(letterDisplayForm(record)), record)
                      }
                      onEdit={
                        record.form.status === "draft"
                          ? () => open(structuredClone(record.form), record)
                          : undefined
                      }
                      onCopy={() => duplicate(record)}
                      onDelete={() => {
                        void remove(record);
                      }}
                    />
                    <button
                      type="button"
                      className="btn-ghost h-10 w-10 p-0"
                      aria-label={`Download ${record.form.number} PDF`}
                      disabled={busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        void download(letterDisplayForm(record));
                      }}
                    >
                      <Download size={15} />
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </>
      )}
      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={
          preview
            ? `${preview.number} · ${preview.title || "Letter preview"}`
            : "Letter preview"
        }
        size="document"
      >
        {preview && (
          <div className="mx-auto max-w-[900px]">
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => {
                  void download(preview);
                }}
              >
                <Download size={15} /> Download PDF
              </button>
            </div>
            <LetterPreview form={preview} />
          </div>
        )}
      </Modal>
    </>
  );
}

function LetterPreview({ form }: { form: LetterForm }) {
  const [page, setPage] = useState(0);
  const count = useLetterPages(form).length,
    current = Math.min(page, Math.max(0, count - 1));
  return (
    <div className="min-w-0">
      <FitPreview baseWidth={794} zoom={100} padding={0} zoomable>
        <LetterDocument form={form} pageIndex={current} />
      </FitPreview>
      <div
        className="mt-3 flex items-center justify-between gap-3"
        role="group"
        aria-label="Letter preview pages"
      >
        <button
          type="button"
          className="btn-ghost h-10 w-10 p-0"
          aria-label="Previous preview page"
          disabled={current === 0}
          onClick={() => setPage(current - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <output aria-live="polite" className="text-xs text-muted-foreground">
          Page {current + 1} of {count}
        </output>
        <button
          type="button"
          className="btn-ghost h-10 w-10 p-0"
          aria-label="Next preview page"
          disabled={current + 1 >= count}
          onClick={() => setPage(current + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function LetterEditor({
  form,
  setForm,
  busy,
  lookupError,
  onRetry,
  onBack,
  onSave,
  onIssue,
  onPreview,
  onDownload,
  onDuplicate,
}: {
  form: LetterForm;
  setForm: (form: LetterForm) => void;
  busy: boolean;
  lookupError: string;
  onRetry: () => void;
  onBack: () => void;
  onSave: () => void;
  onIssue: () => void;
  onPreview: () => void;
  onDownload: () => void;
  onDuplicate?: () => void;
}) {
  const issued = form.status === "issued",
    disabled = busy || issued;
  const [formatTarget, setFormatTarget] = useState("body");
  const formatBlock = form.blocks.find((block) => block.id === formatTarget);
  const target =
    formatTarget === "title"
      ? "title"
      : formatBlock &&
          (formatBlock.type === "text" ||
            formatBlock.type === "field" ||
            formatBlock.type === "date")
        ? formatTarget
        : "body";
  const legacyFont: LetterTextStyle["font"] =
    /Lora|Georgia|serif/i.test(form.font) && !/sans-serif/i.test(form.font)
      ? "classic"
      : /mono/i.test(form.font)
        ? "mono"
        : "modern";
  const formatValue: LetterTextStyle =
    target === "title"
      ? { font: legacyFont, fontSize: 17.25, bold: true, ...form.title_style }
      : {
          font: legacyFont,
          fontSize: 9.75,
          lineSpacing: 22 / 13,
          paragraphSpacing: 16,
          ...form.text_style,
          ...(target !== "body"
            ? {
                align:
                  formatBlock?.style?.align ??
                  form.text_style?.align ??
                  formatBlock?.align,
                ...formatBlock?.style,
              }
            : {}),
        };
  const formatOptions = [
    { value: "body", label: "All body text" },
    { value: "title", label: "Letter title" },
    ...form.blocks.flatMap((block, index) =>
      block.type === "signature" || block.type === "stamp"
        ? []
        : [
            {
              value: block.id,
              label: `${block.type === "text" ? "Paragraph" : block.type === "date" ? "Date" : "Field"} ${index + 1}`,
            },
          ]
    ),
  ];
  const changeFormat = (style: LetterTextStyle) => {
    if (target === "body") setForm({ ...form, text_style: style });
    else if (target === "title") setForm({ ...form, title_style: style });
    else {
      const patch = Object.fromEntries(
        Object.entries(style).filter(
          ([key, value]) => value !== formatValue[key as keyof LetterTextStyle]
        )
      ) as LetterTextStyle;
      setForm({
        ...form,
        blocks: form.blocks.map((block) =>
          block.id === target
            ? {
                ...block,
                style: { ...block.style, ...patch },
                align: patch.align || block.align,
              }
            : block
        ),
      });
    }
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const set = <K extends keyof LetterForm>(key: K, value: LetterForm[K]) =>
    setForm({ ...form, [key]: value });
  const input = (
    key:
      | "number"
      | "title"
      | "recipient_name"
      | "company_name"
      | "company_email"
      | "company_phone"
      | "company_trn"
      | "salutation"
      | "closing"
      | "signatory_name"
      | "signatory_title",
    label: string,
    max = 160
  ) => (
    <Field label={label} required={key === "number" || key === "title"}>
      <input
        className="input w-full"
        maxLength={max}
        value={form[key]}
        onFocus={key === "title" ? () => setFormatTarget("title") : undefined}
        onChange={(event) => set(key, event.target.value)}
      />
    </Field>
  );
  const add = (type: string) => {
    if (!type || form.blocks.length >= 100) return;
    const base = { id: crypto.randomUUID(), align: "left" as const };
    const block: LetterBlock =
      type === "text"
        ? { ...base, type, text: "" }
        : type === "date"
          ? { ...base, type, label: "Date", value: todayYmd() }
          : type === "signature" || type === "stamp"
            ? {
                ...base,
                type,
                label: type === "signature" ? "Authorized signature" : "Company stamp",
              }
            : { ...base, type: "field", label: "Field name", value: "" };
    setForm({
      ...form,
      blocks: [...form.blocks, block],
      ...(type === "signature" && form.signature?.data ? { show_signature: true } : {}),
      ...(type === "stamp" && form.stamp?.data ? { show_stamp: true } : {}),
    });
  };
  const move = (from: number, to: number) => {
    if (to >= 0 && to < form.blocks.length)
      set("blocks", arrayMove(form.blocks, from, to));
  };
  const starter = (type: string) => {
    if (!type) return;
    const field = (label: string): LetterBlock => ({
      id: crypto.randomUUID(),
      type: "field",
      label,
      value: "",
      align: "left",
    });
    const text = (value: string): LetterBlock => ({
      id: crypto.randomUUID(),
      type: "text",
      text: value,
      align: "left",
    });
    const blocks =
      type === "authorization"
        ? [
            field("Employee name"),
            field("Email address"),
            field("Mobile number"),
            text(
              `We, ${form.company_name || "[Company name]"}, authorize the person named above to [describe the responsibilities, scope and validity of this authorization].`
            ),
          ]
        : [
            text(
              `We, ${form.company_name || "[Company name]"}, confirm that [enter the details and purpose of this declaration].`
            ),
            field("Reference"),
          ];
    setForm({
      ...form,
      title: type === "authorization" ? "Authorization letter" : "Declaration letter",
      salutation: "To whom it may concern,",
      blocks: [
        ...form.blocks.filter((block) => block.type !== "text" || !!block.text.trim()),
        ...blocks,
      ],
    });
  };
  return (
    <>
      <PageHeader
        title={form.title || "New letter"}
        subtitle={`${form.number} · ${issued ? "Issued letter" : "Draft"}`}
        action={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" disabled={busy} onClick={onBack}>
              <ArrowLeft size={15} /> Back
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={onPreview}
            >
              <Eye size={15} /> Preview
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={onDownload}
            >
              <Download size={15} /> PDF
            </button>
            {issued ? (
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !onDuplicate}
                onClick={onDuplicate}
              >
                <Copy size={15} /> Duplicate draft
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={onSave}
                >
                  <Save size={15} /> Save draft
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={onIssue}
                >
                  <Check size={15} /> {busy ? "Working…" : "Issue letter"}
                </button>
              </>
            )}
          </div>
        }
      />
      {issued && (
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          This issued copy keeps its saved content and company details. Duplicate it to
          make changes.
        </p>
      )}
      <ResizablePanels
        defaultRightWidth={390}
        minRightWidth={280}
        left={
          <Card className="!p-0 overflow-hidden">
            <fieldset disabled={disabled} className="min-w-0">
              <Tabs defaultValue="content">
                <TabsList className="flex w-full px-2 sm:px-4" aria-label="Letter editor">
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="content">Content</TabsTrigger>
                  <TabsTrigger value="appearance">Appearance</TabsTrigger>
                </TabsList>
                <div className="p-4 sm:p-5">
                  {lookupError && !issued && (
                    <div role="alert" className="mb-4 text-sm text-muted-foreground">
                      {lookupError}
                      <button type="button" className="btn-ghost ml-2" onClick={onRetry}>
                        Retry
                      </button>
                    </div>
                  )}
                  <TabsContent value="details" className="mt-0 space-y-6">
                    <section className="space-y-3">
                      <h2 className="text-sm font-semibold">Letter details</h2>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {input("number", "Internal letter number", 100)}
                        <Field label="Issue date" required>
                          <DateField
                            value={form.issue_date}
                            onChange={(value) => set("issue_date", value)}
                          />
                        </Field>
                        {input("title", "Letter title", 200)}
                        {input("recipient_name", "Recipient name")}
                      </div>
                      <Field label="Recipient address">
                        <textarea
                          className="input min-h-20 w-full resize-y"
                          maxLength={400}
                          value={form.recipient_address}
                          onChange={(event) =>
                            set("recipient_address", event.target.value)
                          }
                        />
                      </Field>
                    </section>
                    <section className="space-y-3">
                      <h2 className="text-sm font-semibold">Company details</h2>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {input("company_name", "Company name")}
                        {input("company_email", "Email", 254)}
                        {input("company_phone", "Phone", 40)}
                        {input("company_trn", "Tax registration number", 60)}
                      </div>
                      <Field label="Company address">
                        <textarea
                          className="input min-h-20 w-full resize-y"
                          maxLength={400}
                          value={form.company_address}
                          onChange={(event) => set("company_address", event.target.value)}
                        />
                      </Field>
                    </section>
                    <section className="grid gap-3 sm:grid-cols-2">
                      {input("signatory_name", "Authorized person's name")}
                      {input("signatory_title", "Designation")}
                    </section>
                  </TabsContent>
                  <TabsContent value="content" className="mt-0 space-y-4">
                    <div className="space-y-2 rounded-xl border bg-muted/25 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          Text formatting
                        </span>
                        <div className="w-44">
                          <SelectMenu
                            value={target}
                            ariaLabel="Formatting target"
                            options={formatOptions}
                            disabled={disabled}
                            onChange={setFormatTarget}
                          />
                        </div>
                      </div>
                      <LetterFormatToolbar
                        value={formatValue}
                        onChange={changeFormat}
                        disabled={disabled}
                        targetLabel={
                          formatOptions.find((option) => option.value === target)?.label
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Choose a paragraph or click its text to format it. All body text
                        sets the default for paragraphs and field values.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {input("title", "Letter title", 200)}
                      <Field label="Add starter wording">
                        <SelectMenu
                          value=""
                          ariaLabel="Add starter wording"
                          disabled={disabled || form.blocks.length > 94}
                          options={[
                            { value: "", label: "Choose a starter…" },
                            { value: "authorization", label: "Authorization letter" },
                            { value: "declaration", label: "General declaration" },
                          ]}
                          onChange={starter}
                        />
                      </Field>
                    </div>
                    {input("salutation", "Salutation", 200)}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-semibold">Letter content</h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Drag the handles, or use the arrows to reorder blocks.
                        </p>
                      </div>
                      <div className="w-44">
                        <SelectMenu
                          value=""
                          options={BLOCKS}
                          ariaLabel="Add letter block"
                          disabled={disabled || form.blocks.length >= 100}
                          onChange={add}
                        />
                      </div>
                    </div>
                    {form.body && (
                      <Field label="Introduction">
                        <textarea
                          className="input min-h-24 w-full resize-y"
                          maxLength={50_000}
                          value={form.body}
                          onChange={(event) => set("body", event.target.value)}
                        />
                      </Field>
                    )}
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={({ active, over }) => {
                        if (!disabled && over && active.id !== over.id)
                          move(
                            form.blocks.findIndex((block) => block.id === active.id),
                            form.blocks.findIndex((block) => block.id === over.id)
                          );
                      }}
                    >
                      <SortableContext
                        items={form.blocks.map((block) => block.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="space-y-3">
                          {form.blocks.map((block, index) => (
                            <LetterBlockEditor
                              key={block.id}
                              block={block}
                              index={index}
                              count={form.blocks.length}
                              disabled={disabled}
                              alignment={
                                block.style?.align ??
                                form.text_style?.align ??
                                block.align
                              }
                              onSelect={() => {
                                if (block.type !== "signature" && block.type !== "stamp")
                                  setFormatTarget(block.id);
                              }}
                              onChange={(next) =>
                                set(
                                  "blocks",
                                  form.blocks.map((item) =>
                                    item.id === block.id ? next : item
                                  )
                                )
                              }
                              onMove={(direction) => move(index, index + direction)}
                              onRemove={() =>
                                set(
                                  "blocks",
                                  form.blocks.filter((item) => item.id !== block.id)
                                )
                              }
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                    {!form.blocks.length && (
                      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                        Add text or a custom field to begin.
                      </p>
                    )}
                    {input("closing", "Closing", 200)}
                  </TabsContent>
                  <TabsContent value="appearance" className="mt-0 space-y-5">
                    <Field label="Layout">
                      <SelectMenu
                        value={form.template}
                        ariaLabel="Letter layout"
                        options={LETTER_TEMPLATES.map((template) => ({
                          value: template.id,
                          label: template.label,
                        }))}
                        onChange={(value) => set("template", value)}
                      />
                    </Field>
                    <Field label="Accent color">
                      <input
                        type="color"
                        className="h-10 w-16 cursor-pointer rounded-md border bg-transparent p-1"
                        value={form.accent}
                        onChange={(event) => set("accent", event.target.value)}
                      />
                    </Field>
                    <div className="divide-y rounded-xl border px-3">
                      {(
                        [
                          ["show_company_header", "Show company details", false],
                          [
                            "use_letterhead",
                            "Use company letterhead",
                            !form.letterhead?.background,
                          ],
                          ["show_logo", "Show company logo", !form.company_logo],
                          ["show_reference", "Show letter reference", false],
                          [
                            "show_signature",
                            "Use saved signature",
                            !form.signature?.data,
                          ],
                          ["show_stamp", "Use saved company stamp", !form.stamp?.data],
                        ] as const
                      ).map(([key, label, unavailable]) => (
                        <div
                          key={key}
                          className="flex min-h-14 items-center justify-between gap-3 py-2"
                        >
                          <div>
                            <p className="text-sm">{label}</p>
                            {unavailable && (
                              <p className="text-xs text-muted-foreground">
                                Add this image in Company Details
                              </p>
                            )}
                            {key === "show_reference" && (
                              <p className="text-xs text-muted-foreground">
                                Optional on the letter. Its number is kept on your
                                dashboard.
                              </p>
                            )}
                          </div>
                          <Switch
                            label={label}
                            checked={
                              key === "show_company_header"
                                ? (form[key] ??
                                  !(form.use_letterhead && form.letterhead?.background))
                                : key === "show_reference"
                                  ? form[key] !== false
                                  : !!form[key]
                            }
                            disabled={disabled || (unavailable && !form[key])}
                            onChange={(value) => set(key, value)}
                          />
                        </div>
                      ))}
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Company images come from Settings → Company Details. Add signature
                      or stamp blocks to choose their place in the letter. New image
                      blocks use full opacity.
                    </p>
                  </TabsContent>
                </div>
              </Tabs>
            </fieldset>
          </Card>
        }
        right={
          <Card className="!p-3">
            <LetterPreview form={form} />
          </Card>
        }
      />
    </>
  );
}

function LetterBlockEditor({
  block,
  index,
  count,
  disabled,
  alignment,
  onSelect,
  onChange,
  onMove,
  onRemove,
}: {
  block: LetterBlock;
  index: number;
  count: number;
  disabled: boolean;
  alignment: LetterBlock["align"];
  onSelect: () => void;
  onChange: (block: LetterBlock) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id, disabled });
  const kind =
    block.type === "text"
      ? "Text"
      : block.type === "field"
        ? "Custom field"
        : block.type === "date"
          ? "Date"
          : block.type === "signature"
            ? "Signature"
            : "Stamp";
  return (
    <section
      ref={setNodeRef}
      onFocus={onSelect}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="rounded-xl border bg-background p-3"
      aria-label={`${kind} block ${index + 1}`}
    >
      <div className="mb-3 flex min-w-0 items-center gap-1">
        <button
          type="button"
          className="btn-ghost h-10 w-10 shrink-0 p-0"
          aria-label={`Drag block ${index + 1}`}
          disabled={disabled}
          style={{ touchAction: "none" }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </button>
        <span className="mr-auto text-xs font-medium text-muted-foreground">
          {kind} · {index + 1}
        </span>
        <button
          type="button"
          className="btn-ghost h-10 w-10 p-0"
          disabled={disabled || index === 0}
          aria-label={`Move block ${index + 1} up`}
          onClick={() => onMove(-1)}
        >
          <ArrowUp size={14} />
        </button>
        <button
          type="button"
          className="btn-ghost h-10 w-10 p-0"
          disabled={disabled || index + 1 === count}
          aria-label={`Move block ${index + 1} down`}
          onClick={() => onMove(1)}
        >
          <ArrowDown size={14} />
        </button>
        <button
          type="button"
          className="btn-ghost h-10 w-10 p-0"
          disabled={disabled}
          aria-label={`Remove block ${index + 1}`}
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="space-y-3">
        {block.type === "text" ? (
          <Field label={`Text ${index + 1}`}>
            <textarea
              className="input min-h-28 w-full resize-y"
              maxLength={20_000}
              value={block.text}
              onChange={(event) => onChange({ ...block, text: event.target.value })}
            />
          </Field>
        ) : (
          <>
            <Field label={`Label ${index + 1}`}>
              <input
                className="input w-full"
                maxLength={200}
                value={block.label}
                onChange={(event) => onChange({ ...block, label: event.target.value })}
              />
            </Field>
            {block.type === "field" && (
              <Field label={`Value ${index + 1}`}>
                <textarea
                  className="input min-h-20 w-full resize-y"
                  maxLength={10_000}
                  value={block.value}
                  onChange={(event) => onChange({ ...block, value: event.target.value })}
                />
              </Field>
            )}
            {block.type === "date" && (
              <Field label={`Date ${index + 1}`}>
                <DateField
                  value={block.value}
                  onChange={(value) => onChange({ ...block, value })}
                />
              </Field>
            )}
            {(block.type === "signature" || block.type === "stamp") && (
              <p className="text-xs text-muted-foreground">
                Uses the saved company {block.type} when enabled in Appearance, with a
                blank sign-off space when no image is selected.
              </p>
            )}
          </>
        )}
        <div className="max-w-44">
          <Field label={`Alignment ${index + 1}`}>
            <SelectMenu
              value={alignment}
              ariaLabel={`Block ${index + 1} alignment`}
              disabled={disabled}
              options={[
                { value: "left", label: "Left" },
                { value: "center", label: "Center" },
                { value: "right", label: "Right" },
              ]}
              onChange={(value) =>
                onChange({
                  ...block,
                  align: value as LetterBlock["align"],
                  style: { ...block.style, align: value as LetterBlock["align"] },
                })
              }
            />
          </Field>
        </div>
      </div>
    </section>
  );
}
