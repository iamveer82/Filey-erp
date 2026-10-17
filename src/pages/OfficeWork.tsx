/* Office work: a dashboard of office apps that open as tabs. Word, Sheets and PDF are
 * WordCraft, GridCraft and PdfCraft (github.com/storytold, MIT OR Apache-2.0),
 * WebAssembly apps bundled with the desktop app under /wordcraft/, /gridcraft/ and
 * /pdfcraft/ so they run offline. */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { Home, Mail, Maximize2, Minimize2, Plus, Presentation, Printer, X } from "lucide-react";
import { useModules } from "../lib/modules";
import { useAuth } from "../lib/auth";
import { useUI } from "../lib/ui";
import { hasTauri } from "../lib/localPaths";
import { errMsg } from "../lib/format";
import { bridgeDesktop, OFFICE_APPS, printPdf, registerOffice, registerOfficeFrame, type OfficeApp } from "../lib/officeWord";
import { Card, Modal, PageHeader } from "../components/ui";
import ErrorBoundary from "../components/ErrorBoundary";
import FileyLoader from "../components/FileyLoader";

const Letter = lazy(() => import("./Letter"));
const MyFiles = lazy(() => import("./MyFiles"));
const PdfCanvas = lazy(() => import("../components/PdfCanvas"));

type App = OfficeApp | "letters";
interface Tab { id: string; app: App; title: string }

const ICONS: Record<OfficeApp, string> = { word: "/icons/wordcraft.svg", sheet: "/icons/gridcraft.svg", pdf: "/icons/pdf-app.png" };

// Letters stays reachable through its old links (?tab=letters) but is no longer an app here: Word covers it.
const APPS: { app?: App; name: string; icon: string | ComponentType<{ size?: number }>; note?: string }[] = [
  // ponytail: desktop-only until the 30-80 MB bundles are worth serving on the web.
  ...(["word", "sheet", "pdf"] as const).map(app => hasTauri
    ? { app, name: OFFICE_APPS[app].label, icon: ICONS[app] }
    : { name: OFFICE_APPS[app].label, icon: ICONS[app], note: "Desktop app" }),
  { name: "Slides", icon: Presentation, note: "Soon" },
];

/** Lives in the workspace shell so open documents survive moving to another section. */
export default function PersistentOfficeWork() {
  const active = useLocation().pathname === "/office";
  const { loading, error, isEnabled } = useModules();
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  if (loading || error || !isEnabled("letters") || (!visited && !active)) return null;
  return (
    <div hidden={!active} inert={!active} aria-hidden={!active || undefined} className="workspace-content min-w-0 px-4 pt-3 pb-5 sm:px-6">
      <OfficeWork />
    </div>
  );
}

function OfficeWork() {
  const { confirm } = useUI();
  const [params, setParams] = useSearchParams();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [current, setCurrent] = useState("home");
  const [printing, setPrinting] = useState<Uint8Array | null>(null);
  // Full window: the apps are desktop-sized, so they can take the whole Filey window.
  const [wide, setWide] = useState(false);
  const counts = useRef<Record<string, number>>({});
  const selected = useRef(current);
  selected.current = current;

  const openApp = useCallback((app: OfficeApp, title?: string) => {
    const n = counts.current[app] = (counts.current[app] ?? 0) + 1, id = `${app}-${n}`;
    const fallback = app === "word" ? `Document ${n}` : app === "sheet" ? `Book ${n}` : n > 1 ? `PDF ${n}` : "PDF";
    setTabs(list => [...list, { id, app, title: title || fallback }]);
    setCurrent(id);
    return id;
  }, []);
  const open = (app: App) => {
    if (app !== "letters") return void openApp(app);
    if (!tabs.some(t => t.id === "letters")) setTabs(list => [...list, { id: "letters", app, title: "Letters" }]);
    setCurrent("letters");
  };
  // The agent's word, sheet and pdf tools open and focus tabs through this handle.
  useEffect(() => registerOffice({ open: openApp, focus: setCurrent, selected: () => selected.current, print: setPrinting }), [openApp]);
  const close = async (tab: Tab) => {
    if (tab.app !== "letters" && !(await confirm({ title: `Close ${tab.title}?`, message: "Changes you haven't saved will be lost.", confirmLabel: "Close", danger: true }))) return;
    setTabs(list => list.filter(t => t.id !== tab.id));
    setCurrent(c => (c === tab.id ? "home" : c));
  };

  // Old /letters links and the agent's letter links arrive as ?tab=letters (and ?letter=…).
  const wanted = params.get("tab");
  useEffect(() => {
    if (wanted !== "letters" && !(wanted && wanted in OFFICE_APPS && hasTauri)) return;
    open(wanted as App);
    setParams(p => { p.delete("tab"); return p; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per deep link
  }, [wanted]);

  return (
    <div className={wide ? "fixed inset-0 z-40 flex flex-col bg-background p-2" : "flex h-[calc(100dvh-6rem)] min-h-[520px] flex-col"}>
      <div className="mb-2.5 flex shrink-0 items-center gap-1.5">
        <div role="tablist" aria-label="Open office apps" className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl bg-muted p-1">
          <TabButton selected={current === "home"} onSelect={() => setCurrent("home")} label="Office work" icon={<Home size={14} />} />
          {tabs.map(tab => (
            <TabButton key={tab.id} selected={current === tab.id} onSelect={() => setCurrent(tab.id)} label={tab.title}
              icon={tab.app === "letters" ? <Mail size={14} /> : <img src={ICONS[tab.app]} alt="" className="h-4 w-4" />} onClose={() => void close(tab)} />
          ))}
        </div>
        {hasTauri && (() => {
          // A new tab of the app on screen; Word from the dashboard.
          const app = tabs.find(t => t.id === current)?.app;
          const next: OfficeApp = app && app !== "letters" ? app : "word";
          const what = next === "word" ? "Word document" : next === "sheet" ? "spreadsheet" : "PDF tab";
          return (
            <button type="button" aria-label={`New ${what}`} title={`New ${what}`} onClick={() => void openApp(next)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-hover hover:text-foreground">
              <Plus size={16} />
            </button>
          );
        })()}
        {hasTauri && (wide || tabs.some(t => t.id === current && t.app !== "letters")) && (
          <button type="button" aria-label={wide ? "Exit full window" : "Full window"} title={wide ? "Exit full window" : "Full window"} onClick={() => setWide(w => !w)}
            className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-hover hover:text-foreground">
            {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        )}
      </div>
      {/* Inert behind the print dialog: an app's canvas would take focus and close it. */}
      <div className="relative min-h-0 flex-1" inert={!!printing}>
        <section hidden={current !== "home"} className="h-full overflow-y-auto">
          <PageHeader title="Office work" subtitle="Word, Sheets and PDF open in their own tabs, so you can keep several files open." />
          <div className="flex flex-wrap gap-4">
            {APPS.map(({ app, name, icon: Icon, note }) => (
              <button key={name} type="button" disabled={!app} onClick={app ? () => open(app) : undefined}
                className="flex w-20 flex-col items-center gap-1.5 rounded-xl p-2 text-sm font-medium hover:bg-hover disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent">
                {typeof Icon === "string"
                  ? <img src={Icon} alt="" className="h-12 w-12" />
                  : <span className="grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground"><Icon size={22} /></span>}
                {name}
                {note && <span className="-mt-1 text-[11px] font-normal text-muted-foreground">{note}</span>}
              </button>
            ))}
          </div>

          <div className="mt-6">
            <Suspense fallback={<FileyLoader />}>
              <MyFiles embedded />
            </Suspense>
          </div>
        </section>
        {tabs.map(tab => (
          <section key={tab.id} hidden={current !== tab.id} className="h-full overflow-y-auto">
            {tab.app !== "letters" ? <AppTab app={tab.app} id={tab.id} title={tab.title} /> : (
              <ErrorBoundary><Suspense fallback={<FileyLoader />}><Letter /></Suspense></ErrorBoundary>
            )}
          </section>
        ))}
      </div>
      {printing && <PrintDialog pdf={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}

/** File › Print in an app: the pages as they will print, then the system print dialog. */
function PrintDialog({ pdf, onClose }: { pdf: Uint8Array; onClose: () => void }) {
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const file = useMemo(() => new File([pdf as BlobPart], "Document.pdf", { type: "application/pdf" }), [pdf]);
  const print = async () => {
    setBusy(true);
    try {
      await printPdf(pdf);
      onClose();
    } catch (e) {
      toast.error(`Could not print: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open size="xl" title="Print" onClose={() => { if (!busy) onClose(); }}>
      <div className="h-[min(58vh,560px)] overflow-hidden rounded-xl border border-border bg-muted">
        <Suspense fallback={<FileyLoader />}><PdfCanvas file={file} /></Suspense>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted-foreground">Choose the printer, copies and pages in the next step.</p>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void print()}>
            <Printer size={14} /> {busy ? "Preparing…" : "Print"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TabButton({ selected, onSelect, label, icon, onClose }: { selected: boolean; onSelect: () => void; label: string; icon: React.ReactNode; onClose?: () => void }) {
  return (
    <div className={`group flex h-8 shrink-0 items-center rounded-lg transition-colors ${selected ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-card/70 hover:text-foreground"}`}>
      <button type="button" role="tab" aria-selected={selected} onClick={onSelect} title={label}
        className={`flex h-full items-center gap-1.5 text-[13px] font-medium ${onClose ? "pl-2.5 pr-1" : "px-3"}`}>
        {icon}<span className="max-w-44 truncate">{label}</span>
      </button>
      {onClose && (
        <button type="button" aria-label={`Close ${label}`} onClick={onClose}
          className={`mr-1 grid h-5 w-5 place-items-center rounded-md hover:bg-hover hover:text-foreground focus-visible:opacity-100 ${selected ? "" : "opacity-0 group-hover:opacity-100"}`}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function AppTab({ app, id, title }: { app: OfficeApp; id: string; title: string }) {
  const author = useAuth().profile?.name;
  const frame = useRef<HTMLIFrameElement>(null);
  const [missing, setMissing] = useState(false);
  const unregister = useRef<() => void>(undefined);
  useEffect(() => () => unregister.current?.(), []);
  const { label, src } = OFFICE_APPS[app];
  if (missing) return <Card><p className="font-medium">{label} isn't included in this build.</p><p className="mt-1 text-sm text-muted-foreground">Run <code>node scripts/fetch-office-apps.mjs</code> and reload.</p></Card>;
  return (
    <iframe ref={frame} title={title} src={app === "pdf" && author ? `${src}&author=${encodeURIComponent(author)}` : src} allow="clipboard-read; clipboard-write; fullscreen; local-fonts"
      className="h-full w-full rounded-xl border border-border bg-[#e6e6e6]"
      onLoad={() => {
        const win = frame.current?.contentWindow;
        // Without the bundle, the app's own page answers the URL instead.
        if (!win || win.document.title !== OFFICE_APPS[app].title) return setMissing(true);
        if (hasTauri) bridgeDesktop(win, app);
        unregister.current?.();
        unregister.current = registerOfficeFrame(app, id, win, author);
      }} />
  );
}
