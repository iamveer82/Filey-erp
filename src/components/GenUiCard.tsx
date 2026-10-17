/* Filey AI's interactive cards (show_ui), after OpenIntelligentUI's sandboxed
 * generative UI (github.com/CopilotKit/OpenIntelligentUI, MIT). The card runs on
 * its own origin (src-tauri/src/modules/genui.*) in an iframe without
 * allow-same-origin; it can report its size and, right after a real click, send
 * a follow-up or open a link. Pictures are resolved here and handed in. */
import { useEffect, useRef, useState } from "react";
import { Bookmark, Copy, Download, FolderDown, Maximize2 } from "lucide-react";
import { hasTauri, saveBytes } from "../lib/localPaths";
import { useUI } from "../lib/ui";
import { errMsg } from "../lib/format";
import { resolveCardImages, saveCardTemplate, type GenUiCardSpec } from "../lib/genUi";
import { Modal } from "./ui";
import { GenUiHeader } from "./GenUiView";

// Tauri serves custom schemes as http://<scheme>.localhost on Windows.
const CARD_ORIGIN = /Windows/i.test(navigator.userAgent) ? "http://fileyui.localhost/" : "fileyui://localhost/";
const PHRASES = ["Sketching the layout", "Wiring up the controls", "Painting the details", "Checking the numbers"];

export default function GenUiCard({ card, onPrompt, expanded = false }: { card: GenUiCardSpec; onPrompt?: (text: string) => void; expanded?: boolean }) {
  const { toast, prompt: ask } = useUI();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(card.initialHeight ?? 200);
  const [rendered, setRendered] = useState(false);
  const [phrase, setPhrase] = useState(0);
  const [open, setOpen] = useState(false);
  const [waitingFor, setWaitingFor] = useState<string[]>([]);
  const send = useRef(onPrompt);
  send.current = onPrompt;
  const images = useRef<Record<string, string>>({});
  const exported = useRef<((html: string) => void) | null>(null);
  const phrases = card.placeholderMessages?.length ? card.placeholderMessages : PHRASES;

  useEffect(() => {
    if (rendered) return;
    const t = setInterval(() => setPhrase(p => p + 1), 1800);
    return () => clearInterval(t);
  }, [rendered]);

  // Pictures: resolved now, and again when a generated one finishes (after its Generate click).
  useEffect(() => {
    if (!card.images?.length) return;
    let alive = true;
    const resolve = async () => {
      const { resolved, pending } = await resolveCardImages(card.images!);
      if (!alive) return;
      images.current = resolved;
      setWaitingFor(pending);
      frame.current?.contentWindow?.postMessage({ type: "filey-ui-images", images: resolved }, "*");
    };
    void resolve();
    addEventListener("filey:media", resolve);
    return () => { alive = false; removeEventListener("filey:media", resolve); };
  }, [card.images]);

  useEffect(() => {
    let last = 0;
    const clicked = () => !!navigator.userActivation?.isActive && Date.now() - last > 1500;
    const onMessage = (event: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || event.source !== win) return;
      const m = event.data as { type?: unknown; height?: unknown; text?: unknown; url?: unknown; html?: unknown };
      if (m?.type === "filey-ui-ready") {
        const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
        win.postMessage({ type: "filey-ui-render", title: card.title, html: card.html, css: card.css, jsFunctions: card.jsFunctions,
          jsExpressions: card.jsExpressions, js: card.js, theme, images: images.current }, "*");
      } else if (m?.type === "filey-ui-rendered") setRendered(true);
      else if (m?.type === "filey-ui-size" && typeof m.height === "number" && Number.isFinite(m.height)) {
        setHeight(Math.min(Math.max(Math.ceil(m.height), 40), expanded ? 6000 : 2400));
      } else if (m?.type === "filey-ui-export" && typeof m.html === "string") exported.current?.(m.html);
      // A click in the card activates this page too; card code alone can't, so it can't act on its own.
      else if (m?.type === "filey-ui-prompt" && typeof m.text === "string" && m.text.trim() && clicked()) {
        last = Date.now();
        send.current?.(m.text.trim().slice(0, 2000));
      } else if (m?.type === "filey-ui-link" && typeof m.url === "string" && clicked()) {
        last = Date.now();
        let url: URL | null = null;
        try { url = new URL(m.url); } catch { /* not a URL */ }
        if (url?.protocol !== "https:") return;
        if (hasTauri) void import("@tauri-apps/plugin-opener").then(o => o.openUrl(url!.href)).catch(() => {});
        else window.open(url.href, "_blank", "noopener,noreferrer");
      }
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [card, expanded]);

  const standalone = () => new Promise<string>((resolve, reject) => {
    const win = frame.current?.contentWindow;
    if (!win || !rendered) return reject(new Error("The card is still loading."));
    const timer = setTimeout(() => { exported.current = null; reject(new Error("The card didn't answer.")); }, 5000);
    exported.current = html => { clearTimeout(timer); exported.current = null; resolve(html); };
    win.postMessage({ type: "filey-ui-export" }, "*");
  });
  const fileName = `${(card.title || "Filey card").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80)}.html`;
  const act = (work: () => Promise<unknown>) => () => { void work().catch(e => toast.error(errMsg(e))); };

  const saveToFiles = act(async () => {
    const { saveOutput } = await import("../lib/files");
    await saveOutput({ name: fileName, bytes: new TextEncoder().encode(await standalone()) }, "card");
    toast.success(`Saved "${fileName}" to My Files.`);
  });
  const download = act(async () => {
    if (await saveBytes(fileName, new TextEncoder().encode(await standalone()), "text/html")) toast.success("Card saved.");
  });
  const copy = act(async () => {
    await navigator.clipboard.writeText(await standalone());
    toast.success("Card code copied.");
  });
  const saveTemplate = act(async () => {
    const name = await ask({ title: "Save as a card template", label: "Template name", defaultValue: card.title ?? "", confirmLabel: "Save" });
    if (!name?.trim()) return;
    await saveCardTemplate({ name, description: card.title ?? name, card: { css: card.css, html: card.html, jsFunctions: card.jsFunctions, jsExpressions: card.jsExpressions, js: card.js, initialHeight: card.initialHeight } });
    toast.success(`Template "${name.trim()}" saved. Ask Filey AI to use it with new data.`);
  });

  const tool = "grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40";
  return (
    <div className={expanded ? "" : "my-2 overflow-hidden rounded-xl border border-border bg-card"}>
      {!expanded && (
        <GenUiHeader title={card.title || "Interactive card"} seed={(card.title ?? "").length}>
          {hasTauri && <>
            <button type="button" className={tool} title="Expand" aria-label="Expand card" onClick={() => setOpen(true)}><Maximize2 size={14} /></button>
            <button type="button" className={tool} title="Save to My Files" aria-label="Save card to My Files" disabled={!rendered} onClick={saveToFiles}><FolderDown size={14} /></button>
            <button type="button" className={tool} title="Download" aria-label="Download card" disabled={!rendered} onClick={download}><Download size={14} /></button>
            <button type="button" className={tool} title="Save as template" aria-label="Save card as template" onClick={saveTemplate}><Bookmark size={14} /></button>
            <button type="button" className={tool} title="Copy code" aria-label="Copy card code" disabled={!rendered} onClick={copy}><Copy size={14} /></button>
          </>}
        </GenUiHeader>
      )}
      <div className={expanded ? "" : "p-2.5"}>
        {hasTauri ? (
          <div className="relative" style={{ height: rendered ? height : card.initialHeight ?? 200, transition: "height 200ms ease-out" }}>
            {!rendered && (
              <div className="absolute inset-0 grid place-items-center rounded-lg bg-muted/60">
                <div className="flex items-center gap-2 text-[12.5px] font-medium text-muted-foreground">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-muted-foreground" />
                  {phrases[phrase % phrases.length]}…
                </div>
              </div>
            )}
            <iframe ref={frame} src={CARD_ORIGIN} sandbox="allow-scripts allow-forms" title={card.title || "Interactive card"}
              className="block h-full w-full border-0 bg-transparent" style={{ opacity: rendered ? 1 : 0 }} />
          </div>
        ) : (
          // ponytail: the web app has no card origin yet, so the card shows without its scripts.
          <iframe sandbox="" srcDoc={`<style>body{margin:0;font:14px/1.5 system-ui,sans-serif}${card.css ?? ""}</style>${card.html}`}
            title={card.title || "Card"} className="block h-64 w-full border-0" />
        )}
        {!!waitingFor.length && (
          <p className="mt-1.5 text-[12px] text-muted-foreground">Pictures appear here once generated: click Generate on the image above.</p>
        )}
      </div>
      {open && (
        <Modal open size="full" title={card.title || "Interactive card"} onClose={() => setOpen(false)}>
          <div className="max-h-[78vh] overflow-y-auto"><GenUiCard card={card} onPrompt={onPrompt} expanded /></div>
        </Modal>
      )}
    </div>
  );
}
