import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Globe,
  RefreshCw,
  Square,
  X,
} from "lucide-react";
import { PageHeader, ErrorBanner } from "../components/ui";
import { AGENT_STORAGE_EVENT, agentStorageScope } from "../lib/agentStorage";
import {
  desktopBrowserSupported,
  desktopBrowserCommand,
  type BrowserTab,
} from "../lib/desktopBrowser";

const SITES = [
  {
    name: "Instagram",
    url: "https://www.instagram.com/",
    purpose: "Create posts and review your business profile",
  },
  {
    name: "WhatsApp Web",
    url: "https://web.whatsapp.com/",
    purpose: "Conversations and document attachments",
  },
  {
    name: "Meta Business Suite",
    url: "https://business.facebook.com/",
    purpose: "Manage Facebook and Instagram content",
  },
  {
    name: "LinkedIn",
    url: "https://www.linkedin.com/feed/",
    purpose: "Company updates and professional contacts",
  },
  {
    name: "Telegram",
    url: "https://web.telegram.org/",
    purpose: "Your chats, channels and communities",
  },
];

export default function WorkspaceBrowser() {
  const [scope, setScope] = useState(agentStorageScope);
  useEffect(() => {
    const refresh = () => setScope(agentStorageScope());
    window.addEventListener(AGENT_STORAGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(AGENT_STORAGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return <BrowserWorkspace key={scope ?? "signed-out"} />;
}

function BrowserWorkspace() {
  const supported = desktopBrowserSupported();
  const [address, setAddress] = useState("");
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const working = useRef(false);
  const controller = useRef(new AbortController());

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    const refresh = async () => {
      if (!supported || working.current || document.visibilityState === "hidden") return;
      try {
        const result = await desktopBrowserCommand({ action: "list" }, abort.signal);
        if (!abort.signal.aborted) setTabs(result.tabs);
      } catch (e) {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [supported]);

  const act = async (
    action:
      | "open"
      | "back"
      | "forward"
      | "reload"
      | "stop"
      | "focus"
      | "close"
      | "close_all",
    tab_id?: string,
    url?: string
  ) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "open") {
        const raw = (url ?? address).trim();
        if (!raw) throw new Error("Enter a website address.");
        const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password)
          throw new Error("Use an HTTPS website address without embedded credentials.");
        url = parsed.href;
        if (!supported) {
          const opened = window.open(url, "_blank");
          if (!opened)
            throw new Error(
              "Your browser blocked the new tab. Allow pop-ups for Filey to open this website."
            );
          opened.opener = null;
          setNotice(
            "Opened in your browser. AI computer control requires the Windows desktop app."
          );
          return;
        }
      }
      const result = await desktopBrowserCommand(
        { action, tab_id, url },
        controller.current.signal
      );
      if (!controller.current.signal.aborted) setTabs(result.tabs);
    } catch (e) {
      if (!controller.current.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      working.current = false;
      if (!controller.current.signal.aborted) setBusy(false);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Browser"
        subtitle="Your business apps, connected to the way you work in Filey"
        action={
          <Link className="btn-ghost" to="/agent">
            Open Filey AI <ArrowUpRight size={15} />
          </Link>
        }
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act("open");
        }}
        className="flex items-end gap-2"
      >
        <label className="min-w-0 flex-1">
          <span className="label">Website address</span>
          <input
            className="input"
            autoComplete="url"
            inputMode="url"
            placeholder="https://www.instagram.com"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={busy}
          />
        </label>
        <button className="btn-primary" disabled={busy}>
          {busy ? "Opening…" : supported ? "Open in Filey" : "Open website"}
          <ArrowUpRight size={15} />
        </button>
      </form>
      {error && <ErrorBanner message={error} />}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      <p className="max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
        {supported
          ? "Websites open in separate Filey browser windows. Sign in yourself; your browser sessions stay with this account and workspace on this device. Local/cloud switching keeps those logins."
          : "The Windows app includes dedicated browser windows with separate workspace logins. This web preview opens websites in your own browser."}{" "}
        Filey AI can operate a browser window after you enable temporary computer access
        in the chat.
      </p>
      {supported && (
        <section
          aria-label="Open browser windows"
          className="rounded-xl border border-border bg-card"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">
              Open windows{" "}
              <span className="ml-1 font-normal text-muted-foreground">
                {tabs.length} / 8
              </span>
            </h2>
            {tabs.length > 0 && (
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() => void act("close_all")}
              >
                Close all
              </button>
            )}
          </div>
          {!tabs.length ? (
            <div className="p-6 text-center">
              <Globe size={22} className="mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium">Open your first website</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Use an address above or choose a business app below.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {tabs.map((tab) => (
                <li key={tab.id} className="flex flex-wrap items-center gap-3 p-4">
                  <button
                    className="min-w-0 flex-1 basis-64 text-left"
                    onClick={() => void act("focus", tab.id)}
                    disabled={busy}
                  >
                    <span className="block truncate text-sm font-medium">
                      {tab.title || "Browser window"}
                      {tab.loading ? " · Loading…" : ""}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {tab.url}
                    </span>
                  </button>
                  <div className="flex items-center gap-1">
                    {(
                      [
                        {
                          action: "back",
                          label: "Back",
                          Icon: ArrowLeft,
                          disabled: !tab.canGoBack,
                        },
                        {
                          action: "forward",
                          label: "Forward",
                          Icon: ArrowRight,
                          disabled: !tab.canGoForward,
                        },
                        {
                          action: tab.loading ? "stop" : "reload",
                          label: tab.loading ? "Stop loading" : "Reload",
                          Icon: tab.loading ? Square : RefreshCw,
                          disabled: false,
                        },
                        { action: "close", label: "Close", Icon: X, disabled: false },
                      ] as const
                    ).map(({ action, label, Icon, disabled }) => (
                      <button
                        key={action}
                        className="btn-ghost w-10 !px-0"
                        title={`${label} ${tab.title || "window"}`}
                        aria-label={`${label} ${tab.title || "window"}`}
                        disabled={busy || disabled}
                        onClick={() => void act(action, tab.id)}
                      >
                        <Icon size={15} />
                      </button>
                    ))}
                  </div>
                  {tab.blockedPopupUrl && (
                    <p className="w-full break-all text-xs text-muted-foreground">
                      This site requested another window. Review the address before
                      opening: {tab.blockedPopupUrl}
                    </p>
                  )}
                  {tab.warning && (
                    <p role="status" className="w-full text-xs text-muted-foreground">
                      {tab.warning}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section aria-label="Business websites">
        <h2 className="mb-3 text-sm font-semibold">Your everyday apps</h2>
        <div className="divide-y divide-border border-y border-border">
          {SITES.map((site) => (
            <div className="flex flex-wrap items-center gap-3 py-4" key={site.name}>
              <div className="min-w-0 flex-1 basis-52">
                <h3 className="text-[13px] font-medium">{site.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{site.purpose}</p>
              </div>
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() => void act("open", undefined, site.url)}
                aria-label={`Open ${site.name}`}
              >
                Open <ArrowUpRight size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="flex flex-wrap items-start gap-5 border-t border-border pt-5">
        <div className="min-w-0 flex-1 basis-72">
          <h2 className="text-sm font-semibold">Let Filey prepare the work</h2>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
            Research an idea, prepare a caption or invoice, then review it before
            publishing or sending. Opening a website does not connect an API or publish
            anything.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="btn-secondary"
            to="/agent"
            state={{
              draft:
                "Help me prepare an Instagram post for my business. Ask what I want to promote, use my product facts, suggest a caption and suitable licensed images. Open Instagram in Filey's browser when ready. Let me review the content and selected account before publishing.",
            }}
          >
            Prepare a social post
          </Link>
          <Link className="btn-ghost" to="/invoicing">
            Share an invoice
          </Link>
          <Link className="btn-ghost" to="/integrations?tab=services">
            Free work services
          </Link>
        </div>
      </section>
    </div>
  );
}
