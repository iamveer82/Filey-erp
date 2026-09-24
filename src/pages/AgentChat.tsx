import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Mic,
  Plus,
  Zap,
  Paperclip,
  X,
  Download,
  FolderOpen,
  Brain,
  Trash2,
  ShieldAlert,
  ArrowUp,
  FileText,
  History,
  PanelLeftClose,
  Search,
  CalendarClock,
  BookOpen,
  SlidersHorizontal,
  Copy,
  Check,
  Square,
  Settings2,
  Film,
  MoreHorizontal,
} from "lucide-react";
import BloubBot from "../components/BloubBot";
import PaperMark from "../components/PaperMark";
import ThinkingDots from "../components/ThinkingDots";
import AgentRunProgress from "../components/AgentRunProgress";
import { VideoJobCard } from "../components/AgentVideoPanel";
import AgentMediaPanel, { MediaJobCard } from "../components/AgentMediaPanel";
import { AgentAccessControl, AgentEffortControl } from "../components/AgentComposerControls";
import AiFundingControl, { useAiFunding } from "../components/AiFundingControl";
import { getActiveAiConfig } from "../lib/ai";
import { aiEffortLevels, EFFORT_LABELS, type AiEffort } from "../lib/aiEndpoint";
import { getBrowserPanelState, subscribeBrowserPanel, setBrowserPanelOpen, selectAgentBrowser } from "../lib/desktopBrowser";
import { enableComputerUse, disableComputerUse } from "../lib/computerUse";
import { AGENT_STORAGE_EVENT, agentStorageScope, readAgentStorage, writeAgentStorage } from "../lib/agentStorage";
import { botExpressionFor, botStateFor } from "../lib/botMood";
import { GitBranch, Globe } from "lucide-react";
import { getReachConfig, setReachConfig } from "../lib/reach";
import Markdown from "../components/Markdown";
import { openFolder } from "../lib/localPaths";
import { ErrorBanner, Modal } from "../components/ui";
import AutomationsDrawer from "../components/AutomationsDrawer";
import SkillsDrawer from "../components/SkillsDrawer";
import CapabilitiesDrawer from "../components/CapabilitiesDrawer";
import { skillsIndex } from "../lib/agentSkills";
import { buildAiContext } from "../lib/aiContext";
import { getAgentMode, setAgentMode, type AgentMode } from "../lib/agentMode";
import { isToolAllowed } from "../lib/capabilities";
import {
  aiAgentStream,
  aiAutonomousStream,
  aiReady,
  AiError,
  buildSystemPrompt,
  getPersona,
  type AiMessage,
  type AiImage,
} from "../lib/ai";
import {
  memoryDigest,
  listMemories,
  deleteMemory,
  clearMemories,
  type Memory,
} from "../lib/aiMemory";
import {
  setTurnFiles,
  setToolConfirm,
  endTurn,
  approvalArgs,
  type FileOutput,
} from "../lib/aiTools";
import { fileToImage } from "../lib/docScan";
import { MenuPopover, MenuItemRow, MenuSep } from "../components/ui-menu";
import {
  loadChats,
  saveChats,
  setActiveId,
  newChat,
  resolveOpeningChat,
  deriveTitle,
  TURN_CAP,
  type Chat,
  type ChatTurn,
} from "../lib/aiChats";
import { cn } from "../lib/format";
import { startDictation, speechRecognitionSupported } from "../lib/voice";
import {
  hasDesktop as waHasDesktop,
  bridgeState,
  onBridgeState,
  type BridgeState,
} from "../lib/waBridge";
import "./AgentChat.css";

/* Filey's conversation workspace. Conversational mode runs
 * the standard tool-calling agent; the "Autonomous" toggle hands a goal to
 * aiAutonomous (plan → act → verify → finish) and streams the steps live. */

const SYSTEM =
  "You are Filey, the user's AI business agent with full control of their ERP app via tools — you can read AND modify: stats, customers, products, invoices, quotes, orders, purchase orders, expenses, attendance, files, and navigation. You have long-term memory: use `remember` to save durable facts/preferences and `recall` to look them up. When asked to do something, execute the tool and confirm in one short line. Money/outbound actions require user approval. Never invent data — look it up. Be concise and practical.";

/** Width both halves of the conversation share — messages and the composer sit
 *  on one measure so long replies don't stretch wider than where you type. */
const COLUMN = "mx-auto w-full max-w-[760px]";

/* The bot draws in the accent colour directly — see BloubBot — so nothing here
   re-tints it. The old orb was grayscale and needed a filter stack to fake one. */

export default function AgentChat() {
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
  return <AgentWorkspace key={scope ?? "signed-out"} scope={scope} />;
}

function AgentWorkspace({ scope }: { scope: string | null }) {
  const location = useLocation();
  const navigate = useNavigate();
  // Fresh chat per app launch, same chat within a run — see resolveOpeningChat.
  const [chat, setChat] = useState<Chat>(resolveOpeningChat);
  const [input, setInput] = useState<string>(() =>
    typeof location.state?.draft === "string" && (!location.state.draftScope || location.state.draftScope === scope) ? location.state.draft.slice(0, 4000) : ""
  );
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  /** Object URL per attached image ("" for non-images), revoked on replace. */
  const [previews, setPreviews] = useState<string[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<{
    name: string;
    args: Record<string, unknown>;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [memOpen, setMemOpen] = useState(false);
  const [mems, setMems] = useState<Memory[]>([]);
  const [histOpen, setHistOpen] = useState(false);
  const [chatList, setChatList] = useState<Chat[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const historyToggleRef = useRef<HTMLButtonElement>(null);
  const historySearchRef = useRef<HTMLInputElement>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [capsOpen, setCapsOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const [videosOpen, setVideosOpen] = useState(() => new URLSearchParams(location.search).get("video") === "1");
  const [webOn, setWebOn] = useState(getReachConfig().enabled);
  const plusRef = useRef<HTMLDivElement>(null);

  // Ctrl+U opens the file picker from anywhere on the page, as the "+" menu's
  // shortcut promises — but not while typing, where Ctrl+U belongs to the
  // browser and the field.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "u") {
        e.preventDefault();
        fileRef.current?.click();
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);

  const [dragging, setDragging] = useState(false);
  // ── Voice dictation (Web Speech API — Chromium, free, no key) ──────────
  const [listening, setListening] = useState(false);
  const dictationRef = useRef<ReturnType<typeof startDictation> | null>(null);
  const micSupported = useMemo(() => speechRecognitionSupported(), []);

  const toggleMic = () => {
    if (listening) {
      dictationRef.current?.stop();
      dictationRef.current = null;
      setListening(false);
      return;
    }
    const base = input;
    dictationRef.current = startDictation({
      onFinal: (chunk) =>
        setInput(
          (cur) => (cur === base ? "" : cur) + (cur && cur !== base ? " " : "") + chunk
        ),
      onInterim: (draft) => {
        // Live draft shows in the placeholder so the words appear as spoken
        // without churning the real value on every partial result.
        if (textareaRef.current) textareaRef.current.placeholder = draft || "Listening…";
      },
      onEnd: () => {
        setListening(false);
        dictationRef.current = null;
        if (textareaRef.current)
          textareaRef.current.placeholder =
            textareaRef.current.dataset.ph || "Message Filey AI…";
      },
      onError: (e) => {
        setListening(false);
        dictationRef.current = null;
        if (e !== "no-speech" && e !== "aborted") setErr(`Dictation failed: ${e}`);
      },
    });
    setListening(!!dictationRef.current);
  };
  // Read fresh so changes in Settings are reflected when sending.
  useAiFunding();
  const ready = aiReady();
  const modelConfig = getActiveAiConfig();
  const [mode, setMode] = useState<AgentMode>(getAgentMode);
  const [effort, setEffort] = useState<AiEffort>(() => {
    const saved = readAgentStorage("filey.agent.effort");
    return saved && Object.prototype.hasOwnProperty.call(EFFORT_LABELS, saved) ? saved as AiEffort : "auto";
  });
  const browserPanel = useSyncExternalStore(subscribeBrowserPanel, getBrowserPanelState);
  const changeEffort = (next: AiEffort) => {
    try { writeAgentStorage("filey.agent.effort", next, scope ?? undefined); setEffort(next); }
    catch { setErr("Could not save the effort setting. Try again."); }
  };
  /** The tools run so far this turn ("Looking up customers…"), shown as a chip
   *  trail while the agent works so a long turn reads as work, not a hang. */
  const [runProgress, setRunProgress] = useState<ChatTurn["run"]>();
  /** Lets the Stop button cut a run short. ponytail: on desktop the native AI
   *  proxy call itself isn't cancellable (see ai.ts), so an abort stops the
   *  agent between rounds rather than mid-request — which is what "stop doing
   *  more work" means to the person clicking it. */
  const abortRef = useRef<AbortController | null>(null);
  /** Mirrors the streamed text for the catch block — reading the state there
   *  would get the value from the render that started the run, not the latest. */
  const streamedRef = useRef("");
  const endRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!scope) return;
    const selectBrowser = (event?: Event) => {
      const key = (event as CustomEvent<{ key?: string }> | undefined)?.detail?.key;
      if (key && key !== "filey.agent.capabilities") return;
      void selectAgentBrowser(isToolAllowed("agent_computer") ? chat.id : null).catch(error => {
        if (error?.name !== "AbortError") setErr("Could not switch the browser workspace. Close its tabs and try again.");
      });
    };
    selectBrowser();
    window.addEventListener(AGENT_STORAGE_EVENT, selectBrowser);
    return () => window.removeEventListener(AGENT_STORAGE_EVENT, selectBrowser);
  }, [chat.id, scope]);

  useEffect(() => {
    const stopBrowser = () => { abortRef.current?.abort(); pendingRef.current?.resolve(false); pendingRef.current = null; setPendingConfirm(null); };
    window.addEventListener("filey:stop-agent-browser", stopBrowser);
    return () => window.removeEventListener("filey:stop-agent-browser", stopBrowser);
  }, []);


  // Attach a file + build an image preview (revoking the previous one).
  /** Attach one or more files. Several at once is the point: "merge these"
   *  means the user drops all the PDFs on the composer and the agent runs
   *  the merge right here. */
  const attach = (list: File[] | null) => {
    const next = (list ?? []).filter(Boolean);
    setPreviews((prev) => {
      prev.filter(Boolean).forEach((u) => URL.revokeObjectURL(u));
      return next.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : ""));
    });
    setFiles(next);
  };

  // Auto-grow the textarea up to a cap — tall enough for a real brief, short
  // enough that it never crowds the conversation off the screen.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  // Route the agent's sensitive-action approvals through an in-app modal
  // instead of the browser's native confirm() while this page is mounted.
  // pendingRef mirrors pendingConfirm so unmount cleanup can settle whatever
  // is on screen: leaving with the dialog up used to strand its resolver
  // unreached — the awaiting runTool promise (and the whole turn) hung forever.
  const pendingRef = useRef<{ resolve: (ok: boolean) => void } | null>(null);
  useEffect(() => {
    setToolConfirm(
      (name, args) =>
        new Promise<boolean>((resolve) => {
          const pc = { name, args, resolve };
          pendingRef.current = pc;
          setPendingConfirm(pc);
        })
    );
    return () => {
      abortRef.current?.abort();
      void disableComputerUse().catch(() => {});
      pendingRef.current?.resolve(false); // deny rather than hang
      pendingRef.current = null;
      setPendingConfirm(null);
      setToolConfirm((n) =>
        typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm(`Allow the assistant to run "${n}"?`)
          : false
      );
    };
  }, []);

  /** Settle the dialog one way or the other. The ref is cleared alongside the
   *  state so cleanup can never double-resolve a stale entry. */
  const settleConfirm = (ok: boolean) => {
    pendingConfirm?.resolve(ok);
    pendingRef.current = null;
    setPendingConfirm(null);
  };

  // Persist the conversation (shared store with the popover copilot).
  useEffect(() => {
    if (!chat.turns.length || !scope || agentStorageScope() !== scope) return;
    const rest = loadChats().filter((c) => c.id !== chat.id);
    saveChats(
      [{ ...chat, title: deriveTitle(chat.turns), updatedAt: Date.now() }, ...rest],
      scope
    );
    setActiveId(chat.id);
  }, [chat, scope]);

  // The rail lists every stored chat, so re-read the store whenever the active
  // chat changes — the persist effect above writes, this is what sees it.
  useEffect(() => {
    setChatList(loadChats().sort((a, b) => b.updatedAt - a.updatedAt));
  }, [chat]);

  // Warm the business brief while the user is still typing. Building it reads
  // five whole tables (customers, every invoice with its items and payments,
  // products, quotes, orders), and send() awaits it before the agent can start
  // — so on a cold memo the first message just sat there. Doing it on mount
  // moves that wait into the time someone spends composing. Fire-and-forget:
  // it only populates the shared 60s memo, and send() still awaits properly if
  // this hasn't finished.
  useEffect(() => {
    if (!videosOpen) buildAiContext().catch(() => {});
  }, [videosOpen]);

  useEffect(() => {
    if (videosOpen) topRef.current?.scrollIntoView({ block: "start" });
  }, [videosOpen]);

  // Opening a chat must not animate. A smooth scroll on mount — with the
  // sentinel aligned to the *top* of the viewport, which is scrollIntoView's
  // default — parks the page mid-scroll, so the chat reads as already scrolled
  // up. On mount: jump straight to the foot of an existing conversation, and
  // put a fresh one at the top (the scroll position carries over from whatever
  // page you came from otherwise). After that, follow new turns smoothly, and
  // anchor to `end` so the newest message sits at the bottom, not the top.
  const mounted = useRef(false);
  useEffect(() => {
    if (videosOpen) return;
    if (!mounted.current || !chat.turns.length) {
      mounted.current = true;
      const atFoot = chat.turns.length > 0;
      (atFoot ? endRef.current : topRef.current)?.scrollIntoView({
        block: atFoot ? "end" : "start",
      });
      return;
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    // Only real turns animate. `streaming` used to be in here too, which
    // restarted a *smooth* scroll on every streamed step — a fresh easing
    // animation several times a second, which WebView2 renders as the whole
    // app locking up while the agent is answering.
  }, [chat.turns, busy, videosOpen]);

  // Following the stream is a separate, much cheaper job: jump (no easing) and
  // only while the reader is already at the bottom, so scrolling up to re-read
  // something isn't yanked back on the next step.
  useEffect(() => {
    if (!streaming || !mounted.current || videosOpen) return;
    const scroller = topRef.current?.closest("main");
    const nearFoot = scroller
      ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 120
      : window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 120;
    if (!nearFoot) return;
    // rAF coalesces bursts into one scroll per frame instead of one per step.
    const id = requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ block: "end" });
    });
    return () => cancelAnimationFrame(id);
  }, [streaming, videosOpen]);

  /** Stop the run. The catch in send() turns the abort into a kept partial
   *  reply rather than an error banner. */
  const stop = () => {
    abortRef.current?.abort();
    pendingRef.current?.resolve(false);
    pendingRef.current = null;
    setPendingConfirm(null);
    void disableComputerUse().catch(() => {});
  };

  const startNew = () => {
    if (busy) return;
    const c = newChat();
    setChat(c);
    setActiveId(c.id);
    setErr(null);
    setStreaming("");
    setRunProgress(undefined);
  };

  const send = async (raw: string) => {
    const q = raw.trim();
    const attached = files;
    if ((!q && !attached.length) || busy) return;
    if (!ready) {
      setErr(
        modelConfig.billing ? "Choose a model in the AI model selector below to start this conversation." : "Choose a local model or connect your provider in AI settings to start this conversation."
      );
      return;
    }
    setErr(null);
    setInput("");
    attach(null); // clears the files AND revokes the preview object URL

    const names = attached.map((f) => `📎 ${f.name}`).join("\n");
    const shownText = attached.length ? `${q}${q ? "\n\n" : ""}${names}` : q;
    // Explicit hint so the agent knows it can work on the attached files via
    // tools — several at once, in attachment order.
    const fileList = attached.map((f) => `"${f.name}"`).join(", ");
    const goalText = attached.length
      ? `${q || "Process the attached file."}\n\n[${
          attached.length === 1 ? "A file" : `${attached.length} files`
        } ${attached.length === 1 ? "is" : "are"} attached: ${fileList}. Use run_file_tool to edit/convert/merge them (multiple attachments arrive in order), or read_attached_document to act on their contents. Deliver the result here — do not send the user to the Tools page.]`
      : q;
    // This turn's slot in the file toolbox: the attachment in, produced files
    // out. Scoped per turn so a popover run mid-flight can't swap this one's
    // file, and this turn's outputs can't surface under another reply.
    const turnId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const withUser: Chat = {
      ...chat,
      turns: [...chat.turns, { role: "user", text: shownText }],
    };
    setChat(withUser);
    setBusy(true);
    setRunProgress(undefined);
    setStreaming(auto ? "Planning…" : "");
    const ctl = new AbortController();
    abortRef.current = ctl;

    // Make the files available to run_file_tool; convert images for vision.
    setTurnFiles(turnId, attached);
    const firstImage = attached.find((f) => f.type.startsWith("image/"));
    let images: AiImage[] | undefined;
    if (firstImage) {
      try {
        images = [await fileToImage(firstImage)];
      } catch {
        /* non-fatal — the agent can still run file tools on it */
      }
    }

    /** Files this turn produced, drained exactly once in finally — success,
     *  stop or error — so they always land with THIS message and never leak
     *  into whichever turn ends next. */
    let made: FileOutput[] = [];
    let computerSessionId: number | undefined;
    const computerSession = async () => {
      ctl.signal.throwIfAborted();
      if (!scope || scope !== agentStorageScope())
        throw new DOMException("Workspace changed. Computer access stopped.", "AbortError");
      // Start automatically after approval; opening chat needs no native grant.
      computerSessionId ??= await enableComputerUse();
      if (ctl.signal.aborted) {
        await disableComputerUse(computerSessionId);
        ctl.signal.throwIfAborted();
      }
      return computerSessionId;
    };
    const trace: NonNullable<ChatTurn["run"]> = { plan: [], actions: [] };
    try {
      let reply = "";
      const brief = await buildAiContext().catch(() => "");
      ctl.signal.throwIfAborted();
      const history: AiMessage[] = chat.turns
        .slice(-TURN_CAP)
        .map((t) => ({ role: t.role, text: t.text }));
      const messages: AiMessage[] = [
        {
          role: "system",
          text: buildSystemPrompt(
            SYSTEM,
            getPersona(),
            [memoryDigest(12, goalText), skillsIndex(), brief]
              .filter(Boolean)
              .join("\n\n")
          ),
        },
        ...history,
        { role: "user", text: goalText, images },
      ];
      // Trusted interactive user; organization permissions remain enforced by the data API.
      const selectedEffort = aiEffortLevels(getActiveAiConfig()).includes(effort) ? effort : "auto";
      const options = { isOwner: !!scope, signal: ctl.signal, turnId, agentId: chat.id, maxTokens: 4096, effort: selectedEffort, computerSession };
      const stream = auto
        ? aiAutonomousStream(goalText, { ...options, history, images })
        : aiAgentStream(messages, options);
      try {
        for (;;) {
          const step = await stream.next();
          if (step.done) {
            reply = step.value;
            break;
          }
          const ev = step.value;
          if (ev.type === "text" && ev.text) {
            streamedRef.current = streamedRef.current
              ? `${streamedRef.current}\n\n${ev.text}`
              : ev.text;
            setStreaming(streamedRef.current);
          } else if (ev.type === "plan") {
            trace.plan = ev.steps;
          } else if (ev.type === "tool_call" && ev.name !== "update_plan") {
            trace.actions = [
              ...trace.actions,
              { id: ev.id, name: ev.name, status: "running" as const },
            ].slice(-80);
          } else if (ev.type === "tool_result") {
            const failed = !!(
              ev.result &&
              typeof ev.result === "object" &&
              "error" in ev.result
            );
            const waiting = !!(ev.result && typeof ev.result === "object" && "pending_action" in ev.result && ev.result.pending_action);
            const at = trace.actions.map((a) => a.id).lastIndexOf(ev.id);
            trace.actions = trace.actions.map((a, i) =>
              i === at
                ? { ...a, status: failed ? ("failed" as const) : waiting ? ("waiting" as const) : ("completed" as const) }
                : a
            );
          } else if (ev.type === "done") {
            trace.outcome = ev.reason;
          }
          setRunProgress({ ...trace });
        }
      } finally {
        await stream.return("");
      }
      // Files belong to the message that produced them. They used to live in
      // one shared slot above the composer, so asking a second question threw
      // away the first answer's output.
      made = endTurn(turnId);
      setChat((c) => ({
        ...c,
        turns: [
          ...c.turns,
          {
            role: "assistant",
            text: reply,
            run: { ...trace },
            ...(made.length ? { files: made } : {}),
          },
        ],
      }));
    } catch (e) {
      // A stop the user asked for is not an error. Whatever the agent had
      // already said is kept as the reply — throwing it away would punish them
      // for interrupting, which is the opposite of what the button is for.
      if (ctl.signal.aborted) {
        const partial = streamedRef.current.trim();
        const stoppedFiles = endTurn(turnId);
        setChat((c) => ({
          ...c,
          turns: [
            ...c.turns,
            {
              role: "assistant",
              text: partial ? `${partial}\n\n_Stopped._` : "_Stopped._",
              run: { ...trace, outcome: "stopped" },
              ...(stoppedFiles.length ? { files: stoppedFiles } : {}),
            },
          ],
        }));
      } else {
        const failedFiles = endTurn(turnId);
        setErr(e instanceof AiError || e instanceof Error ? e.message : String(e));
        if (trace.actions.length || streamedRef.current || failedFiles.length)
          setChat((c) => ({
            ...c,
            turns: [
              ...c.turns,
              {
                role: "assistant",
                text:
                  streamedRef.current ||
                  "The task stopped before finishing. Review the actions below before trying again.",
                run: { ...trace, outcome: "error" },
                ...(failedFiles.length ? { files: failedFiles } : {}),
              },
            ],
          }));
      }
    } finally {
      ctl.abort(new DOMException("Task completed", "AbortError"));
      endTurn(turnId); // no-op when already drained above — never leaks
      abortRef.current = null;
      streamedRef.current = "";
      setBusy(false);
      setStreaming("");
      setRunProgress(undefined);
    }
  };

  const openMemory = () => {
    setMems(listMemories());
    setMemOpen(true);
  };
  const removeMem = (id: string) => {
    deleteMemory(id);
    setMems(listMemories());
  };
  const wipeMem = () => {
    clearMemories();
    setMems([]);
  };

  const openHistory = () => {
    setChatList(loadChats().sort((a, b) => b.updatedAt - a.updatedAt));
    setHistOpen(v => !v);
    if (!histOpen) requestAnimationFrame(() => historySearchRef.current?.focus());
  };
  const closeHistory = () => { setHistOpen(false); requestAnimationFrame(() => historyToggleRef.current?.focus()); };
  const switchChat = (c: Chat) => {
    if (busy) return;
    setChat(c);
    setActiveId(c.id);
    setErr(null);
    setStreaming("");
    if ((workspaceRef.current?.clientWidth ?? 0) < 720) closeHistory();
  };
  const deleteChat = (id: string) => {
    if (busy) return;
    const next = loadChats().filter((c) => c.id !== id);
    saveChats(next);
    setChatList(next.sort((a, b) => b.updatedAt - a.updatedAt));
    if (id === chat.id) startNew();
  };

  const empty = chat.turns.length === 0;

  return (
    <div
      ref={workspaceRef}
      className="filey-agent-workspace relative flex min-w-0 flex-1 items-start gap-4"
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const dropped = Array.from(e.dataTransfer.files ?? []);
        if (dropped.length && !busy) attach(dropped);
      }}
    >
      {histOpen && <aside id="filey-chat-history" aria-label="Chat history" className="filey-chat-history sticky top-0 flex shrink-0 flex-col self-start border-r border-border pr-3"
        onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); closeHistory(); } }}>
        <div className="flex h-11 shrink-0 items-center justify-between gap-2">
          <h2 className="pl-2 text-[13px] font-medium">Chats</h2>
          <button type="button" onClick={closeHistory} className="btn-ghost w-10 !border-transparent !bg-transparent !px-0 hover:!bg-hover" aria-label="Collapse chat history" title="Collapse chat history"><PanelLeftClose size={17} /></button>
        </div>
        <button type="button" disabled={busy} onClick={() => { startNew(); if ((workspaceRef.current?.clientWidth ?? 0) < 720) closeHistory(); }} className="btn-ghost mt-2 w-full justify-start"><Plus size={16} />New chat</button>
        <label className="relative my-3 block">
          <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input ref={historySearchRef} type="search" aria-label="Search chats" placeholder="Search chats" value={historySearch} onChange={event => setHistorySearch(event.target.value)} className="input w-full !rounded-full !pl-9" />
        </label>
        {busy && <p className="px-2 pb-3 text-xs leading-relaxed text-muted-foreground">Finish or stop this reply to switch chats.</p>}
        <nav aria-label="Saved conversations" className="min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-1">
          {chatList.filter(c => (c.title || "New chat").toLowerCase().includes(historySearch.trim().toLowerCase())).map(c => <div key={c.id} className={cn("group flex items-center gap-0.5 rounded-xl hover:bg-hover", c.id === chat.id && "bg-hover")}>
            <button type="button" disabled={busy} onClick={() => switchChat(c)} aria-current={c.id === chat.id ? "page" : undefined} className="min-h-11 min-w-0 flex-1 rounded-xl px-3 py-2 text-left text-[13px] disabled:opacity-50" title={c.title || "New chat"}>
              <span className="block truncate">{c.title || "New chat"}</span>
            </button>
            <button type="button" disabled={busy} onClick={() => deleteChat(c.id)} aria-label={`Delete chat: ${c.title || "New chat"}`} className="btn-ghost w-10 shrink-0 !border-transparent !bg-transparent !px-0 text-muted-foreground hover:!text-danger"><Trash2 size={14} /></button>
          </div>)}
          {!chatList.length && <p className="px-3 py-4 text-xs leading-relaxed text-muted-foreground">Your conversations will appear here.</p>}
          {!!chatList.length && !chatList.some(c => (c.title || "New chat").toLowerCase().includes(historySearch.trim().toLowerCase())) && <p className="px-3 py-4 text-xs text-muted-foreground">No chats match your search.</p>}
        </nav>
      </aside>}
      {/* A full-width session header frames the centered conversation. */}
      <div
        ref={topRef}
        className={cn("filey-chat relative flex min-h-[calc(100dvh-10rem)] min-w-0 flex-1 flex-col", histOpen && "filey-chat-with-history")}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center rounded-xl border-2 border-dashed border-foreground/30 bg-background/85 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 text-foreground">
              <Paperclip size={24} />
              <p className="text-sm font-semibold text-foreground">
                Drop a PDF or image to attach
              </p>
            </div>
          </div>
        )}

        <header className="sticky top-0 z-30 mb-5 border-b border-border/60 bg-page pb-3 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button ref={historyToggleRef} type="button" onClick={openHistory} aria-label="Chat history" title="Chat history" aria-expanded={histOpen} aria-controls="filey-chat-history" className="btn-ghost w-10 shrink-0 !border-transparent !bg-transparent !px-0 hover:!bg-hover"><History size={17} /></button>
              <h1 className="truncate text-sm font-medium leading-tight text-foreground" title={chat.title || "Filey AI"}>
                {empty ? "Filey AI" : chat.title || "Conversation"}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
              <Link to="/settings?section=credits" className="btn-ghost !border-transparent !bg-transparent !px-3 hover:!bg-hover" aria-label="Add Paper to AI wallet" title="Paper wallet and top-ups">
                <PaperMark /><span className="filey-chat-credit-label">Add Paper</span>
              </Link>
              <button type="button" onClick={() => setBrowserPanelOpen(!browserPanel.open)}
                className="btn-ghost w-10 !border-transparent !bg-transparent !px-0 hover:!bg-hover" aria-label={browserPanel.open ? "Collapse browser" : "Open browser"} title={browserPanel.open ? "Collapse browser" : "Open browser"} aria-expanded={browserPanel.open} aria-controls="filey-browser-panel">
                <Globe size={17} />
              </button>
              <div ref={moreRef}>
                <button type="button" onClick={() => setMoreOpen(v => !v)} className="btn-ghost w-10 !border-transparent !bg-transparent !px-0 hover:!bg-hover" aria-label="Conversation options" aria-expanded={moreOpen} title="Conversation options"><MoreHorizontal size={18} /></button>
                <MenuPopover open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreRef} align="end" className="w-56">
                  <MenuItemRow icon={<Brain size={15} />} label="Memory" onClick={() => { setMoreOpen(false); openMemory(); }} />
                  <MenuItemRow icon={<Film size={15} />} label="Images and videos" onClick={() => { setMoreOpen(false); setVideosOpen(true); }} />
                  <MenuSep />
                  <MenuItemRow icon={<Settings2 size={15} />} label="AI settings" onClick={() => { setMoreOpen(false); navigate("/settings?section=ai"); }} />
                </MenuPopover>
              </div>
              <button
                type="button"
                onClick={startNew}
                disabled={busy}
                aria-label="New chat"
                title="New chat"
                className="btn-ghost w-10 !border-transparent !bg-transparent !px-0 hover:!bg-hover"
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
        </header>


        {videosOpen && <AgentMediaPanel onClose={() => setVideosOpen(false)} onDraft={job => {
          setChat(current => ({ ...current, turns: [...current.turns,
            { role: "assistant", text: job.state === "draft" ? `Review your ${job.kind}, then choose Generate to use your own provider key.` : `Here is your ${job.kind} request.`, files: [{ name: `Generated ${job.kind}`, mediaJobId: job.id }] }], updatedAt: Date.now() }));
          setVideosOpen(false);
        }} />}

        {/* The conversation and composer share one readable measure. */}
        <div
          className={cn(
            COLUMN,
            "pt-2",
            empty && !busy ? "flex flex-1 flex-col justify-center space-y-3 py-10 sm:py-16" : "flex-1 space-y-7 pb-8"
          )}
          aria-label="Conversation"
        >
          {empty && !busy ? (
            <div className="mx-auto max-w-xl text-center">
              {/* The empty chat is where the bot has room to be itself, so this
                  one animates: it breathes, blinks and looks around while it
                  waits for a first question. */}
              <div className="mx-auto mb-4 grid h-12 w-12 place-items-center">
                <BloubBot size={48} state="idle" label="Filey AI" ambient />
              </div>
              <h2 className="text-2xl font-medium leading-tight text-foreground tracking-tight">
                What shall we work on?
              </h2>
            </div>
          ) : (
            // Turns separate by spacing alone: ChatTurn carries no timestamp
            // (aiChats.ts stores none), so no time meta is invented here.
            chat.turns.map((t, i) => <Bubble key={i} turn={t} />)
          )}

          {busy && (
            <>
              <Bubble
                turn={{ role: "assistant", text: streaming || "", run: runProgress }}
                pending
              />
            </>
          )}

          {err && <ErrorBanner message={err} />}

          {/* Pairing QR, rendered from live bridge state rather than from the
              model's reply: a data URL is kilobytes of base64 that would bloat
              every subsequent turn's context, and the code refreshes on its own
              timer - this card follows it. */}
          <WhatsAppPairingCard />

          <div ref={endRef} />
        </div>

        {/* Keep the composer in flow on a short screen, sticky during a chat. */}
        <div
          className={cn("z-20 mt-auto bg-page pb-3 pt-2", !empty && "sticky bottom-0")}
        >
          <div className={COLUMN}>
            {/* A stable composer keeps Stop readable while a reply is running. */}
            <div className="rounded-2xl border border-border bg-card p-2.5 transition-colors duration-150 motion-reduce:transition-none focus-within:border-muted-foreground/60 sm:p-3">
              {/* Attachment chips — one tile per file, remove always visible
                  (hover-only removal hides the affordance on touch). Several
                  files at once is the merge flow: the order shown is the order
                  the tools receive. */}
              {files.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {files.map((f, i) => {
                    const preview = previews[i] || null;
                    return (
                      <div
                        key={`${f.name}-${i}`}
                        className="flex max-w-full items-center gap-2 rounded-xl border border-border bg-muted/50 p-1.5"
                      >
                        {preview ? (
                          <img
                            src={preview}
                            alt={f.name}
                            className="h-10 w-10 rounded-[8px] object-cover"
                            title={f.name}
                          />
                        ) : (
                          <div
                            className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-card"
                            title={`${f.name} · ${Math.max(1, Math.ceil(f.size / 1024))} KB`}
                          >
                            <FileText size={16} className="text-muted-foreground" />
                          </div>
                        )}
                        <span className="min-w-0 flex-1 text-xs text-foreground">
                          <span className="block max-w-[180px] truncate" title={f.name}>
                            {f.name}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {i + 1} · {Math.max(1, Math.ceil(f.size / 1024))} KB
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => attach(files.filter((_, j) => j !== i))}
                          aria-label={`Remove ${f.name}`}
                          disabled={busy}
                          className="btn-ghost w-10 !px-0 shrink-0"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Input */}
              <textarea
                ref={textareaRef}
                aria-label="Message Filey AI"
                aria-describedby="filey-message-hint"
                data-ph={auto ? "Describe a task to delegate…" : "Ask Filey to do something…"}
                rows={1}
                value={input}
                disabled={busy}
                placeholder={auto ? "Describe a task to delegate…" : "Ask Filey to do something…"}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                onPaste={(e) => {
                  // Screenshot straight into the composer, like the reference
                  // input: an image on the clipboard is almost always meant
                  // for the agent to look at.
                  const img = Array.from(e.clipboardData.files).find((f) =>
                    f.type.startsWith("image/")
                  );
                  if (img) {
                    e.preventDefault();
                    attach([img]);
                  }
                }}
                /*
                 * No focus ring on the composer: the global :focus-visible rule
                 * paints an amber ring, and a textarea matches it on every
                 * click - a yellow box around the thing you type in. Focus is
                 * still shown, by the wrapper's border darkening.
                 */
                className="max-h-[160px] min-h-[48px] w-full resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed text-foreground outline-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground"
                autoFocus={!videosOpen && typeof matchMedia !== "undefined" && matchMedia("(pointer: fine)").matches}
              />

              {/* Action bar — one circular cluster, reference-style: the same
                  8×8 round slot carries attach, toggles, and send, so the eye
                  reads one row of controls instead of mixed shapes. */}
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <div className="relative shrink-0" ref={plusRef}>
                  <button
                    type="button"
                    onClick={() => setPlusOpen((v) => !v)}
                    disabled={busy}
                    aria-label="Add to message"
                    aria-expanded={plusOpen}
                    title="Add files, repos, skills — Ctrl+U for files"
                    className="btn-ghost w-10 !border-transparent !bg-transparent !px-0 hover:!bg-hover"
                  >
                    <Plus size={18} />
                  </button>

                  <MenuPopover
                    open={plusOpen}
                    onClose={() => setPlusOpen(false)}
                    anchorRef={plusRef}
                    side="top"
                    className="w-[248px]"
                  >
                    {/* Group 1: things that attach content */}
                    <MenuItemRow
                      icon={<Paperclip size={14} />}
                      label="Add files or photos"
                      hint="Ctrl+U"
                      onClick={() => {
                        setPlusOpen(false);
                        fileRef.current?.click();
                      }}
                    />
                    <MenuItemRow
                      icon={<GitBranch size={14} />}
                      label="Add from GitHub"
                      onClick={() => {
                        setPlusOpen(false);
                        setInput("Read this GitHub repo and tell me what it does: ");
                      }}
                    />

                    <MenuSep />

                    {/* Group 2: agent capabilities */}
                    <MenuItemRow
                      icon={<BookOpen size={14} />}
                      label="Skills"
                      chevron
                      onClick={() => {
                        setPlusOpen(false);
                        setSkillsOpen(true);
                      }}
                    />
                    <MenuItemRow
                      icon={<CalendarClock size={14} />}
                      label="Automations"
                      chevron
                      onClick={() => {
                        setPlusOpen(false);
                        setAutoOpen(true);
                      }}
                    />
                    <MenuItemRow
                      icon={<SlidersHorizontal size={14} />}
                      label="Agent access"
                      chevron
                      onClick={() => {
                        setPlusOpen(false);
                        setCapsOpen(true);
                      }}
                    />

                    <MenuSep />

                    {/* Group 3: live toggles */}
                    <MenuItemRow icon={<Zap size={14} />} label="Autonomous mode" checked={auto}
                      onClick={() => { setAuto(v => !v); setPlusOpen(false); }} />
                    <MenuItemRow
                      icon={<Globe size={14} />}
                      label="Web research"
                      checked={webOn}
                      onClick={() => {
                        const next = !webOn;
                        setReachConfig({ enabled: next });
                        setWebOn(next);
                        if (!next) setPlusOpen(false);
                      }}
                    />
                  </MenuPopover>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  disabled={busy}
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    attach(Array.from(e.target.files ?? []));
                    e.target.value = ""; // allow re-selecting the same file
                  }}
                />
                <AgentAccessControl mode={mode} disabled={busy} onCapabilities={() => setCapsOpen(true)} onChange={next => {
                  setAgentMode(next);
                  const saved = getAgentMode(); setMode(saved);
                  if (saved !== next) setErr("Could not save the access mode. Your previous selection is unchanged.");
                }} />
                {/* Autonomous changes how a task runs, not its access permissions. */}
                {auto && <button
                  type="button"
                  onClick={() => setAuto(false)}
                  disabled={busy}
                  aria-label="Autonomous mode"
                  aria-pressed={auto}
                  title="Autonomous mode: hand the agent a goal and it plans, acts and verifies on its own."
                  className={cn(
                    "btn-ghost shrink-0",
                    auto
                      ? "!border-primary-400/50 !bg-primary-400/15 text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  <Zap
                    size={13}
                    className={cn(
                      "shrink-0 transition-transform duration-200 motion-reduce:transition-none",
                      auto && "rotate-12 text-primary-600 dark:text-primary-400"
                    )}
                  />
                  Autonomous
                </button>}
                <div className="ml-auto flex max-w-full flex-wrap items-center gap-1">
                <AiFundingControl disabled={busy} compact />
                <AgentEffortControl config={modelConfig} value={effort} disabled={busy} onChange={changeEffort} />
                {/* Mic — dictation straight into the composer. Browser engine
                    (Chromium WebView2), free, no key. Hidden where the browser
                    doesn't ship SpeechRecognition. */}
                {micSupported && !busy && (
                  <button
                    type="button"
                    onClick={toggleMic}
                    disabled={busy}
                    aria-label={listening ? "Stop dictation" : "Start dictation"}
                    aria-pressed={listening}
                    title={listening ? "Stop dictation" : "Dictate (speech-to-text)"}
                    className={cn(
                      "btn-ghost w-10 !border-transparent !px-0 shrink-0",
                      listening
                        ? "bg-danger/15 text-danger animate-pulse"
                        : "text-muted-foreground hover:bg-hover hover:text-foreground"
                    )}
                  >
                    <Mic size={15} />
                  </button>
                )}
                {/* One button, three states — empty ghost, ready amber,
                    streaming stop — exactly like the reference input. Stop is
                    ink on purpose: an interrupt is not what amber invites. */}
                {busy ? (
                  <button
                    type="button"
                    onClick={stop}
                    aria-label="Stop generating"
                    title="Stop"
                    className="btn-secondary w-10 !px-0 shrink-0"
                  >
                    <Square size={12} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void send(input)}
                    disabled={!input.trim() && !files.length}
                    aria-label="Send message"
                    title="Send (Enter)"
                    className={cn(
                      "btn-primary w-10 !px-0 shrink-0",
                      input.trim() || files.length
                        ? "bg-primary-400 text-zinc-900 hover:bg-primary-500"
                        : "bg-transparent text-muted-foreground"
                    )}
                  >
                    <ArrowUp size={16} />
                  </button>
                )}
                </div>
              </div>
            </div>
            <p id="filey-message-hint" className="mt-2 px-1 text-center text-[11px] text-muted-foreground">
              Enter to send · Shift+Enter for a new line
            </p>
          </div>
        </div>

        {/* Closing an approval always resolves the waiting tool as denied. */}
        {pendingConfirm && (
          <Modal open onClose={() => settleConfirm(false)} title="Approve action">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <ShieldAlert size={18} className="shrink-0 text-warning" />
              <span>
                The assistant wants to run{" "}
                <b className="text-foreground">{pendingConfirm.name}</b>. This can change
                data or send something out.
              </span>
            </p>
            {Object.keys(pendingConfirm.args).length > 0 && (
              <pre className="mt-3 max-h-60 overflow-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                {JSON.stringify(
                  approvalArgs(pendingConfirm.name, pendingConfirm.args),
                  null,
                  2
                )}
              </pre>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
              <button
                className="btn-ghost"
                autoFocus
                onClick={() => settleConfirm(false)}
              >
                Deny
              </button>
              <button className="btn-primary" onClick={() => settleConfirm(true)}>
                Allow
              </button>
            </div>
          </Modal>
        )}

        <Modal open={memOpen} onClose={() => setMemOpen(false)} title="Agent memory">
          {mems.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing learned yet. The agent saves durable facts and preferences here as
              you chat.
            </p>
          ) : (
            <div className="space-y-2">
              {mems.map((m) => (
                <div
                  key={m.id}
                  className="flex items-start gap-3 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0 flex-1 break-words text-sm text-foreground">
                    {m.tag && (
                      <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {m.tag}
                      </span>
                    )}
                    {m.text}
                  </div>
                  <button
                    onClick={() => removeMem(m.id)}
                    aria-label={`Forget: ${m.text}`}
                    className="btn-ghost w-10 !px-0 shrink-0 text-danger"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            {mems.length > 0 && (
              <button className="btn-ghost text-danger" onClick={wipeMem}>
                Clear all memory
              </button>
            )}
            <button className="btn-ghost" onClick={() => setMemOpen(false)}>
              Close
            </button>
          </div>
        </Modal>

        <AutomationsDrawer open={autoOpen} onClose={() => setAutoOpen(false)} />
        <SkillsDrawer open={skillsOpen} onClose={() => setSkillsOpen(false)} />
        <CapabilitiesDrawer
          open={capsOpen}
          onClose={() => {
            setCapsOpen(false);
            setMode(getAgentMode());
          }}
        />
      </div>
    </div>
  );
}

/** Copy a reply. Shows "Copied" for a moment — without that the click has no
 *  visible result at all and people click it twice. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => {
            /* clipboard blocked — nothing useful to say about it */
          }
        );
      }}
      aria-label="Copy reply"
      className="btn-ghost text-muted-foreground"
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Bubble({ turn, pending }: { turn: ChatTurn; pending?: boolean }) {
  if (turn.role === "user") {
    // A quiet right-aligned film, not a filled balloon: the user's words stay
    // readable ink on a tint, so the assistant's plain prose remains the page's
    // dominant voice.
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-hover px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground">
          {turn.text}
        </div>
      </div>
    );
  }
  return (
    <div className="group/msg flex gap-3">
      {/* The bot is the assistant's face. Only the turn in flight animates:
          every earlier reply keeps its avatar as a still frame, so a long chat
          doesn't run one animation loop per message. */}
      <div className="grid h-[52px] w-[52px] shrink-0 place-items-center">
        <BloubBot
          size={52}
          animate={!!pending}
          ambient
          state={botStateFor(pending ? "thinking" : "idle")}
          expression={botExpressionFor(pending ? "thinking" : "idle")}
        />
      </div>
      {/* Plain text on the background, full measure: boxing every answer as a
          card frames two-line confirmations like documents. 14px separates the
          agent's voice from the 13px working density everywhere else. */}
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-[14px] leading-relaxed text-foreground",
            pending && "text-muted-foreground"
          )}
        >
          {/* Markdown, not raw text: the model writes **bold**, bullets and
              fenced code, and every one of those used to show as punctuation. */}
          {turn.text ? (
            <Markdown text={turn.text} />
          ) : (
            // Nothing streamed yet: the three dots stand in for words, matching
            // the thought trail the bot's face is wearing at that same moment.
            <ThinkingDots className="text-muted-foreground" />
          )}
          {pending && turn.text && (
            <span className="ml-1 inline-block animate-pulse">▍</span>
          )}
        </div>
        <AgentRunProgress run={turn.run} pending={pending} />
        {!pending && turn.text.trim() && (
          <div className="mt-3 flex">
            <CopyButton text={turn.text} />
          </div>
        )}
        {!!turn.files?.length && (
          <div className="mt-2 flex flex-wrap gap-2">
            {turn.files.map((f, i) =>
              // Desktop: the file is already on disk, so open it where it
              // landed. Browser: hand over the blob as a real download.
              f.mediaJobId ? <MediaJobCard key={f.mediaJobId} id={f.mediaJobId} /> : f.videoJobId ? <VideoJobCard key={f.videoJobId} id={f.videoJobId} /> : f.path ? (
                <button
                  key={i}
                  type="button"
                  title={f.path}
                  onClick={() => void openFolder(f.path!)}
                  className="btn-ghost max-w-full"
                >
                  <FolderOpen size={12} />
                  <span className="max-w-[200px] truncate">{f.name}</span>
                </button>
              ) : f.url ? (
                <a
                  key={i}
                  href={f.url}
                  download={f.name}
                  className="btn-ghost max-w-full"
                >
                  <Download size={12} />
                  <span className="max-w-[200px] truncate">{f.name}</span>
                </a>
              ) : null
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** WhatsApp pairing QR, shown in the conversation while one is live. Driven by
 *  the bridge supervisor, so it appears when the agent starts the bridge and
 *  disappears the moment the code is scanned or spent. */
function WhatsAppPairingCard() {
  const [st, setSt] = useState<BridgeState>({ state: "stopped" });

  useEffect(() => {
    if (!waHasDesktop) return;
    void bridgeState()
      .then(setSt)
      .catch(() => setSt({ state: "stopped" }));
    return onBridgeState(setSt);
  }, []);

  // Connected is the steady state — showing a bubble for it forever would just
  // be noise in the conversation. The card exists for the QR moment only.
  if (!st.qr) return null;

  return (
    <div className="flex gap-3">
      <div className="h-8 w-8 shrink-0" />
      <div className="rounded-lg border border-border bg-card p-3.5">
        <p className="mb-2 text-[13px] font-medium text-foreground">
          Scan to connect WhatsApp
        </p>
        <img
          src={st.qr}
          alt="WhatsApp pairing QR code"
          className="h-44 w-44 rounded bg-white p-1"
        />
        <p className="mt-2 max-w-[15rem] text-[12px] text-muted-foreground">
          On your phone: WhatsApp → Settings → <b>Linked devices</b> → Link a device. The
          code refreshes on its own if it expires.
        </p>
      </div>
    </div>
  );
}
