import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ShieldCheck } from "lucide-react";

import { FileySpinner as Loader2 } from "./FileySpinner";
import {
  CHANNEL_TOOLKIT,
  beginChannelAuthorization,
  channelAuthError,
  connectedOAuthChannels,
  needsIntegrationSetup,
  waitForChannelAuthorization,
  type OAuthChannelId,
} from "../lib/channelOAuth";

/** Where the user revokes Filey on the provider side. */
const MANAGE_ACCESS: Record<OAuthChannelId, string> = {
  slack: "https://slack.com/apps/manage",
  discord: "https://discord.com/settings/authorized-apps",
  teams: "https://myapplications.microsoft.com/",
};

export interface ChannelAuthState {
  /** true = authorized, false = not authorized, null = not known yet. */
  connected: boolean | null;
  opening: boolean;
  waiting: boolean;
  message: string;
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
}

/** Shared authorization state for one channel: opens the provider's own consent
 *  page, then watches the connected account until it is approved. */
export function useChannelAuth(
  id: OAuthChannelId,
  label: string,
  onConnected?: () => void
): ChannelAuthState {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [opening, setOpening] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [message, setMessage] = useState("");
  const alive = useRef(true);
  const run = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      const set = await connectedOAuthChannels({ fresh: true });
      if (alive.current) setConnected(set.has(CHANNEL_TOOLKIT[id]));
    } catch {
      // Signed out or the service is unreachable. Keep the last known answer;
      // the Connect button still lets the user try and shows the real error.
    }
  }, [id]);

  useEffect(() => {
    alive.current = true;
    void connectedOAuthChannels()
      .then((set) => {
        if (alive.current) setConnected(set.has(CHANNEL_TOOLKIT[id]));
      })
      .catch(() => {});
    // The user finishes in their browser; coming back is the strongest signal
    // that the pending account settled, long before the poll would notice.
    const onFocus = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      alive.current = false;
      run.current?.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, [id, refresh]);

  const connect = useCallback(async () => {
    if (opening || waiting) return;
    const controller = new AbortController();
    run.current = controller;
    setOpening(true);
    setMessage("");
    try {
      const auth = await beginChannelAuthorization(id);
      if (!alive.current) return;
      setOpening(false);
      setWaiting(true);
      setMessage(
        `Approve the request in the browser window. This page updates by itself when you're done.`
      );
      const result = await waitForChannelAuthorization(auth.accountId, {
        signal: controller.signal,
      });
      if (!alive.current || controller.signal.aborted) return;
      setWaiting(false);
      if (result.ok) {
        setConnected(true);
        setMessage(`${label} is authorized. Filey can now read and post there.`);
        onConnected?.();
        return;
      }
      if (result.reason === "denied") {
        setMessage(
          result.message
            ? `${label} did not authorize the connection: ${result.message}`
            : `${label} did not authorize the connection. Try again, or use a webhook instead.`
        );
        return;
      }
      if (result.reason === "pending") {
        setMessage(
          `Still waiting for ${label}. Finish in the browser, then come back here — this page checks again when you return.`
        );
      }
    } catch (cause) {
      if (alive.current) setMessage(channelAuthError(cause));
    } finally {
      if (alive.current) {
        setOpening(false);
        setWaiting(false);
      }
      if (run.current === controller) run.current = null;
    }
  }, [id, label, onConnected, opening, waiting]);

  return { connected, opening, waiting, message, connect, refresh };
}

function errorClass(): string {
  return "mt-3 max-w-[65ch] text-[13px] leading-relaxed text-danger";
}

function infoClass(): string {
  return "mt-3 max-w-[65ch] text-[13px] leading-relaxed text-muted-foreground";
}

function looksLikeFailure(message: string): boolean {
  return (
    needsIntegrationSetup(message) ||
    /did not authorize|could not|blocked|sign in|error/i.test(message)
  );
}

/** Full connection panel on the channel's own page. */
export default function ChannelOAuthPanel({
  id,
  label,
  auth,
}: {
  id: OAuthChannelId;
  label: string;
  auth: ChannelAuthState;
}) {
  const { connected, opening, waiting, message, connect } = auth;
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-medium">
        {connected ? `${label} is authorized` : `Connect with ${label}`}
      </h3>
      <p className="mt-2 max-w-[65ch] text-[13px] leading-relaxed text-muted-foreground">
        {connected
          ? `The agent can read and post in ${label} with the account you approved. You can revoke it in ${label} at any time.`
          : `Filey opens ${label}'s own authorization page. Approve it once and the agent can read and post in your workspace — no webhook URL to copy.`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={opening || waiting}
          onClick={() => void connect()}
        >
          {opening || waiting ? <Loader2 size={14} className="animate-spin" /> : null}
          {waiting
            ? "Waiting for approval…"
            : opening
              ? "Opening…"
              : connected
                ? `Reconnect ${label}`
                : `Connect ${label}`}
        </button>
        {connected && (
          <a
            className="btn-ghost inline-flex items-center gap-1.5"
            href={MANAGE_ACCESS[id]}
            target="_blank"
            rel="noopener noreferrer"
          >
            Manage access <ArrowUpRight size={14} />
          </a>
        )}
      </div>
      {message && (
        <p role="status" className={looksLikeFailure(message) ? errorClass() : infoClass()}>
          {message}
        </p>
      )}
      {needsIntegrationSetup(message) && (
        <Link
          className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium underline underline-offset-4"
          to="/integrations?tab=available"
        >
          Add a Composio key <ArrowUpRight size={14} />
        </Link>
      )}
      <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" />
        <span>
          The approval happens on {label}'s site; Filey never sees your password. The
          connection is saved to this workspace and can be revoked from {label}.
        </span>
      </p>
    </div>
  );
}

/** Inline Connect button for the compact channel rows. */
export function ChannelOAuthButton({
  label,
  auth,
}: {
  label: string;
  auth: ChannelAuthState;
}) {
  const { connected, opening, waiting, message, connect } = auth;
  return (
    <>
      <button
        type="button"
        className="btn-primary"
        aria-label={connected ? `Reconnect ${label}` : `Connect ${label}`}
        disabled={opening || waiting}
        onClick={() => void connect()}
      >
        {opening || waiting ? <Loader2 size={14} className="animate-spin" /> : null}
        {waiting
          ? "Waiting for approval…"
          : opening
            ? "Opening…"
            : connected
              ? "Reconnect"
              : "Connect"}
      </button>
      {message && (
        <p
          role="status"
          className={
            looksLikeFailure(message)
              ? "mt-2 basis-full text-[13px] leading-relaxed text-danger"
              : "mt-2 basis-full text-[13px] leading-relaxed text-muted-foreground"
          }
        >
          {message}
        </p>
      )}
      {needsIntegrationSetup(message) && (
        <Link
          className="basis-full text-[13px] font-medium underline underline-offset-4"
          to="/integrations?tab=available"
        >
          Add a Composio key
        </Link>
      )}
    </>
  );
}
