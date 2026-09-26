import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, Globe, PanelRightClose, Plus, RefreshCw, Square, X, Hand, Play } from "lucide-react";
import { desktopBrowserCommand, desktopBrowserSupported, getBrowserPanelState, subscribeBrowserPanel, setBrowserPanelOpen, newBrowserPanelTab, registerBrowserViewportSync, layoutDesktopBrowser, pauseAgentBrowser, closeDesktopBrowserTabs, type DesktopBrowserRequest } from "../lib/desktopBrowser";
import { disableComputerUse } from "../lib/computerUse";
import "./BrowserPanel.css";

const SITES = [{ name: "WhatsApp", url: "https://web.whatsapp.com/" }, { name: "Instagram", url: "https://www.instagram.com/" }, { name: "LinkedIn", url: "https://www.linkedin.com/" }];

export default function BrowserPanel() {
  const state = useSyncExternalStore(subscribeBrowserPanel, getBrowserPanelState);
  const supported = desktopBrowserSupported();
  const selected = state.tabs.find(tab => tab.id === state.activeId);
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number | null>(() => {
    try { const saved = Number(localStorage.getItem("filey.browser.panel.width")); return saved >= 320 && saved <= 760 ? saved : null; }
    catch { return null; }
  });
  const [maxWidth, setMaxWidth] = useState(760);
  const [measuredWidth, setMeasuredWidth] = useState(480);
  const [resizing, setResizing] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const working = useRef(false);
  useEffect(() => { setAddress(selected?.url ?? ""); }, [selected?.id, selected?.url]);

  useEffect(() => {
    if (!state.open) { resizeStart.current = null; setResizing(false); return; }
    const parent = panel.current?.parentElement;
    if (!parent) return;
    const update = () => {
      const limit = Math.max(320, Math.min(760, parent.getBoundingClientRect().width - 360));
      setMaxWidth(limit);
      setPanelWidth(current => current === null ? null : Math.min(current, limit));
      if (panel.current) setMeasuredWidth(Math.round(panel.current.getBoundingClientRect().width));
    };
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    if (panel.current) observer.observe(panel.current);
    update();
    return () => observer.disconnect();
  }, [state.open]);

  const resizeTo = (width: number) => {
    const next = Math.round(Math.max(320, Math.min(maxWidth, width)));
    setPanelWidth(next);
    try { localStorage.setItem("filey.browser.panel.width", String(next)); } catch { /* layout still works for this session */ }
  };

  useEffect(() => {
    if (!supported) return;
    let active = true;
    let frame = 0;
    let previous = "";
    const sync = async () => {
      if (!active) return;
      const current = getBrowserPanelState();
      const rect = host.current?.getBoundingClientRect();
      // Native child views sit above HTML. Hide them while an app menu/dialog
      // is open, so approval controls cannot be covered by a website.
      const overlay = [...document.querySelectorAll('[role="dialog"], [role="menu"], [data-browser-overlay]')].some(el => el.getBoundingClientRect().width > 0);
      const visible = current.open && current.activeId && rect && rect.width > 1 && rect.height > 1 && !overlay && document.visibilityState !== "hidden";
      const bounds = visible ? { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.width, height: rect.height } : null;
      const signature = JSON.stringify([bounds, current.activeId]);
      if (signature === previous) return;
      previous = signature;
      try { await layoutDesktopBrowser(bounds, current.activeId); }
      catch (e) { previous = ""; if (active) setError(e instanceof Error ? e.message : String(e)); throw e; }
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { void sync().catch(() => {}); }); };
    const unregister = registerBrowserViewportSync(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      previous = "";
      await sync();
    });
    const unsubscribe = subscribeBrowserPanel(schedule);
    const resize = new ResizeObserver(schedule);
    if (host.current) resize.observe(host.current);
    const overlays = new MutationObserver(schedule);
    overlays.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "aria-hidden"] });
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      active = false; cancelAnimationFrame(frame); unregister(); unsubscribe(); resize.disconnect(); overlays.disconnect();
      window.removeEventListener("resize", schedule); document.removeEventListener("visibilitychange", schedule);
      void layoutDesktopBrowser(null, null).catch(() => {});
    };
  }, [supported]);

  useEffect(() => {
    if (!state.open || !supported) return;
    const controller = new AbortController();
    const poll = async () => {
      if (working.current || document.visibilityState === "hidden") return;
      try { await desktopBrowserCommand({ action: "list" }, controller.signal); }
      catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [state.open, supported]);

  const act = async (request: DesktopBrowserRequest) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    try { await desktopBrowserCommand(request); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { working.current = false; setBusy(false); }
  };
  const navigate = () => {
    const raw = address.trim();
    if (raw) void act({ action: selected ? "navigate" : "open", tab_id: selected?.id, url: raw.includes("://") ? raw : `https://${raw}` });
  };
  const takeOver = async () => {
    setError("");
    try { await pauseAgentBrowser(!state.paused); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const stopWork = async () => {
    window.dispatchEvent(new Event("filey:stop-agent-browser"));
    try { await disableComputerUse(); await closeDesktopBrowserTabs(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <>
    {state.open && <div role="separator" tabIndex={0} aria-label="Resize browser panel" aria-orientation="vertical" aria-controls="filey-browser-panel" aria-valuemin={320} aria-valuemax={maxWidth} aria-valuenow={Math.min(maxWidth, panelWidth ?? measuredWidth)} aria-valuetext={`${Math.min(maxWidth, panelWidth ?? measuredWidth)} pixels`} title="Drag to resize · Arrow keys to adjust · Enter to collapse"
      className="filey-browser-resizer relative z-30 hidden w-3 shrink-0 touch-none select-none cursor-col-resize items-center justify-center border-l border-border bg-background outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring xl:flex"
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus();
        resizeStart.current = { x: event.clientX, width: panel.current?.getBoundingClientRect().width ?? panelWidth ?? 480 };
        event.currentTarget.setPointerCapture(event.pointerId); setResizing(true);
      }}
      onPointerMove={event => { if (resizeStart.current) resizeTo(resizeStart.current.width + resizeStart.current.x - event.clientX); }}
      onLostPointerCapture={() => { resizeStart.current = null; setResizing(false); }}
      onPointerUp={event => { resizeStart.current = null; setResizing(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { resizeStart.current = null; setResizing(false); }}
      onDoubleClick={() => { setPanelWidth(null); try { localStorage.removeItem("filey.browser.panel.width"); } catch { /* use default */ } }}
      onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); setBrowserPanelOpen(false); return; }
        const width = panel.current?.getBoundingClientRect().width || panelWidth || 480;
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          resizeTo(event.key === "Home" ? 320 : event.key === "End" ? maxWidth : width + (event.key === "ArrowLeft" ? 24 : -24));
        }
      }}><span aria-hidden="true" className="h-8 w-0.5 rounded-full bg-border" /></div>}
    {resizing && <div data-browser-overlay aria-hidden="true" className="pointer-events-none fixed inset-0 z-40 cursor-col-resize" />}
    <aside ref={panel} id="filey-browser-panel" aria-label="Built-in browser" hidden={!state.open}
    style={{ "--filey-browser-width": panelWidth === null ? "44%" : `${panelWidth}px` } as CSSProperties}
    className={state.open ? "filey-browser-panel absolute inset-0 z-30 flex min-h-0 min-w-0 flex-col bg-background xl:relative xl:inset-auto xl:z-auto xl:shrink-0" : "hidden"}>
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
      <Globe size={16} className="shrink-0 text-muted-foreground" /><span className="text-[13px] font-medium">{state.agentId ? "Agent browser" : "Browser"}</span>
      <span className="ml-auto text-xs text-muted-foreground">{state.paused ? "Your control" : state.tabs.length ? `${state.tabs.length} ${state.tabs.length === 1 ? "tab" : "tabs"}` : ""}</span>
      {supported && state.tabs.length > 0 && <>
        <button type="button" className="btn-ghost w-9 !px-0" onClick={() => void takeOver()} aria-label={state.paused ? "Resume agent" : "Take over browser"} title={state.paused ? "Resume agent" : "Take over browser"}>{state.paused ? <Play size={15} /> : <Hand size={15} />}</button>
        <button type="button" className="btn-ghost w-9 !px-0" onClick={() => void stopWork()} aria-label="Stop browser work" title="Stop browser work"><Square size={13} /></button>
      </>}
      <button type="button" className="btn-ghost w-9 !px-0" onClick={() => setBrowserPanelOpen(false)} aria-label="Collapse browser" title="Collapse browser"><PanelRightClose size={16} /></button>
    </div>
    {state.tabs.length > 0 && <div role="tablist" aria-label="Browser tabs" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
      {state.tabs.map(tab => <div key={tab.id} className={`flex max-w-[190px] shrink-0 items-center rounded-lg ${tab.id === state.activeId ? "bg-hover" : ""}`}>
        <button type="button" role="tab" aria-selected={tab.id === state.activeId} disabled={busy} onClick={() => void act({ action: "focus", tab_id: tab.id })} className="min-w-0 truncate py-2 pl-2.5 pr-1 text-xs" title={tab.title}>{tab.title || "Website"}</button>
        <button type="button" disabled={busy} onClick={() => void act({ action: "close", tab_id: tab.id })} aria-label={`Close ${tab.title || "website"}`} className="shrink-0 rounded-full p-1.5 hover:bg-background"><X size={12} /></button>
      </div>)}
      <button type="button" disabled={busy || state.tabs.length >= 8} onClick={() => { newBrowserPanelTab(); setAddress(""); host.current?.closest("aside")?.querySelector<HTMLInputElement>('input')?.focus(); }} className="rounded-full px-2 hover:bg-hover" aria-label="New browser tab" title="New tab"><Plus size={14} /></button>
    </div>}
    <form onSubmit={event => { event.preventDefault(); navigate(); }} className="flex shrink-0 items-center gap-1 border-b border-border p-2">
      <button type="button" disabled={busy || !selected?.canGoBack} onClick={() => void act({ action: "back", tab_id: selected?.id })} className="rounded-full p-2 hover:bg-hover disabled:opacity-30" aria-label="Back"><ArrowLeft size={15} /></button>
      <button type="button" disabled={busy || !selected?.canGoForward} onClick={() => void act({ action: "forward", tab_id: selected?.id })} className="rounded-full p-2 hover:bg-hover disabled:opacity-30" aria-label="Forward"><ArrowRight size={15} /></button>
      <button type="button" disabled={busy || !selected} onClick={() => void act({ action: selected?.loading ? "stop" : "reload", tab_id: selected?.id })} className="rounded-full p-2 hover:bg-hover disabled:opacity-30" aria-label={selected?.loading ? "Stop loading" : "Reload"}>{selected?.loading ? <Square size={13} /> : <RefreshCw size={14} />}</button>
      <input type="text" inputMode="url" value={address} onChange={e => setAddress(e.target.value)} placeholder="Enter website address" aria-label="Website address" className="min-w-0 flex-1 rounded-full border border-border bg-card px-3 py-2 text-xs outline-none focus:border-foreground/40" disabled={busy || !supported} />
      <button type="submit" aria-label="Go to website" disabled={busy || !address.trim() || !supported} className="rounded-full p-2 hover:bg-hover disabled:opacity-30"><ArrowUp size={15} /></button>
    </form>
    {error && <p role="alert" className="shrink-0 border-b border-border px-4 py-3 text-xs text-danger">{error}</p>}
    {selected?.warning && <p role="status" className="shrink-0 border-b border-border px-4 py-2 text-xs text-muted-foreground">{selected.warning}</p>}
    {selected?.blockedPopupUrl && <button type="button" disabled={busy} onClick={() => void act({ action: "open", url: selected.blockedPopupUrl! })} className="shrink-0 truncate px-4 py-2 text-left text-xs underline" title={selected.blockedPopupUrl}>Open requested link: {selected.blockedPopupUrl}</button>}
    <div ref={host} className="relative min-h-0 flex-1 bg-card">
      {!selected && <div className="flex h-full flex-col items-center justify-center px-6 pb-12 text-center">
        <Globe size={28} strokeWidth={1.25} className="mb-5 text-muted-foreground" />
        <h2 className="text-lg font-medium">A workspace for the web.</h2>
        <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-muted-foreground">{supported ? state.agentId ? "This conversation has its own browser profile. Open a site, or ask Filey to work here. No extra installation needed." : "Open a website above, or start with an everyday app. Your tabs stay here when you collapse the panel." : "Interactive browsing runs in Filey's Windows desktop app. You can still use Filey's business tools and web research here."}</p>
        {supported && <div className="mt-6 flex flex-wrap justify-center gap-2">{SITES.map(site => <button type="button" key={site.name} disabled={busy} onClick={() => void act({ action: "open", url: site.url })} className="btn-ghost text-xs">{site.name}</button>)}</div>}
      </div>}
    </div>
  </aside></>;
}
