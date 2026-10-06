import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
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
  type LetterForm,
  type LetterRecord,
} from "../lib/letters";
import {
  Badge,
  Card,
  DataTable,
  ErrorBanner,
  FilterChip,
  Modal,
  PageHeader,
  SearchInput,
} from "../components/ui";
import { RowActions } from "../components/RowActions";
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
import LetterDocument, { useLetterPages } from "../components/LetterDocument";

import { LetterEditor } from "../components/LetterEditor";

const filename = (form: LetterForm) =>
  safeName(form.number || "letter")
    .replace(/\.+$/, "")
    .slice(0, 100) || "letter";

export default function Letter() {
  const { toast, confirm } = useUI();
  const [params] = useSearchParams();
  const requestedLetterId = params.get("letter");
  const [records, setRecords] = useState<LetterRecord[]>([]);
  const [editorSession, setEditorSession] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [linkError, setLinkError] = useState("");
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
  const recordRequest = useRef(0);
  const letterLink = useRef({
    id: requestedLetterId,
    scope: agentStorageScope(),
    handled: false,
  });

  const refresh = useCallback(async () => {
    const scope = agentStorageScope(),
      request = ++recordRequest.current;
    const current = () =>
      scope === agentStorageScope() && request === recordRequest.current;
    try {
      const rows = await loadLetters();
      if (current()) {
        setRecords(rows);
        setError("");
      }
    } catch (failure) {
      if (current()) setError(errMsg(failure));
    } finally {
      if (current()) setLoading(false);
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
      letterLink.current.handled = true;
      setLinkError(
        letterLink.current.id
          ? "Your workspace changed. Open this letter from Filey AI again in the correct workspace."
          : ""
      );
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
  const open = useCallback(
    (next: LetterForm, record: LetterRecord | null = null) => {
      if (renderScope !== agentStorageScope()) return;
      editorScope.current = agentStorageScope();
      baseline.current = JSON.stringify(next);
      setEditing(record);
      setEditorSession((value) => value + 1);
      setForm(next);
    },
    [renderScope]
  );
  useEffect(() => {
    if (letterLink.current.id !== requestedLetterId) {
      letterLink.current = {
        id: requestedLetterId,
        scope: renderScope,
        handled: false,
      };
      setLinkError("");
    }
    const request = letterLink.current;
    if (!requestedLetterId || request.handled) return;
    if (request.scope !== agentStorageScope() || renderScope !== agentStorageScope()) {
      request.handled = true;
      setLinkError(
        "Your workspace changed. Open this letter from Filey AI again in the correct workspace."
      );
      return;
    }
    if (loading || error || busy) return;
    if (dirty) {
      setLinkError(
        "This letter has unsaved changes. Save your changes or go Back before opening the requested letter."
      );
      return;
    }
    request.handled = true;
    const record = records.find((letter) => letter.id === requestedLetterId);
    if (!record) {
      setLinkError(
        "This letter was not found in this workspace. It may have been deleted. Open another saved letter or return to Filey AI."
      );
      return;
    }
    try {
      const displayed = letterDisplayForm(record);
      setPreview(null);
      setLinkError("");
      open(displayed, record);
    } catch (failure) {
      setLinkError(errMsg(failure));
    }
  }, [requestedLetterId, records, loading, error, busy, dirty, renderScope, open]);
  const showPreview = (document: LetterForm) => {
    if (renderScope === agentStorageScope()) setPreview(document);
  };
  const nextNumber = () =>
    allocateDocumentNumber(
      "letter",
      records.map((record) => record.form.number),
      formats
    );
  const create = () =>
    run(async () => {
      const blank = blankLetterForm(await nextNumber());
      open({
        ...blank,
        closing: "",
        blocks: [],
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
  const duplicate = (record: LetterRecord) =>
    run(async () => {
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
      {linkError && (
        <div className="mb-4">
          <ErrorBanner message={linkError} />
        </div>
      )}
      {form ? (
        <LetterEditor
          key={editorSession}
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
          <div
            className="letter-preview-scroll"
            role="region"
            aria-label="Letter preview"
            tabIndex={0}
          >
            <div className="mx-auto w-full max-w-[900px]">
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
