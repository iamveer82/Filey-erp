import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  title?: string;
  avatar?: string; // initials for a circle avatar
  to?: string; // optional navigation target on click
}
interface NotifyOpts {
  title: string;
  message: string;
  avatar?: string;
  to?: string;
}

interface ConfirmOpts {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
interface PromptOpts {
  title: string;
  label?: string;
  defaultValue?: string;
  confirmLabel?: string;
  placeholder?: string;
}

interface UIValue {
  toast: {
    success: (m: string) => void;
    error: (m: string) => void;
    info: (m: string) => void;
    /** Rich floating notification with avatar + title + message. */
    notify: (opts: NotifyOpts) => void;
  };
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
}

const Ctx = createContext<UIValue | null>(null);

let nextId = 1;

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<
    (ConfirmOpts & { resolve: (v: boolean) => void }) | null
  >(null);
  const [promptState, setPromptState] = useState<
    (PromptOpts & { resolve: (v: string | null) => void }) | null
  >(null);
  const promptInput = useRef<HTMLInputElement>(null);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const add = useCallback(
    (toast: Omit<Toast, "id">, ttl = 4000) => {
      const id = nextId++;
      setToasts((t) => [...t, { ...toast, id }]);
      setTimeout(() => dismiss(id), ttl);
    },
    [dismiss]
  );

  const toast = {
    success: (m: string) => add({ kind: "success", message: m }),
    error: (m: string) => add({ kind: "error", message: m }),
    info: (m: string) => add({ kind: "info", message: m }),
    notify: (o: NotifyOpts) =>
      add(
        {
          kind: "info",
          message: o.message,
          title: o.title,
          avatar: o.avatar,
          to: o.to,
        },
        6000
      ),
  };

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) =>
        setConfirmState({ ...opts, resolve })
      ),
    []
  );

  const prompt = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) =>
        setPromptState({ ...opts, resolve })
      ),
    []
  );

  const closeConfirm = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirmState(null);
  };
  const closePrompt = (v: string | null) => {
    promptState?.resolve(v);
    setPromptState(null);
  };

  const TOAST_STYLE: Record<ToastKind, string> = {
    success: "text-success bg-white dark:bg-[#24262C] border-success/30",
    error: "text-danger bg-white dark:bg-[#24262C] border-danger/30",
    info: "text-brand-700 dark:text-[#DDE0E4] bg-white dark:bg-[#24262C] border-brand-200 dark:border-[#3A3D45]",
  };
  const TOAST_ICON: Record<ToastKind, ReactNode> = {
    success: <CheckCircle2 size={16} className="text-success" />,
    error: <AlertCircle size={16} className="text-danger" />,
    info: <Info size={16} className="text-brand-500" />,
  };

  return (
    <Ctx.Provider value={{ toast, confirm, prompt }}>
      {children}

      {/* toasts */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => {
          const clickable = !!t.to;
          return (
            <div
              key={t.id}
              role="status"
              onClick={() => {
                if (t.to) window.location.hash = `#${t.to}`;
                if (clickable) dismiss(t.id);
              }}
              className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-bento text-sm font-semibold animate-fade-up ${
                TOAST_STYLE[t.kind]
              } ${clickable ? "cursor-pointer hover:shadow-bento-hover" : ""}`}
            >
              {t.avatar ? (
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-100 text-primary-700 text-[11px] font-bold">
                  {t.avatar}
                </span>
              ) : (
                <span className="mt-px shrink-0">{TOAST_ICON[t.kind]}</span>
              )}
              <span className="min-w-0">
                {t.title && (
                  <span className="block text-ink font-bold">{t.title}</span>
                )}
                <span className="block text-ink/90 dark:text-white/80 font-normal break-words">
                  {t.message}
                </span>
              </span>
              <button
                aria-label="Dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(t.id);
                }}
                className="ml-auto text-brand-400 hover:text-ink cursor-pointer shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {/* confirm dialog */}
      {confirmState && (
        <div
          className="fixed inset-0 z-[101] bg-ink/40 backdrop-blur-sm grid place-items-center p-4"
          onClick={() => closeConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#24262C] shadow-bento-hover p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-bold text-ink text-lg">{confirmState.title}</p>
            {confirmState.message && (
              <p className="text-sm text-brand-500 mt-1.5">
                {confirmState.message}
              </p>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <button className="btn-ghost" onClick={() => closeConfirm(false)}>
                {confirmState.cancelLabel ?? "Cancel"}
              </button>
              <button
                className={confirmState.danger ? "btn-danger" : "btn-primary"}
                onClick={() => closeConfirm(true)}
              >
                {confirmState.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* prompt dialog */}
      {promptState && (
        <div
          className="fixed inset-0 z-[101] bg-ink/40 backdrop-blur-sm grid place-items-center p-4"
          onClick={() => closePrompt(null)}
        >
          <form
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#24262C] shadow-bento-hover p-6"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              closePrompt(promptInput.current?.value ?? "");
            }}
          >
            <p className="font-bold text-ink text-lg">{promptState.title}</p>
            {promptState.label && (
              <label className="label mt-3">{promptState.label}</label>
            )}
            <input
              ref={promptInput}
              autoFocus
              className="input mt-1"
              placeholder={promptState.placeholder}
              defaultValue={promptState.defaultValue}
            />
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => closePrompt(null)}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                {promptState.confirmLabel ?? "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useUI(): UIValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("useUI must be used within UIProvider");
  return c;
}
