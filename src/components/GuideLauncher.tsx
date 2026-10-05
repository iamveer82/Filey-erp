import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { AGENT_STORAGE_EVENT, agentStorageScope } from "../lib/agentStorage";
import { guideForRoute, validGuideId } from "../lib/guideRoutes";
import { useModules } from "../lib/modules";
import "./FileyGuide.css";

class GuideBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <aside className="filey-guide-panel p-5" aria-label="Guide unavailable">
      <button className="filey-guide-icon float-right" aria-label="Close guide" onClick={this.props.onClose}><X size={18} /></button>
      <p className="font-medium">This guide could not load.</p>
      <p className="mt-2 text-sm text-muted-foreground">Your current work is still open. Reconnect to open the guide again, or read the documentation.</p>
      <Link className="btn-secondary mt-4" to="/docs" onClick={this.props.onClose}>Read documentation</Link>
    </aside>;
  }
}

/** Lives with Layout, so the guide never owns the current document or chat. */
export default function GuideLauncher() {
  const location = useLocation();
  const { loading, error, modules, isEnabled } = useModules();
  const [scope, setScope] = useState(agentStorageScope);
  const scopeRef = useRef(scope);
  const [attempt, setAttempt] = useState(0);
  // A closed/reopened guide can retry a chunk that failed while offline.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Reset React.lazy's cached rejection on each explicit open attempt.
  const GuidePanel = useMemo(() => lazy(() => import("./FileyGuidePanel")), [attempt]);
  const [opened, setOpened] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const highlighted = useRef<HTMLElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const resume = useRef<HTMLButtonElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const focusResume = useRef(false);
  const clearHighlight = () => { highlighted.current?.removeAttribute("data-guide-highlight"); highlighted.current = null; };
  const contextualId = guideForRoute(location.pathname, location.search);
  const module = modules.find(m => m.to === "/" + location.pathname.split("/")[1]);
  const allowed = !loading && !error && (!module || isEnabled(module.id));
  const close = () => {
    clearHighlight(); setOpened(null); setMinimized(false);
    if (opener.current?.isConnected) opener.current.focus();
    else launcher.current?.focus();
  };
  const minimize = () => { focusResume.current = true; setMinimized(true); };

  useEffect(() => {
    const refresh = () => {
      const next = agentStorageScope();
      if (scopeRef.current !== next) { opener.current = null; clearHighlight(); setOpened(null); setMinimized(false); }
      scopeRef.current = next; setScope(next);
    };
    window.addEventListener(AGENT_STORAGE_EVENT, refresh);
    window.addEventListener("filey:workspace-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(AGENT_STORAGE_EVENT, refresh);
      window.removeEventListener("filey:workspace-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  useEffect(() => {
    const open = (event: Event) => {
      const id: unknown = (event as CustomEvent<{ id?: unknown }>).detail?.id;
      if (!validGuideId(id) || loading || error) return;
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      clearHighlight(); setAttempt(current => current + 1); setOpened(id); setMinimized(false);
    };
    window.addEventListener("filey:guide:open", open);
    return () => window.removeEventListener("filey:guide:open", open);
  }, [loading, error]);
  useEffect(() => { opener.current = null; focusResume.current = false; clearHighlight(); setMinimized(true); }, [location.pathname, location.search]);
  useEffect(() => {
    if (minimized && focusResume.current) { resume.current?.focus(); focusResume.current = false; }
  }, [minimized]);
  useEffect(() => () => clearHighlight(), []);

  return <>
    {allowed && (contextualId || (opened && minimized)) && <button ref={node => { launcher.current = node; resume.current = minimized ? node : null; }}
      type="button" className="filey-guide-launcher" aria-label={opened && minimized ? "Resume guide" : "How this section works"} aria-expanded={!!opened && !minimized}
      onClick={event => { if (!(opened && minimized)) opener.current = event.currentTarget; clearHighlight(); setAttempt(current => current + 1); if (!(opened && minimized)) setOpened(contextualId); setMinimized(false); }}>
      <BookOpen size={17} aria-hidden="true" /><span className="hidden xl:inline">{opened && minimized ? "Resume guide" : "How it works"}</span>
    </button>}
    {opened && !minimized && allowed && <GuideBoundary key={`${scope}:${opened}:${attempt}`} onClose={close}>
      <Suspense fallback={<aside className="filey-guide-panel p-5" aria-label="Loading guide"><button className="filey-guide-icon float-right" aria-label="Close guide" onClick={close}><X size={18} /></button><p role="status">Opening guide…</p></aside>}>
        <GuidePanel key={`${scope}:${opened}`} id={opened} scope={scope} onClose={close} onMinimize={minimize}
          onHighlight={element => { clearHighlight(); element.setAttribute("data-guide-highlight", ""); highlighted.current = element; }}
          onChoose={id => { clearHighlight(); setOpened(id); }} />
      </Suspense>
    </GuideBoundary>}
  </>;
}
