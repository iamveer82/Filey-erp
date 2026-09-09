import { useEffect, useState } from "react";
import { Monitor, Square } from "lucide-react";
import {
  computerUseSupported,
  getComputerUseState,
  subscribeComputerUse,
  enableComputerUse,
  disableComputerUse,
} from "../lib/computerUse";

export default function ComputerUseControls({ onStop }: { onStop: () => void }) {
  const [state, setState] = useState(getComputerUseState);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  useEffect(() => subscribeComputerUse(() => setState(getComputerUseState())), []);
  const change = async (enable: boolean) => {
    setError("");
    setChanging(true);
    try {
      if (enable) await enableComputerUse(300);
      else {
        onStop();
        await disableComputerUse();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Computer access could not be changed.");
    } finally {
      setChanging(false);
    }
  };
  return (
    <details className="mt-2 border-t border-border pt-2 text-[13px]">
      <summary className="cursor-pointer py-1 text-muted-foreground">
        <span className="ml-1 inline-flex items-center gap-2">
          <Monitor size={14} />
          Computer access
          <span className={state.enabled ? "text-foreground" : ""}>
            · {state.enabled ? "Enabled temporarily" : "Off"}
          </span>
        </span>
      </summary>
      <div className="mt-3 flex flex-wrap items-start gap-3">
        <p className="min-w-0 flex-1 basis-72 leading-relaxed text-muted-foreground">
          {computerUseSupported()
            ? "Allow Filey to view selected Windows apps and use the mouse and keyboard for five minutes. Screenshots go to your selected AI model. Leaving this chat ends access; you can also stop it here at any time."
            : "Computer control is available in the Windows desktop app. Filey tools and connected services work here without computer access."}
        </p>
        <button
          type="button"
          className={state.enabled ? "btn-ghost" : "btn-primary"}
          disabled={changing || !computerUseSupported()}
          onClick={() => void change(!state.enabled)}
        >
          {state.enabled && <Square size={14} />}
          {changing
            ? "Updating…"
            : state.enabled
              ? "Stop computer access"
              : "Enable for 5 minutes"}
        </button>
      </div>
      {state.enabled && state.expiresAt && (
        <p className="mt-2 text-xs text-muted-foreground">
          Access ends at{" "}
          {new Date(state.expiresAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
          .
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </details>
  );
}
