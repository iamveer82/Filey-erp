import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import {
  checkForUpdateStrict,
  hasDesktop,
  installUpdate,
  type UpdateInfo,
} from "../lib/updater";

/* Which version am I on, and pull a new one now.
 *
 * The banner only looks on launch and then every few hours, so an install that
 * missed its check had no way to ask. This is that way. */

type State =
  | { k: "idle" }
  | { k: "checking" }
  | { k: "current" }
  | { k: "failed"; msg: string }
  | { k: "found"; info: UpdateInfo }
  | { k: "installing"; pct: number };

export default function UpdateCard() {
  const [version, setVersion] = useState<string | null>(null);
  const [state, setState] = useState<State>({ k: "idle" });

  useEffect(() => {
    let alive = true;
    if (!hasDesktop) return;
    getVersion()
      .then((v) => alive && setVersion(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // The updater is a desktop capability; in the browser there is nothing to do.
  if (!hasDesktop) return null;

  const look = async () => {
    setState({ k: "checking" });
    try {
      const info = await checkForUpdateStrict();
      setState(info ? { k: "found", info } : { k: "current" });
    } catch (e) {
      setState({
        k: "failed",
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const install = async (info: UpdateInfo) => {
    setState({ k: "installing", pct: 0 });
    try {
      // Relaunches on success, so there is no "done" state to render.
      await installUpdate(info.handle, (pct) =>
        setState({ k: "installing", pct })
      );
    } catch (e) {
      setState({
        k: "failed",
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const busy = state.k === "checking" || state.k === "installing";

  return (
    <div className="card">
      <p className="font-medium text-ink">App version</p>
      <p className="text-sm text-brand-500 mt-0.5 mb-4">
        You're running Filey {version ?? "…"}.
      </p>

      {state.k === "found" ? (
        <div className="space-y-3">
          <p className="text-sm text-ink">
            Version {state.info.version} is available.
          </p>
          {state.info.notes && (
            <p className="text-[13px] text-brand-500 whitespace-pre-line max-h-40 overflow-y-auto">
              {state.info.notes}
            </p>
          )}
          <button className="btn-primary" onClick={() => install(state.info)}>
            Update and restart
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button className="btn-ghost" onClick={look} disabled={busy}>
            {busy ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <RefreshCw size={15} />
            )}
            {state.k === "installing"
              ? `Installing ${state.pct}%`
              : state.k === "checking"
                ? "Checking…"
                : "Check for updates"}
          </button>
          {state.k === "current" && (
            <span className="text-sm text-brand-500">You're up to date.</span>
          )}
          {state.k === "failed" && (
            <span className="text-sm text-danger">
              Couldn't check: {state.msg}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
