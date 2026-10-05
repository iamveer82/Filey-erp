import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  ArrowDown,
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
  SquarePen,
} from "lucide-react";
import BloubBot from "../components/BloubBot";
import CoinMark from "../components/CoinMark";
import ThinkingDots from "../components/ThinkingDots";
import AgentRunProgress from "../components/AgentRunProgress";
import AgentChatStarters from "../components/AgentChatStarters";
import { VideoJobCard } from "../components/AgentVideoPanel";
import AgentMediaPanel, { MediaJobCard } from "../components/AgentMediaPanel";
import { AgentAccessControl, AgentEffortControl } from "../components/AgentComposerControls";
import AiFundingControl, { useAiFunding } from "../components/AiFundingControl";
import { getActiveAiConfig, getFileyAiEffort, getFileyAiReasoning, setFileyAiEffort, setFileyAiReasoning } from "../lib/ai";
import { aiEffortLevels, EFFORT_LABELS, type AiEffort } from "../lib/aiEndpoint";
import { getBrowserPanelState, subscribeBrowserPanel, setBrowserPanelOpen, selectAgentBrowser } from "../lib/desktopBrowser";
import { enableComputerUse, disableComputerUse } from "../lib/computerUse";
import { AGENT_STORAGE_EVENT, agentStorageScope, readAgentStorage, writeAgentStorage } from "../lib/agentStorage";
import { botExpressionFor, botStateFor } from "../lib/botMood";
import { GitBranch, Globe } from "lucide-react";
import { getReachConfig, setReachConfig } from "../lib/reach";
import Markdown from "../components/Markdown";
import { openFolder, saveBytes } from "../lib/localPaths";
import { isNativeApp, shareNativeFile } from "../lib/nativePlatform";
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
  transcript,
  repairChatHistory,
  chatHistoryNeedsRecovery,
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
const COIN_FAILURE = "Insufficient credit. Add Coin to continue.";
const coinFailures = new Set([COIN_FAILURE,
  `${COIN_FAILURE} Nothing was executed from that response.`,
  `${COIN_FAILURE} Nothing was executed from that response. Check any earlier changes or files before asking me to continue.`]);
const needsCoin = (text: string) => coinFailures.has(text);

type PendingApproval = {
  id: number;
  name: string;
  args: Record<string, unknown>;
  resolve: (ok: boolean) => void;
};

/* The bot draws in the accent colour directly — see BloubBot — so nothing here
   re-tints it. The old orb was grayscale and needed a filter stack to fake one. */

export interface AgentChatStatus {
  busy: boolean;
  approvalPending: boolean;
  stop: () => void;
}

interface AgentChatProps {
  /** Visibility changes pause page interactions, never the running task. */
  active?: boolean;
  onStatusChange?: (status: AgentChatStatus) => void;
}

export default function AgentChat({ active = true, onStatusChange }: AgentChatProps) {
  const [scope, setScope] = useState(agentStorageScope);
  useEffect(() => {
    const refresh = () => setScope(agentStorageScope());
    window.addEventListener(AGENT_STORAGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("filey:workspace-changed", refresh);
    window.addEventListener("filey:workspace-transition", refresh);
    return () => {
      window.removeEventListener(AGENT_STORAGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("filey:workspace-changed", refresh);
      window.removeEventListener("filey:workspace-transition", refresh);
    };
  }, []);
  return <AgentWorkspace key={scope ?? "signed-out"} scope={scope} active={active} onStatusChange={onStatusChange} />;
}

function AgentWorkspace({ scope, active, onStatusChange }: AgentChatProps & { scope: string | null; active: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  // Fresh chat per app launch, same chat within a run — see resolveOpeningChat.
  const [chat, setChat] = useState<Chat>(resolveOpeningChat);
  const [input, setInput] = useState<string>(() =>
    active && location.pathname === "/agent" && typeof location.state?.draft === "string" && (!location.state.draftScope || location.state.draftScope === scope) ? location.state.draft.slice(0, 4000) : ""
  );
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  /** Object URL per attached image ("" for non-images), revoked on replace. */
  const [previews, setPreviews] = useState<string[]>([]);
  const previewUrlsRef = useRef<string[]>([]);
  const draftsRef = useRef(new Map<string, { text: string; files: File[] }>());
  const [pendingConfirm, setPendingConfirm] = useState<PendingApproval | null>(null);
  const approvalIdRef = useRef(0);
  const [memOpen, setMemOpen] = useState(false);
  const [mems, setMems] = useState<Memory[]>([]);
  const [histOpen, setHistOpen] = useState(false);
  const [chatList, setChatList] = useState<Chat[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [renameTarget, setRenameTarget] = useState<Chat | null>(null);
  const [renameText, setRenameText] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Chat | null>(null);
  const [historySaveFailed, setHistorySaveFailed] = useState(chatHistoryNeedsRecovery);
  const [recoverHistoryOpen, setRecoverHistoryOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const historyToggleRef = useRef<HTMLButtonElement>(null);
  const historySearchRef = useRef<HTMLInputElement>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [capsOpen, setCapsOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const [videosOpen, setVideosOpen] = useState(() => active && location.pathname === "/agent" && new URLSearchParams(location.search).get("video") === "1");
  const handoffsRef = useRef(new Set(active && location.pathname === "/agent" ? [location.key] : []));
  const pendingHandoffsRef = useRef(new Map<string, { draft: string; video: boolean }>());
  const [webOn, setWebOn] = useState(getReachConfig().enabled);
  const plusRef = useRef<HTMLDivElement>(null);

  // Ctrl+U opens the file picker from anywhere on the page, as the "+" menu's
  // shortcut promises — but not while typing, where Ctrl+U belongs to the
  // browser and the field.
  useEffect(() => {
    if (!active) return;
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
  }, [active]);

  const [dragging, setDragging] = useState(false);
  // ── Voice dictation (Web Speech API — Chromium, free, no key) ──────────
  const [listening, setListening] = useState(false);
  const dictationRef = useRef<ReturnType<typeof startDictation> | null>(null);
  const dictationTokenRef = useRef(0);
  const micSupported = useMemo(() => speechRecognitionSupported(), []);

  useEffect(() => {
    if (active) return;
    dictationTokenRef.current++;
    dictationRef.current?.stop();
    dictationRef.current = null;
    setListening(false);
    setDragging(false);
    setHistOpen(false);
    setMemOpen(false);
    setAutoOpen(false);
    setSkillsOpen(false);
    setCapsOpen(false);
    setPlusOpen(false);
    setMoreOpen(false);
    setRenameTarget(null);
    setDeleteTarget(null);
    setRecoverHistoryOpen(false);
    // Media cards/panels unmount below while hidden; preserve the selected view.
  }, [active]);

  // A later integration handoff is applied once, after the current task has
  // finished. Append to unsent wording; navigation never starts a task.
  useEffect(() => {
    if (!active || location.pathname !== "/agent") return;
    if (!handoffsRef.current.has(location.key)) {
      const draft = typeof location.state?.draft === "string" && (!location.state.draftScope || location.state.draftScope === scope)
        ? location.state.draft.slice(0, 4000) : "";
      const video = new URLSearchParams(location.search).get("video") === "1";
      if ((draft || video) && !pendingHandoffsRef.current.has(location.key)) {
        if (pendingHandoffsRef.current.size >= 16) {
          setErr("Review your pending integration drafts before adding another.");
          return;
        }
        pendingHandoffsRef.current.set(location.key, { draft, video });
      }
      handoffsRef.current.add(location.key);
      if (handoffsRef.current.size > 128) handoffsRef.current.delete(handoffsRef.current.values().next().value!);
    }
    if (busy) return;
    const pending = [...pendingHandoffsRef.current.values()];
    pendingHandoffsRef.current.clear();
    const draft = pending.map(handoff => handoff.draft).filter(Boolean).join("\n\n");
    if (draft) setInput(current => current ? `${current}\n\n${draft}` : draft);
    if (pending.some(handoff => handoff.video)) setVideosOpen(true);
  }, [active, location.key, location.pathname, location.search, location.state, scope, busy]);

  const toggleMic = () => {
    if (listening) {
      dictationRef.current?.stop();
      dictationRef.current = null;
      setListening(false);
      return;
    }
    const token = ++dictationTokenRef.current;
    dictationRef.current = startDictation({
      onFinal: (chunk) => {
        if (token !== dictationTokenRef.current) return;
        setInput(cur => `${cur}${cur ? " " : ""}${chunk}`);
      },
      onInterim: (draft) => {
        if (token !== dictationTokenRef.current) return;
        // Live draft shows in the placeholder so the words appear as spoken
        // without churning the real value on every partial result.
        if (textareaRef.current) textareaRef.current.placeholder = draft || "Listening…";
      },
      onEnd: () => {
        if (token !== dictationTokenRef.current) return;
        setListening(false);
        dictationRef.current = null;
        if (textareaRef.current)
          textareaRef.current.placeholder =
            textareaRef.current.dataset.ph || "Message Filey AI…";
      },
      onError: (e) => {
        if (token !== dictationTokenRef.current) return;
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
  const [reasoningEnabled, setReasoningEnabled] = useState(getFileyAiReasoning);
  const [managedEffort, setManagedEffort] = useState(getFileyAiEffort);
  useEffect(() => {
    if (busy) return;
    const refresh = () => {
      setReasoningEnabled(getFileyAiReasoning());
      setManagedEffort(getFileyAiEffort());
      const saved = readAgentStorage("filey.agent.effort");
      setEffort(saved && Object.prototype.hasOwnProperty.call(EFFORT_LABELS, saved) ? saved as AiEffort : "auto");
    };
    refresh();
    window.addEventListener(AGENT_STORAGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(AGENT_STORAGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [busy]);
  const browserPanel = useSyncExternalStore(subscribeBrowserPanel, getBrowserPanelState);
  const changeEffort = (next: AiEffort) => {
    if (busy) return;
    try {
      if (modelConfig.billing === "credits") {
        setFileyAiEffort(next, scope ?? undefined); setManagedEffort(getFileyAiEffort());
      } else { writeAgentStorage("filey.agent.effort", next, scope ?? undefined); setEffort(next); }
    }
    catch { setErr("Could not save the effort setting. Try again."); }
  };
  const changeReasoning = (enabled: boolean) => {
    if (busy) return;
    try { setFileyAiReasoning(enabled, scope ?? undefined); setReasoningEnabled(enabled); }
    catch { setErr("Could not save the reasoning setting. Try again."); }
  };
  /** Keep action receipts for continuation; the chat shows only a short status. */
  const [runProgress, setRunProgress] = useState<ChatTurn["run"]>();
  /** Lets the Stop button cut a run short. ponytail: on desktop the native AI
   *  proxy call itself isn't cancellable (see ai.ts), so an abort stops the
   *  agent between rounds rather than mid-request — which is what "stop doing
   *  more work" means to the person clicking it. */
  const abortRef = useRef<AbortController | null>(null);
  /** Mirrors the streamed text for the catch block — reading the state there
   *  would get the value from the render that started the run, not the latest. */
  const streamedRef = useRef("");
  const followUpEditedRef = useRef(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const scrolledChatRef = useRef<string | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
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
    const workspaceChanged = (event: Event) => {
      if (event.type === "filey:workspace-changed" ||
        (event.type === "filey:workspace-transition" && (event as CustomEvent<boolean>).detail) ||
        scope !== agentStorageScope()) {
        stopBrowser();
        void disableComputerUse().catch(() => {});
      }
    };
    window.addEventListener("filey:stop-agent-browser", stopBrowser);
    for (const event of [AGENT_STORAGE_EVENT, "storage", "filey:workspace-changed", "filey:workspace-transition"])
      window.addEventListener(event, workspaceChanged);
    return () => {
      window.removeEventListener("filey:stop-agent-browser", stopBrowser);
      for (const event of [AGENT_STORAGE_EVENT, "storage", "filey:workspace-changed", "filey:workspace-transition"])
        window.removeEventListener(event, workspaceChanged);
    };
  }, [scope]);


  // Attach a file + build an image preview (revoking the previous one).
  /** Attach one or more files. Several at once is the point: "merge these"
   *  means the user drops all the PDFs on the composer and the agent runs
   *  the merge right here. */
  const attach = (list: File[] | null) => {
    const next = (list ?? []).filter(Boolean);
    previewUrlsRef.current.filter(Boolean).forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current = next.map((file) => file.type.startsWith("image/") ? URL.createObjectURL(file) : "");
    setPreviews(previewUrlsRef.current);
    setFiles(next);
  };

  // Auto-grow the textarea up to a cap — tall enough for a real brief, short
  // enough that it never crowds the conversation off the screen.
  useEffect(() => {
    if (!active) return;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [active, input]);

  // Route this session's sensitive-action approvals through an in-app modal.
  // Ordinary section changes keep its exact resolver and arguments pending.
  // pendingRef mirrors pendingConfirm so unmount cleanup can settle whatever
  // is on screen: leaving with the dialog up used to strand its resolver
  // unreached — the awaiting runTool promise (and the whole turn) hung forever.
  const pendingRef = useRef<PendingApproval | null>(null);
  const stop = useCallback(() => {
    abortRef.current?.abort();
    pendingRef.current?.resolve(false);
    pendingRef.current = null;
    setPendingConfirm(null);
    void disableComputerUse().catch(() => {});
  }, []);
  useEffect(() => {
    onStatusChange?.({ busy, approvalPending: !!pendingConfirm, stop });
  }, [busy, pendingConfirm, stop, onStatusChange]);
  useEffect(() => () => {
    // A contained chat crash can unmount this session while its shell survives.
    onStatusChange?.({ busy: false, approvalPending: false, stop });
  }, [onStatusChange, stop]);
  const requestConfirm = useCallback((name: string, args: Record<string, unknown>) =>
    new Promise<boolean>((resolve) => {
      if (!scope || scope !== agentStorageScope() || abortRef.current?.signal.aborted) { resolve(false); return; }
      pendingRef.current?.resolve(false);
      const pc = { id: ++approvalIdRef.current, name, args, resolve };
      pendingRef.current = pc;
      setPendingConfirm(pc);
    }), [scope]);
  useEffect(() => {
    setToolConfirm(requestConfirm);
    return () => {
      abortRef.current?.abort();
      dictationTokenRef.current++;
      dictationRef.current?.stop();
      dictationRef.current = null;
      previewUrlsRef.current.filter(Boolean).forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = [];
      draftsRef.current.clear();
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
  }, [requestConfirm]);

  /** A callback from a replaced dialog must never settle its successor. */
  const settleConfirm = (request: PendingApproval, ok: boolean) => {
    if (pendingRef.current?.resolve !== request.resolve) return;
    request.resolve(ok);
    pendingRef.current = null;
    setPendingConfirm(current => current?.resolve === request.resolve ? null : current);
  };

  // Persist the conversation (shared store with the popover copilot).
  useEffect(() => {
    if (!chat.turns.length || !scope || agentStorageScope() !== scope) return;
    const rest = loadChats().filter((c) => c.id !== chat.id);
    const saved = saveChats(
      [{ ...chat, title: chat.customTitle || deriveTitle(chat.turns), updatedAt: Date.now() }, ...rest],
      scope
    );
    setHistorySaveFailed(!saved);
    if (saved) setActiveId(chat.id);
  }, [chat, scope]);

  useEffect(() => {
    const failed = () => setHistorySaveFailed(true);
    window.addEventListener("filey:chats:save-failed", failed);
    return () => window.removeEventListener("filey:chats:save-failed", failed);
  }, []);

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
    if (active && !videosOpen) buildAiContext().catch(() => {});
  }, [active, videosOpen]);

  useEffect(() => {
    if (active && videosOpen) conversationRef.current?.scrollTo({ top: 0 });
  }, [active, videosOpen]);

  // Remember the reader's position before new content changes scrollHeight.
  // Checking after a large streamed chunk can mistake a pinned reader for one
  // who scrolled up; finishing a reply must respect the same choice.
  const trackScroll = () => {
    const scroller = conversationRef.current;
    if (!active || !scroller || videosOpen) return;
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 48;
    followLatestRef.current = atBottom;
    setShowJumpToLatest(!atBottom);
  };
  const jumpToLatest = () => {
    followLatestRef.current = true;
    setShowJumpToLatest(false);
    const scroller = conversationRef.current;
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
  };

  // Scroll only the messages; keep every streamed update and completion on the
  // same path so neither the page nor a reader reviewing earlier text jumps.
  useEffect(() => {
    const scroller = conversationRef.current;
    if (!active || !scroller || videosOpen) return;
    if (scrolledChatRef.current !== chat.id) {
      scrolledChatRef.current = chat.id;
      followLatestRef.current = true;
      setShowJumpToLatest(false);
    }
    if (!followLatestRef.current) return;
    // rAF coalesces bursts into one scroll per frame instead of one per step.
    const id = requestAnimationFrame(() => {
      if (!followLatestRef.current) return;
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
    });
    return () => cancelAnimationFrame(id);
  }, [active, chat.id, chat.turns, busy, streaming, runProgress, videosOpen]);

  const changeChat = (c: Chat) => {
    if (chat.turns.length && (input || files.length)) draftsRef.current.set(chat.id, { text: input, files });
    else draftsRef.current.delete(chat.id);
    const draft = draftsRef.current.get(c.id);
    dictationTokenRef.current++;
    dictationRef.current?.stop();
    dictationRef.current = null;
    setListening(false);
    setInput(draft?.text ?? "");
    attach(draft?.files ?? []);
    setChat(c);
    setActiveId(c.id);
    setErr(null);
    setStreaming("");
    setRunProgress(undefined);
  };
  const startNew = () => {
    if (!busy) changeChat(newChat());
  };

  const send = async (raw: string) => {
    const q = raw.trim();
    const attached = files;
    if (!active || (!q && !attached.length) || busy) return;
    if (!scope || scope !== agentStorageScope()) { setErr("Your workspace changed. Start a new task in the current workspace."); return; }
    if (!ready) {
      setErr(
        modelConfig.billing ? "Choose Filey AI to pay with Coin, or use your own API key below." : "Choose a local model or connect your provider in AI settings to start this conversation."
      );
      return;
    }
    setErr(null);
    dictationTokenRef.current++;
    dictationRef.current?.stop();
    dictationRef.current = null;
    setListening(false);
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
      title: chat.customTitle || deriveTitle([...chat.turns, { role: "user", text: shownText }]),
      turns: [...chat.turns, { role: "user", text: shownText }],
    };
    followLatestRef.current = true;
    setShowJumpToLatest(false);
    setChat(withUser);
    setBusy(true);
    setRunProgress(undefined);
    setStreaming(auto ? "Planning…" : "");
    followUpEditedRef.current = false;
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
      const selectedEffort = modelConfig.billing === "credits" ? reasoningEnabled ? managedEffort : "auto" : aiEffortLevels(modelConfig).includes(effort) ? effort : "auto";
      const options = { isOwner: !!scope, signal: ctl.signal, turnId, agentId: chat.id, maxTokens: 4096, effort: selectedEffort,
        ...(modelConfig.billing === "credits" ? { reasoningEnabled } : {}), computerSession, confirm: requestConfirm };
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
      if (trace.outcome === "error" && needsCoin(reply) && !trace.actions.length && !followUpEditedRef.current) {
        setInput(raw);
        attach(attached);
      }
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
        if (!followUpEditedRef.current) {
          setInput(raw);
          attach(attached);
        }
        if (trace.actions.length || streamedRef.current || failedFiles.length)
          setChat((c) => ({
            ...c,
            turns: [
              ...c.turns,
              {
                role: "assistant",
                text:
                  streamedRef.current ||
                  "The task stopped before finishing. Check any changes or files already created before trying again.",
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
    if (!histOpen && active) requestAnimationFrame(() => { if (!workspaceRef.current?.closest("[hidden]")) historySearchRef.current?.focus(); });
  };
  const closeHistory = () => { setHistOpen(false); if (active) requestAnimationFrame(() => { if (!workspaceRef.current?.closest("[hidden]")) historyToggleRef.current?.focus(); }); };
  const switchChat = (c: Chat) => {
    if (busy) return;
    changeChat(c);
    if ((workspaceRef.current?.clientWidth ?? 0) < 720) closeHistory();
  };
  const deleteChat = (id: string) => {
    if (busy || !scope || scope !== agentStorageScope()) return;
    const next = loadChats().filter((c) => c.id !== id);
    if (!saveChats(next, scope)) { setHistorySaveFailed(true); return; }
    setChatList(next.sort((a, b) => b.updatedAt - a.updatedAt));
    if (id === chat.id) startNew();
    draftsRef.current.delete(id);
    setDeleteTarget(null);
  };

  const beginRename = (target: Chat) => {
    if (busy) return;
    setMoreOpen(false);
    setRenameText(target.customTitle || target.title);
    setRenameTarget(target);
  };
  const renameChat = (automatic = false) => {
    if (busy || !renameTarget || !scope || scope !== agentStorageScope()) return;
    const history = loadChats();
    const source = history.find(item => item.id === renameTarget.id);
    if (!source) { setErr("This conversation is no longer available. Reopen chat history."); setRenameTarget(null); return; }
    const title = automatic ? deriveTitle(source.turns) : renameText.trim().replace(/\s+/g, " ").slice(0, 120);
    if (!title) return;
    const next = { ...source, title, customTitle: automatic ? undefined : title, updatedAt: Date.now() };
    if (!saveChats([next, ...history.filter(item => item.id !== next.id)], scope)) {
      setHistorySaveFailed(true); return;
    }
    if (next.id === chat.id) setChat(next);
    setChatList(loadChats().sort((a, b) => b.updatedAt - a.updatedAt));
    setRenameTarget(null);
  };
  const exportChat = async () => {
    if (exporting || !chat.turns.length || !scope || scope !== agentStorageScope()) return;
    setMoreOpen(false);
    setExporting(true);
    try {
      const filename = `Filey-chat-${chat.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "conversation"}.txt`;
      await saveBytes(filename, new TextEncoder().encode(`${chat.title}\n\n${transcript(chat)}`), "text/plain;charset=utf-8");
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") setErr("Could not export this conversation. Try again.");
    } finally { setExporting(false); }
  };
  const recoverHistory = () => {
    if (busy || !scope || scope !== agentStorageScope()) return;
    if (!repairChatHistory(scope)) { setHistorySaveFailed(true); setErr("Could not recover chat history. Your original history is unchanged. Export this conversation before closing Filey."); return; }
    const restored = loadChats().filter(item => item.id !== chat.id);
    const saved = !chat.turns.length || saveChats([{ ...chat, title: chat.customTitle || deriveTitle(chat.turns), updatedAt: Date.now() }, ...restored], scope);
    setHistorySaveFailed(!saved);
    if (saved) setErr(null);
    setChatList(loadChats().sort((a, b) => b.updatedAt - a.updatedAt));
    setRecoverHistoryOpen(false);
  };

  const query = historySearch.trim().toLowerCase();
  const matchingChats = chatList.filter(c => !query || `${c.title || "New chat"}\n${c.turns.map(turn => turn.text).join("\n")}`.toLowerCase().includes(query));

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
        if (dropped.length && !busy) attach([...files, ...dropped]);
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
          {matchingChats.map(c => <div key={c.id} className={cn("group flex items-center gap-0.5 rounded-xl hover:bg-hover", c.id === chat.id && "bg-hover")}>
            <button type="button" disabled={busy} onClick={() => switchChat(c)} aria-current={c.id === chat.id ? "page" : undefined} className="min-h-11 min-w-0 flex-1 rounded-xl px-3 py-2 text-left text-[13px] disabled:opacity-50" title={c.title || "New chat"}>
              <span className="block truncate">{c.title || "New chat"}</span>
            </button>
            <button type="button" disabled={busy} onClick={() => setDeleteTarget(c)} aria-label={`Delete chat: ${c.title || "New chat"}`} className="btn-ghost w-10 shrink-0 !border-transparent !bg-transparent !px-0 text-muted-foreground hover:!text-danger"><Trash2 size={14} /></button>
          </div>)}
          {!chatList.length && <p className="px-3 py-4 text-xs leading-relaxed text-muted-foreground">Your conversations will appear here.</p>}
          {!!chatList.length && !matchingChats.length && <p className="px-3 py-4 text-xs text-muted-foreground">No chats match your search.</p>}
        </nav>
      </aside>}
      {/* A full-width session header frames the centered conversation. */}
      <div
        className={cn("filey-chat relative flex min-w-0 flex-1 flex-col", histOpen && "filey-chat-with-history")}
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

        <header className="filey-chat-header">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button ref={historyToggleRef} type="button" onClick={openHistory} aria-label="Chat history" title="Chat history" aria-expanded={histOpen} aria-controls="filey-chat-history" className="filey-chat-icon"><History size={20} /></button>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold leading-tight text-foreground" title={chat.title || "Filey AI"}>
                  {empty ? "New chat" : chat.title || "Conversation"}
                </h1>
                {empty && <p className="mt-1 text-[13px] text-muted-foreground">How can I help you today?</p>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
              <Link to="/settings?section=credits" className="filey-chat-wallet composer-control" aria-label="Add Coin to AI wallet" title="Coin wallet and top-ups">
                <CoinMark /><span>Add Coin</span>
              </Link>
              <button type="button" onClick={() => setBrowserPanelOpen(!browserPanel.open)}
                className="filey-chat-icon" aria-label={browserPanel.open ? "Collapse browser" : "Open browser"} title={browserPanel.open ? "Collapse browser" : "Open browser"} aria-expanded={browserPanel.open} aria-controls="filey-browser-panel">
                <Globe size={20} />
              </button>
              <div ref={moreRef}>
                <button type="button" onClick={() => setMoreOpen(v => !v)} className="filey-chat-icon" aria-label="Conversation options" aria-expanded={moreOpen} title="Conversation options"><MoreHorizontal size={20} /></button>
                <MenuPopover open={active && moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreRef} align="end" className="w-56">
                  {!empty && !busy && <MenuItemRow icon={<SquarePen size={15} />} label="Rename chat" onClick={() => beginRename(chat)} />}
                  {!empty && !exporting && <MenuItemRow icon={<Download size={15} />} label="Export conversation" onClick={() => { void exportChat(); }} />}
                  {!empty && <MenuSep />}
                  <MenuItemRow icon={<CoinMark />} label="Coin wallet" onClick={() => { setMoreOpen(false); navigate("/settings?section=credits"); }} />
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
                className="filey-chat-icon"
              >
                <SquarePen size={20} />
              </button>
            </div>
          </div>
        </header>


        {/* The conversation and composer share one readable measure. */}
        <div className="filey-conversation-viewport">
        <div ref={conversationRef} className="filey-conversation-scroll" onScroll={trackScroll}>
        {active && videosOpen && <AgentMediaPanel onClose={() => setVideosOpen(false)} onDraft={job => {
          setChat(current => ({ ...current, turns: [...current.turns,
            { role: "assistant", text: job.state === "draft" ? `Review your ${job.kind}, then choose Generate to use your own provider key.` : `Here is your ${job.kind} request.`, files: [{ name: `Generated ${job.kind}`, mediaJobId: job.id }] }], updatedAt: Date.now() }));
          setVideosOpen(false);
        }} />}
        <div
          className={cn(
            COLUMN,
            "filey-conversation",
            empty && !busy ? "flex flex-1 flex-col justify-center py-10" : "space-y-7 py-5"
          )}
          aria-label="Conversation"
        >
          {empty && !busy ? (
            <div className="filey-chat-empty mx-auto max-w-xl text-center">
              {/* The empty chat is where the bot has room to be itself, so this
                  one animates: it breathes, blinks and looks around while it
                  waits for a first question. */}
              <div className="mx-auto mb-4 grid h-12 w-12 place-items-center">
                {active && <BloubBot size={48} state="idle" label="Filey AI" ambient />}
              </div>
              <h2 className="text-xl font-medium leading-tight text-foreground tracking-tight sm:text-2xl">
                What shall we work on?
              </h2>
              {!input.trim() && !files.length && <AgentChatStarters onDraft={text => { if (!busy && active) { setInput(text); textareaRef.current?.focus({ preventScroll: true }); } }} onAttach={() => { if (!busy && active) fileRef.current?.click(); }} />}
            </div>
          ) : (
            // Turns separate by spacing alone: ChatTurn carries no timestamp
            // (aiChats.ts stores none), so no time meta is invented here.
            chat.turns.map((t, i) => <Bubble key={i} turn={t} active={active} />)
          )}

          {busy && (
            <>
              <Bubble
                turn={{ role: "assistant", text: streaming || "", run: runProgress }}
                pending
                active={active}
              />
            </>
          )}

          {err && <div className="space-y-2">
            <ErrorBanner message={err} />
            {err === "Insufficient credit. Add Coin to continue." && (
              <Link to="/settings?section=credits" className="btn-primary">
                <CoinMark /> Add Coin
              </Link>
            )}
          </div>}
          {historySaveFailed && <div className="space-y-2">
            <ErrorBanner message="Chat history could not be saved on this device. Export this conversation before closing Filey." />
            <div className="flex flex-wrap gap-2">
              {!!chat.turns.length && <button type="button" className="btn-ghost" disabled={exporting} onClick={() => { void exportChat(); }}><Download size={15} />Export conversation</button>}
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => setRecoverHistoryOpen(true)}>Recover history</button>
            </div>
          </div>}

          {/* Pairing QR, rendered from live bridge state rather than from the
              model's reply: a data URL is kilobytes of base64 that would bloat
              every subsequent turn's context, and the code refreshes on its own
              timer - this card follows it. */}
          {active && <WhatsAppPairingCard />}

        </div>
        </div>
        {showJumpToLatest && !videosOpen && <button type="button" onClick={jumpToLatest} className="filey-chat-icon filey-chat-jump" aria-label="Jump to latest message" title="Jump to latest message"><ArrowDown size={18} /></button>}
        </div>

        {/* Only the conversation scrolls; the composer stays above the keyboard. */}
        <div
          className="filey-composer-dock"
        >
          <div className={COLUMN}>
            {/* A stable composer keeps Stop readable while a reply is running. */}
            <div className="filey-composer">
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
                data-ph={busy ? "Draft a follow-up…" : auto ? "Describe a task…" : "Ask Filey…"}
                rows={1}
                value={input}
                placeholder={busy ? "Draft a follow-up…" : auto ? "Describe a task…" : "Ask Filey…"}
                onChange={(e) => { if (busy) followUpEditedRef.current = true; setInput(e.target.value); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !(typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches)) {
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
                  if (img && !busy) {
                    e.preventDefault();
                    attach([...files, img]);
                  }
                }}
                /* The wrapper's border shows focus for the whole composer. */
                className="filey-composer-input w-full resize-none bg-transparent text-foreground outline-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground"
                autoFocus={active && !videosOpen && typeof matchMedia !== "undefined" && matchMedia("(pointer: fine)").matches}
              />

              {/* One row on every screen; compact controls keep their menus. */}
              <div className="filey-composer-actions">
                <div className="relative shrink-0" ref={plusRef}>
                  <button
                    type="button"
                    onClick={() => setPlusOpen((v) => !v)}
                    disabled={busy}
                    aria-label="Add to message"
                    aria-expanded={plusOpen}
                    title="Add files, repos, skills — Ctrl+U for files"
                    className="filey-chat-icon"
                  >
                    <Plus size={22} />
                  </button>

                  <MenuPopover
                    open={active && plusOpen}
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
                    attach([...files, ...Array.from(e.target.files ?? [])]);
                    e.target.value = ""; // allow re-selecting the same file
                  }}
                />
                {active && <AgentAccessControl mode={mode} disabled={busy} onCapabilities={() => setCapsOpen(true)} onChange={next => {
                  setAgentMode(next);
                  const saved = getAgentMode(); setMode(saved);
                  if (saved !== next) setErr("Could not save the access mode. Your previous selection is unchanged.");
                }} />}
                <div className="filey-composer-models">
                {active && <AiFundingControl disabled={busy} compact />}
                {active && <AgentEffortControl config={modelConfig} value={modelConfig.billing === "credits" ? managedEffort : effort} disabled={busy} onChange={changeEffort}
                  reasoningEnabled={reasoningEnabled} onReasoningChange={changeReasoning} />}
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
                      "filey-chat-icon",
                      listening
                        ? "bg-danger/15 text-danger motion-safe:animate-pulse"
                        : "text-muted-foreground hover:bg-hover hover:text-foreground"
                    )}
                  >
                    <Mic size={20} />
                  </button>
                )}
                {/* Send and Stop keep the same position and touch target. */}
                {busy ? (
                  <button
                    type="button"
                    onClick={stop}
                    aria-label="Stop generating"
                    title="Stop"
                    className="filey-chat-icon filey-chat-send"
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
                    className="filey-chat-icon filey-chat-send"
                  >
                    <ArrowUp size={20} />
                  </button>
                )}
                </div>
              </div>
            </div>
            <p id="filey-message-hint" className="filey-composer-hint mt-2 px-1 text-center text-[11px] text-muted-foreground">
              {busy ? "Draft your next message while Filey works." : <><span className="filey-keyboard-hint">Enter to send · Shift+Enter for a new line</span>
              <span className="filey-touch-hint">Tap the arrow to send</span></>}
            </p>
          </div>
        </div>

        {/* Closing an approval always resolves the waiting tool as denied. */}
        <Modal open={active && !!renameTarget} onClose={() => setRenameTarget(null)} title="Rename chat">
          <form onSubmit={event => { event.preventDefault(); renameChat(); }}>
            <label className="block text-sm" htmlFor="filey-chat-name">Chat name</label>
            <input id="filey-chat-name" autoFocus maxLength={120} required className="input mt-2 w-full" value={renameText} disabled={busy} onChange={event => setRenameText(event.target.value)} />
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {renameTarget?.customTitle && <button type="button" disabled={busy} className="btn-ghost mr-auto" onClick={() => renameChat(true)}>Use automatic title</button>}
              <button type="button" className="btn-ghost" onClick={() => setRenameTarget(null)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={busy || !renameText.trim()}>Save name</button>
            </div>
          </form>
        </Modal>
        <Modal open={active && !!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete conversation?">
          <p className="text-sm text-muted-foreground">Delete “{deleteTarget?.title}” from chat history on this device? This cannot be undone. Your business records are unaffected.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => { if (deleteTarget) deleteChat(deleteTarget.id); }}>Delete conversation</button>
          </div>
        </Modal>
        <Modal open={active && recoverHistoryOpen} onClose={() => setRecoverHistoryOpen(false)} title="Recover chat history?">
          <p className="text-sm text-muted-foreground">Keep readable conversations and remove damaged entries. Filey will retain the original history privately on this device before making changes. Recovery also needs enough free device storage.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setRecoverHistoryOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={recoverHistory}>Recover history</button>
          </div>
        </Modal>
        {active && pendingConfirm && (
          <Modal key={pendingConfirm.id} open onClose={() => settleConfirm(pendingConfirm, false)} title="Approve action">
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
                type="button"
                className="btn-ghost"
                autoFocus
                onClick={() => settleConfirm(pendingConfirm, false)}
              >
                Deny
              </button>
              <button type="button" className="btn-primary" onClick={() => settleConfirm(pendingConfirm, true)}>
                Allow
              </button>
            </div>
          </Modal>
        )}

        <Modal open={active && memOpen} onClose={() => setMemOpen(false)} title="Agent memory">
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

        <AutomationsDrawer open={active && autoOpen} onClose={() => setAutoOpen(false)} />
        <SkillsDrawer open={active && skillsOpen} onClose={() => setSkillsOpen(false)} />
        <CapabilitiesDrawer
          open={active && capsOpen}
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
  const [failed, setFailed] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timeoutRef.current), []);
  return <>
    <button
      type="button"
      onClick={async () => {
        clearTimeout(timeoutRef.current);
        setDone(false);
        setFailed(false);
        try {
          if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
          await navigator.clipboard.writeText(text);
          setDone(true);
          timeoutRef.current = setTimeout(() => setDone(false), 1500);
        } catch { setFailed(true); }
      }}
      aria-label={done ? "Copied reply" : "Copy reply"}
      title={done ? "Copied" : "Copy reply"}
      className="filey-chat-icon filey-reply-copy text-muted-foreground"
    >
      {done ? <Check size={16} /> : <Copy size={16} />}
    </button>
    <span className={failed ? "self-center text-xs text-muted-foreground" : "sr-only"} role="status">{failed ? "Could not copy. Select and copy the reply." : done ? "Copied" : ""}</span>
  </>;
}

function Bubble({ turn, pending, active = true }: { turn: ChatTurn; pending?: boolean; active?: boolean }) {
  const [fileError, setFileError] = useState("");
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="filey-user-message max-w-[85%] whitespace-pre-wrap rounded-2xl bg-muted px-4 py-3 leading-relaxed text-foreground">
          {turn.text}
        </div>
      </div>
    );
  }
  return (
    <div className="group/msg">
      {/* Keep Filey's animated identity while working, and give replies the full width. */}
      {active && pending && <div className="mb-2 grid h-7 w-7 place-items-center">
        <BloubBot
          size={28}
          animate
          ambient
          state={botStateFor(pending ? "thinking" : "idle")}
          expression={botExpressionFor(pending ? "thinking" : "idle")}
        />
      </div>}
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "filey-assistant-message leading-relaxed text-foreground",
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
            active ? <ThinkingDots className="text-muted-foreground" /> : null
          )}
          {pending && turn.text && (
            <span className="ml-1 inline-block motion-safe:animate-pulse">▍</span>
          )}
        </div>
        <AgentRunProgress run={turn.run} pending={pending} />
        {!pending && needsCoin(turn.text) && <Link to="/settings?section=credits" className="btn-ghost mt-2"><CoinMark />Add Coin</Link>}
        {!pending && turn.text.trim() && (
          <div className="mt-1 flex">
            <CopyButton text={turn.text} />
          </div>
        )}
        {!!turn.files?.length && (
          <div className="mt-2 flex flex-wrap gap-2">
            {turn.files.map((f, i) =>
              // Desktop: the file is already on disk, so open it where it
              // landed. Browser: hand over the blob as a real download.
              f.mediaJobId ? (active ? <MediaJobCard key={f.mediaJobId} id={f.mediaJobId} /> : null) : f.videoJobId ? (active ? <VideoJobCard key={f.videoJobId} id={f.videoJobId} /> : null) : f.path ? (
                <button
                  key={i}
                  type="button"
                  title={f.path}
                  onClick={() => {
                    setFileError("");
                    void (isNativeApp() ? shareNativeFile(f.path!, f.name) : openFolder(f.path!)).catch(error => {
                      if ((error as Error).name !== "AbortError") setFileError((error as Error).message || "Could not open this file.");
                    });
                  }}
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
        {fileError && <ErrorBanner message={fileError} />}
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
