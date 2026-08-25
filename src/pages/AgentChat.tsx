import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
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
  CalendarClock,
  BookOpen,
  SlidersHorizontal,
  Copy,
  Check,
  Square,
  Hammer,
  Sparkles,
} from "lucide-react";
import BloubBot from "../components/BloubBot";
import ThinkingDots from "../components/ThinkingDots";
import { botExpressionFor, botStateFor } from "../lib/botMood";
import { GitBranch, Globe } from "lucide-react";
import { getReachConfig, setReachConfig } from "../lib/reach";
import Markdown from "../components/Markdown";
import { openFolder } from "../lib/localPaths";
import { ErrorBanner } from "../components/ui";
import AutomationsDrawer from "../components/AutomationsDrawer";
import SkillsDrawer from "../components/SkillsDrawer";
import CapabilitiesDrawer from "../components/CapabilitiesDrawer";
import { skillsIndex } from "../lib/agentSkills";
import { buildAiContext } from "../lib/aiContext";
import {
  AGENT_MODES,
  getAgentMode,
  setAgentMode,
  type AgentMode,
} from "../lib/agentMode";
import {
  aiAgentStream,
  aiAutonomous,
  aiReady,
  AiError,
  buildSystemPrompt,
  getPersona,
  getAiConfig,
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
  redactArgs,
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
import {
  hasDesktop as waHasDesktop,
  bridgeState,
  onBridgeState,
  type BridgeState,
} from "../lib/waBridge";

/* Claude-style full-page chat for the Filey AI agent. Conversational mode runs
 * the standard tool-calling agent; the "Autonomous" toggle hands a goal to
 * aiAutonomous (plan → act → verify → finish) and streams the steps live. */

const SYSTEM =
  "You are Filey, the user's AI business agent with full control of their ERP app via tools — you can read AND modify: stats, customers, products, invoices, quotes, orders, purchase orders, expenses, attendance, files, and navigation. You have long-term memory: use `remember` to save durable facts/preferences and `recall` to look them up. When asked to do something, execute the tool and confirm in one short line. Money/outbound actions require user approval. Never invent data — look it up. Be concise and practical.";

/** Four things the agent is genuinely good at, phrased the way an owner would
 *  ask. Kept short enough to fit one row on a laptop. */
const STARTERS = [
  "What did I invoice this month?",
  "Who owes me money?",
  "Draft an invoice",
  "What's running low in stock?",
];

/** One-tap tasks that sit above the composer once a conversation exists — the
 *  empty-state starters cover discovery; these cover the repeats an owner
 *  actually does daily. Each sends immediately: predictable beats clever. */

/** Shared pill style for every tappable suggestion (starters + quick tabs):
 *  same shape everywhere, so a tap always predicts the same kind of result. */
const CHIP =
  "shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground active:scale-[0.97]";

/** Width both halves of the conversation share — messages and the composer sit
 *  on one measure so long replies don't stretch wider than where you type. */
const COLUMN = "mx-auto w-full max-w-[760px]";

/* The bot draws in the accent colour directly — see BloubBot — so nothing here
   re-tints it. The old orb was grayscale and needed a filter stack to fake one. */

export default function AgentChat() {
  // Fresh chat per app launch, same chat within a run — see resolveOpeningChat.
  const [chat, setChat] = useState<Chat>(resolveOpeningChat);
  const [input, setInput] = useState("");
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
  const [autoOpen, setAutoOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [capsOpen, setCapsOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [webOn, setWebOn] = useState(getReachConfig().enabled);
  const plusRef = useRef<HTMLDivElement>(null);

  // Ctrl+U opens the file picker from anywhere on the page, as the "+" menu's
  // shortcut promises — but not while typing, where Ctrl+U belongs to the
  // browser and the field.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
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
  // Read fresh every render: frozen-at-mount values kept showing a stale model
  // chip (and a stale "connect first" gate) after the key changed in Settings.
  // These are cheap localStorage reads.
  const ready = aiReady();
  const model = getAiConfig().model;
  const [mode, setMode] = useState<AgentMode>(getAgentMode);
  /** The tools run so far this turn ("Looking up customers…"), shown as a chip
   *  trail while the agent works so a long turn reads as work, not a hang. */
  const [activity, setActivity] = useState<string[]>([]);
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
    if (!chat.turns.length) return;
    const rest = loadChats().filter((c) => c.id !== chat.id);
    saveChats([{ ...chat, title: deriveTitle(chat.turns), updatedAt: Date.now() }, ...rest]);
    setActiveId(chat.id);
  }, [chat]);

  // The rail lists every stored chat, so re-read the store whenever the active
  // chat changes — the persist effect above writes, this is what sees it.
  useEffect(() => {
    setChatList(loadChats().sort((a, b) => b.updatedAt - a.updatedAt));
  }, [chat]);

  // Opening a chat must not animate. A smooth scroll on mount — with the
  // sentinel aligned to the *top* of the viewport, which is scrollIntoView's
  // default — parks the page mid-scroll, so the chat reads as already scrolled
  // up. On mount: jump straight to the foot of an existing conversation, and
  // put a fresh one at the top (the scroll position carries over from whatever
  // page you came from otherwise). After that, follow new turns smoothly, and
  // anchor to `end` so the newest message sits at the bottom, not the top.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      const atFoot = chat.turns.length > 0;
      (atFoot ? endRef.current : topRef.current)?.scrollIntoView({
        block: atFoot ? "end" : "start",
      });
      return;
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.turns, streaming, busy]);

  /** Stop the run. The catch in send() turns the abort into a kept partial
   *  reply rather than an error banner. */
  const stop = () => abortRef.current?.abort();

  const startNew = () => {
    const c = newChat();
    setChat(c);
    setActiveId(c.id);
    setErr(null);
    setStreaming("");
  };

  const send = async (raw: string) => {
    const q = raw.trim();
    const attached = files;
    if ((!q && !attached.length) || busy) return;
    if (!ready) {
      setErr("Connect an AI model first - Settings → AI Assistant (bring your own key).");
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
    try {
      let reply: string;
      if (auto) {
        const steps: string[] = [];
        const summary = await aiAutonomous(goalText, {
          images,
          isOwner: true,
          signal: ctl.signal,
          turnId,
          onProgress: (t) => {
            if (!t) return;
            steps.push(t);
            streamedRef.current = steps.join("\n\n");
            setStreaming(streamedRef.current);
          },
        });
        reply =
          steps.length && steps[steps.length - 1] !== summary
            ? `${steps.join("\n\n")}\n\n${summary}`
            : summary;
      } else {
        // The popover copilot has always had the business snapshot; this page
        // and WhatsApp did not, so the same question got a vaguer answer
        // depending on where it was asked.
        const brief = await buildAiContext().catch(() => "");
        const messages: AiMessage[] = [
          {
            role: "system",
            text: buildSystemPrompt(
              SYSTEM,
              getPersona(),
              [memoryDigest(), skillsIndex(), brief].filter(Boolean).join("\n\n")
            ),
          },
          ...withUser.turns.slice(-TURN_CAP).map((t) => ({ role: t.role, text: t.text })),
        ];
        if (images?.length) messages[messages.length - 1].images = images;
        // Streamed, not awaited whole: a turn that looks up three things and
        // drafts an invoice took a minute behind the word "Thinking…", with no
        // sign it was doing anything. The same run now narrates itself.
        const stream = aiAgentStream(messages, {
          // The harness default. 1200 truncated any answer with a table or a
          // list of invoices in it, which reads as the agent losing its thread.
          maxTokens: 2048,
          isOwner: true,
          signal: ctl.signal,
          turnId,
        });
        let sofar = "";
        for (;;) {
          const step = await stream.next();
          if (step.done) {
            reply = step.value;
            break;
          }
          const ev = step.value;
          if (ev.type === "text" && ev.text) {
            sofar = sofar ? `${sofar}\n\n${ev.text}` : ev.text;
            streamedRef.current = sofar;
            setStreaming(sofar);
          } else if (ev.type === "tool_call") {
            const label = toolLabel(ev.name);
            setActivity((a) => (a[a.length - 1] === label ? a : [...a, label]));
          }
          // tool_result deliberately clears nothing: finished steps stay on
          // screen until the turn ends, which is what makes the trail read as
          // progress rather than a single label that keeps swapping.
        }
      }
      // Files belong to the message that produced them. They used to live in
      // one shared slot above the composer, so asking a second question threw
      // away the first answer's output.
      made = endTurn(turnId);
      setChat((c) => ({
        ...c,
        turns: [
          ...c.turns,
          { role: "assistant", text: reply, ...(made.length ? { files: made } : {}) },
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
              ...(stoppedFiles.length ? { files: stoppedFiles } : {}),
            },
          ],
        }));
      } else {
        setErr(e instanceof AiError || e instanceof Error ? e.message : String(e));
      }
    } finally {
      endTurn(turnId); // no-op when already drained above — never leaks
      abortRef.current = null;
      streamedRef.current = "";
      setBusy(false);
      setStreaming("");
      setActivity([]);
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
    setHistOpen(true);
  };
  const switchChat = (c: Chat) => {
    setChat(c);
    setActiveId(c.id);
    setErr(null);
    setStreaming("");
    setHistOpen(false);
  };
  const deleteChat = (id: string) => {
    const next = loadChats().filter((c) => c.id !== id);
    saveChats(next);
    setChatList(next.sort((a, b) => b.updatedAt - a.updatedAt));
    if (id === chat.id) startNew();
  };

  const empty = chat.turns.length === 0;

  return (
    <div
      className="relative flex flex-1 items-start gap-6"
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
      {/* Conversation column: header, messages and the composer all share the
          same 760px measure so the eye never jumps between widths. */}
      <div
        ref={topRef}
        className="relative flex min-h-[calc(100vh-7rem)] min-w-0 flex-1 flex-col"
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center rounded-xl border-2 border-dashed border-foreground/30 bg-background/85 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 text-foreground">
              <Paperclip size={28} />
              <p className="text-sm font-semibold text-foreground">Drop a PDF or image to attach</p>
            </div>
          </div>
        )}

        {/* Pinned: New chat, history and memory are needed most in the middle of
            a long conversation, which is exactly where they used to be scrolled
            off the top. On lg+ those controls live in the rail, so only the
            title stays. The blur keeps message text from showing through. */}
        <div className="sticky top-0 z-30 bg-background/85 backdrop-blur">
          <div className={COLUMN}>
          </div>
        </div>

        {/* Messages */}
        <div className={cn(COLUMN, "flex-1 space-y-6 pb-6 pt-2")}>
          {empty && !busy ? (
            <div className="mx-auto mt-8 max-w-xl text-center">
              {/* The empty chat is where the bot has room to be itself, so this
                  one animates: it breathes, blinks and looks around while it
                  waits for a first question. */}
              <div className="mx-auto mb-3 grid h-28 w-28 place-items-center">
                <BloubBot size={112} state="idle" label="Filey AI" ambient />
              </div>
              <p className="text-[20px] font-semibold text-foreground tracking-tight">How can I help with your business?</p>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                Ask anything, or flip on <b>Autonomous</b> to delegate a whole task. I can read and
                act across invoices, customers, inventory, accounting and more.
              </p>
              {/* Openers, not decoration: a blank box gives no clue that this
                  agent can draft documents and chase payments, not just chat. */}
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className={CHIP.replace("shrink-0 ", "")}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            // Turns separate by spacing alone: ChatTurn carries no timestamp
            // (aiChats.ts stores none), so no time meta is invented here.
            chat.turns.map((t, i) => <Bubble key={i} turn={t} />)
          )}

          {busy && (
            <>
              <Bubble
                turn={{ role: "assistant", text: streaming || "" }}
                pending
              />
              {activity.length > 0 && (
                // Tool steps collect into quiet chips under the pending reply:
                // a multi-tool run reads as a visible checklist of work instead
                // of one spinner whose text keeps changing underneath you.
                <div className="flex flex-wrap gap-1.5 pl-11">
                  {activity.map((label, i) => {
                    const Icon = stepIcon(label);
                    return (
                      <span
                        key={`${i}-${label}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] text-muted-foreground"
                      >
                        <Icon size={12} />
                        {label}
                      </span>
                    );
                  })}
                </div>
              )}
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

        {/* Composer — sticky within the column and on the same 760px measure as
            the messages, replacing the old edge-to-edge bar. */}
        <div className="sticky bottom-0 z-20 mt-auto pb-3">
          <div className={COLUMN}>
        {/* Composer toolbar: the chat controls that used to live in a left
            rail, one quiet icon row directly above where you type. */}
        <div className="mb-1.5 flex items-center gap-1">
          <button type="button" onClick={startNew} aria-label="New chat" title="New chat (fresh context)" className="grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-[color,border-color] hover:border-foreground/30 hover:text-foreground"><Plus size={16} /></button>
          <button type="button" onClick={openHistory} aria-label="Chat history" title="Chat history" className="grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-[color,border-color] hover:border-foreground/30 hover:text-foreground"><History size={16} /></button>
          <button type="button" onClick={openMemory} aria-label="Agent memory" title="Memory: what the agent has learned" className="grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-[color,border-color] hover:border-foreground/30 hover:text-foreground"><Brain size={16} /></button>
          <div className="mx-1 h-4 w-px bg-border" />
          <span className="inline-flex max-w-[240px] items-center truncate rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">{chat.title || "New chat"}</span>
        </div>

            {/* Minimal composer: hairline card that darkens its border on focus.
                An input is not a place that needs decorating. While the agent
                runs, the whole card dims — the clearest possible "not typing
                right now" without disabling anything visually louder. */}
            <div
              className={cn(
                "rounded-xl border border-border bg-transparent p-1.5 transition-[border-color,opacity] focus-within:border-muted-foreground/50",
                busy && "opacity-60"
              )}
            >
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
                        className="group relative h-16 w-16 overflow-hidden rounded-xl border border-border bg-muted"
                      >
                        {preview ? (
                          <img
                            src={preview}
                            alt={f.name}
                            className="h-full w-full object-cover"
                            title={f.name}
                          />
                        ) : (
                          <div
                            className="flex h-full flex-col items-center justify-center gap-1 p-1"
                            title={`${f.name} · ${Math.max(1, Math.ceil(f.size / 1024))} KB`}
                          >
                            <FileText size={16} className="text-muted-foreground" />
                            <span className="w-full truncate text-center text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {f.name.split(".").pop()}
                            </span>
                          </div>
                        )}
                        <span className="absolute left-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/60 text-[9px] font-bold text-white">
                          {i + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => attach(files.filter((_, j) => j !== i))}
                          aria-label={`Remove ${f.name}`}
                          className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Input */}
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                disabled={busy}
                placeholder={auto ? "Describe a task to delegate…" : "Message Filey AI…"}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
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
                className="max-h-[160px] min-h-[44px] w-full resize-none bg-transparent px-1.5 py-1.5 text-[13px] leading-relaxed text-foreground outline-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground"
                autoFocus
              />

              {/* Action bar — one circular cluster, reference-style: the same
                  8×8 round slot carries attach, toggles, and send, so the eye
                  reads one row of controls instead of mixed shapes. */}
              <div className="mt-1 flex items-center gap-1">
                <div className="relative shrink-0" ref={plusRef}>
                  <button
                    type="button"
                    onClick={() => setPlusOpen((v) => !v)}
                    disabled={busy}
                    aria-label="Add to message"
                    aria-expanded={plusOpen}
                    title="Add files, repos, skills — Ctrl+U for files"
                    className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
                  >
                    <Paperclip size={16} />
                  </button>

                  <MenuPopover
                    open={plusOpen}
                    onClose={() => setPlusOpen(false)}
                    anchorRef={plusRef}
                    side="top"
                    className="w-[248px]"
                  >
                      {/* Group 0: how much the agent may do — the mode lives in
                          this menu so one control answers both "what can you
                          do" and "what will you do". */}
                      {AGENT_MODES.map((m) => (
                        <MenuItemRow
                          key={m.id}
                          icon={<Zap size={14} />}
                          label={m.name}
                          checked={mode === m.id}
                          onClick={() => {
                            setAgentMode(m.id);
                            setMode(m.id);
                            setPlusOpen(false);
                          }}
                        />
                      ))}

                      <MenuSep />

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
                        label="Capabilities"
                        chevron
                        onClick={() => {
                          setPlusOpen(false);
                          setCapsOpen(true);
                        }}
                      />

                      <MenuSep />

                      {/* Group 3: live toggles */}
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
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    attach(Array.from(e.target.files ?? []));
                    e.target.value = ""; // allow re-selecting the same file
                  }}
                />
                {model && (
                  <span
                    className="hidden items-center rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground sm:inline-flex"
                    title="Model is configured in Settings → AI Assistant"
                  >
                    {model}
                  </span>
                )}
                {/* Autonomous belongs here, not in the page header: it changes what
                    pressing Enter will do, so it sits with the thing you press.
                    Same pill in both states so nothing shifts when it flips; the
                    amber tint is reserved for the ON state, where it means it.
                    The label expands only when ON — off stays a compact icon
                    pill, on announces itself. */}
                <button
                  type="button"
                  onClick={() => setAuto((v) => !v)}
                  aria-pressed={auto}
                  title="Autonomous mode: hand the agent a goal and it plans, acts and verifies on its own."
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border text-[12px] font-medium transition-[color,background-color,border-color,max-width] active:scale-[0.97]",
                    auto
                      ? "border-primary-400/50 bg-primary-400/15 px-2.5 text-foreground"
                      : "w-8 justify-center border-border px-0 text-muted-foreground hover:bg-hover hover:text-foreground"
                  )}
                >
                  <Zap
                    size={13}
                    className={cn(
                      "shrink-0 transition-transform duration-200 motion-reduce:transition-none",
                      auto && "rotate-12 text-primary-600 dark:text-primary-400"
                    )}
                  />
                  {auto ? "Autonomous" : ""}
                </button>
                <div className="flex-1" />
                {/* One button, three states — empty ghost, ready amber,
                    streaming stop — exactly like the reference input. Stop is
                    ink on purpose: an interrupt is not what amber invites. */}
                {busy ? (
                  <button
                    type="button"
                    onClick={stop}
                    aria-label="Stop generating"
                    title="Stop"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80"
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
                      "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors",
                      input.trim() || files.length
                        ? "bg-primary-400 text-zinc-900 hover:bg-primary-500"
                        : "bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground"
                    )}
                  >
                    <ArrowUp size={16} strokeWidth={2.25} />
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1.5 px-2 text-[11px] text-muted-foreground">
              {auto
                ? "Autonomous: the agent runs multiple steps on its own. Money/outbound actions still ask first."
                : "Tip: turn on Autonomous to delegate a whole task. Enter to send · Shift+Enter for a new line."}
            </p>
          </div>
        </div>

        {/* Sensitive-action approval (replaces the native confirm dialog).
            Portaled, like the overlays below: this page renders inside <main>,
            and WebView2 composites a `fixed` overlay into its scrolling
            ancestor's layer and then repaints only part of it. */}
        {pendingConfirm && createPortal(
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-confirm-title"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") settleConfirm(false);
            }}
          >
            <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg">
              <div className="flex items-center gap-2">
                <ShieldAlert size={18} className="text-warning" />
                <p className="font-semibold text-foreground" id="agent-confirm-title">
                  Approve action
                </p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                The assistant wants to run{" "}
                <b className="text-foreground">{pendingConfirm.name}</b>. This can change data
                or send something out.
              </p>
              {Object.keys(pendingConfirm.args).length > 0 && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-muted p-2.5 text-[11px] text-muted-foreground">
                  {JSON.stringify(
                    // Credential-shaped args are masked here just as they are in
                    // the logs — the dialog renders on screen and into screenshots.
                    // save_secret's value is deliberately masked: the agent chose
                    // the value, and the owner approves storing it sight-unseen.
                    redactArgs(pendingConfirm.name, pendingConfirm.args),
                    null,
                    2
                  )}
                </pre>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="btn-ghost"
                  autoFocus
                  onClick={() => settleConfirm(false)}
                >
                  Deny
                </button>
                <button
                  className="btn-primary"
                  onClick={() => settleConfirm(true)}
                >
                  Allow
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Memory viewer */}
        {memOpen && createPortal(
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setMemOpen(false)}
          >
            <div
              className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Brain size={18} className="text-primary-500" />
                  <p className="font-semibold text-foreground">Agent memory</p>
                </div>
                <button
                  onClick={() => setMemOpen(false)}
                  aria-label="Close"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X size={16} />
                </button>
              </div>
              {mems.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nothing learned yet. The agent saves durable facts and preferences
                  here as you chat.
                </p>
              ) : (
                <div className="max-h-[50vh] space-y-2 overflow-auto">
                  {mems.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-start gap-2 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        {m.tag && (
                          <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                            {m.tag}
                          </span>
                        )}
                        <span className="text-sm text-foreground">{m.text}</span>
                      </div>
                      <button
                        onClick={() => removeMem(m.id)}
                        aria-label="Forget"
                        className="shrink-0 text-muted-foreground hover:text-danger"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {mems.length > 0 && (
                <div className="mt-4 flex justify-end">
                  <button
                    className="btn-ghost text-danger"
                    onClick={wipeMem}
                  >
                    Clear all memory
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}

        {/* Chat history drawer — the sub-lg path to older chats; on lg+ the rail
            covers browsing, but delete-from-history stays drawer-only. */}
        {histOpen && createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/40"
            role="dialog"
            aria-modal="true"
            onClick={() => setHistOpen(false)}
          >
            <div
              className="absolute left-0 top-0 flex h-full w-80 max-w-[85vw] flex-col border-r border-border bg-card shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <p className="font-semibold text-foreground">Chats</p>
                <button
                  onClick={() => setHistOpen(false)}
                  aria-label="Close"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X size={16} />
                </button>
              </div>
              <button
                onClick={() => {
                  startNew();
                  setHistOpen(false);
                }}
                className="m-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-hover"
              >
                <Plus size={15} /> New chat
              </button>
              <div className="flex-1 space-y-1 overflow-auto px-2 pb-3">
                {chatList.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No chats yet.
                  </p>
                ) : (
                  chatList.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => switchChat(c)}
                      className={cn(
                        "group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-colors",
                        c.id === chat.id
                          ? "bg-primary-400/15"
                          : "hover:bg-hover"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                        {c.title || "New chat"}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteChat(c.id);
                        }}
                        aria-label="Delete chat"
                        className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
        <AutomationsDrawer open={autoOpen} onClose={() => setAutoOpen(false)} />
        <SkillsDrawer open={skillsOpen} onClose={() => setSkillsOpen(false)} />
        <CapabilitiesDrawer open={capsOpen} onClose={() => setCapsOpen(false)} />
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
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** Tool name → something a business owner recognises. Unknown tools fall back
 *  to their own name with the underscores taken out, which reads well enough
 *  that new tools need no entry here to be presentable. */
function toolLabel(name: string): string {
  const known: Record<string, string> = {
    create_invoice_draft: "Drafting the invoice",
    create_quote: "Drafting the quote",
    create_purchase_order: "Drafting the purchase order",
    create_customer: "Adding the customer",
    create_product: "Adding the product",
    adjust_stock: "Updating stock",
    log_expense: "Logging the expense",
    send_invoice: "Sending the invoice",
    email_invoice: "Emailing the invoice",
    mark_invoice_paid: "Marking it paid",
    get_stats: "Checking the numbers",
    find_customers: "Looking up customers",
    find_products: "Looking up products",
    list_invoices: "Looking up invoices",
    list_whatsapp_messages: "Reading WhatsApp",
    send_whatsapp: "Sending on WhatsApp",
    read_web_page: "Reading the page",
    search_web: "Searching the web",
    recall: "Checking what I remember",
    remember: "Saving that for later",
    run_file_tool: "Working on the file",
  };
  return known[name] ?? `${name.replace(/_/g, " ")}…`;
}

/** Presentational icon for a tool-step chip, picked from the label wording —
 *  activity state keeps the human label, not the raw tool name. Reads/writes/
 *  sends get distinct glyphs; anything else gets the generic spark. */
function stepIcon(label: string): typeof Hammer {
  const s = label.toLowerCase();
  if (s.includes("remember") || s.includes("memory") || s.includes("recall")) return Brain;
  if (s.includes("send") || s.includes("email")) return Zap;
  if (
    s.includes("draft") ||
    s.includes("add") ||
    s.includes("log") ||
    s.includes("updat") ||
    s.includes("work")
  )
    return Hammer;
  return Sparkles;
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
        {!pending && turn.text.trim() && (
          <div className="mt-0.5 flex opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
            <CopyButton text={turn.text} />
          </div>
        )}
        {!!turn.files?.length && (
          <div className="mt-2 flex flex-wrap gap-2">
            {turn.files.map((f, i) =>
              // Desktop: the file is already on disk, so open it where it
              // landed. Browser: hand over the blob as a real download.
              f.path ? (
                <button
                  key={i}
                  type="button"
                  title={f.path}
                  onClick={() => void openFolder(f.path!)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-hover"
                >
                  <FolderOpen size={12} />
                  <span className="max-w-[200px] truncate">{f.name}</span>
                </button>
              ) : f.url ? (
                <a
                  key={i}
                  href={f.url}
                  download={f.name}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-hover"
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
    void bridgeState().then(setSt);
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
          On your phone: WhatsApp → Settings → <b>Linked devices</b> → Link a
          device. The code refreshes on its own if it expires.
        </p>
      </div>
    </div>
  );
}
