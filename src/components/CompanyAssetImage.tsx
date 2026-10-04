import { useEffect, useReducer, useRef, useState } from "react";
import { AGENT_STORAGE_EVENT, agentStorageScope } from "../lib/agentStorage";
import { companyAssetUrl } from "../lib/files";

/** A Supabase Storage path looks like `…/company/…` or starts with `files/`.
 *  A data: URL (local mode) or an http(s)/blob URL is already renderable. */
const isStoragePath = (s: string) =>
  !s.startsWith("data:") &&
  !s.startsWith("blob:") &&
  !s.startsWith("http") &&
  (s.includes("/company/") || s.startsWith("files/"));

// Signed URLs last 300s, so re-use one for 4 minutes rather than re-signing on
// every mount — the same stamp is rendered by the editor, the preview and the
// print sheet. In memory on purpose: a signed URL persisted to storage would
// outlive its own expiry and come back as a broken image after a restart.
// Private URLs belong to the account, workspace and storage mode that signed
// them; another session must resolve the path under its own permissions.
const CACHE_TTL = 240_000;
const signed = new Map<string, { url: string; ts: number }>();

/** Render a company asset from either a signed/data URL or a Supabase Storage
 *  path. A storage path is resolved to a signed (cloud) or data: (local) URL
 *  first. A hidden image exposes readiness so export waits for private assets
 *  without showing broken-image placeholders while their URLs resolve. */
export function CompanyAssetImage({
  src,
  alt,
  className,
  style,
}: {
  src?: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const path = src && isStoragePath(src) ? src : undefined;
  const scope = agentStorageScope();
  const cacheKey = path && scope ? JSON.stringify([scope, path]) : undefined;
  const [, refreshScope] = useReducer(value => value + 1, 0);
  useEffect(() => {
    const changed = () => refreshScope();
    for (const event of [AGENT_STORAGE_EVENT, "filey:workspace-changed", "filey:workspace-transition", "storage"])
      window.addEventListener(event, changed);
    return () => {
      for (const event of [AGENT_STORAGE_EVENT, "filey:workspace-changed", "filey:workspace-transition", "storage"])
        window.removeEventListener(event, changed);
    };
  }, []);
  // Storage paths start unresolved (undefined) so we never paint a raw path
  // into <img src> — that's what produced the broken-image placeholder. A
  // still-valid signed URL from an earlier render paints immediately.
  const [image, setImage] = useState(() => ({ source: src, scope, url: path ? fromCache(cacheKey) : src, status: "loading" as "loading" | "ready" | "error" }));
  const request = useRef(0);
  const retried = useRef(false);
  const current = image.source === src && image.scope === scope ? image : { source: src, scope, url: undefined, status: "loading" as const };
  const url = current.url;

  useEffect(() => {
    const active = ++request.current;
    retried.current = false;
    const resolved = path ? fromCache(cacheKey) : src;
    const activeScope = () => active === request.current && scope === agentStorageScope();
    setImage((previous) => previous.source === src && previous.scope === scope && previous.url === resolved ? previous : { source: src, scope, url: resolved, status: "loading" });
    if (path && !resolved) {
      void companyAssetUrl(path).then((value) => {
        if (!activeScope()) return;
        if (value && cacheKey) signed.set(cacheKey, { url: value, ts: Date.now() });
        setImage({ source: src, scope, url: value || undefined, status: value ? "loading" : "error" });
      }).catch(() => {
        if (activeScope()) setImage({ source: src, scope, url: undefined, status: "error" });
      });
    }
    return () => { request.current = active + 1; };
  }, [src, path, scope, cacheKey]);

  if (!src) return null;
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      style={{ ...style, display: current.status === "ready" ? style?.display : "none" }}
      draggable={false}
      hidden={current.status !== "ready"}
      data-company-asset-status={current.status}
      onLoad={() => {
        if (url && scope === agentStorageScope())
          setImage((previous) => previous.source === src && previous.scope === scope && previous.url === url ? { ...previous, status: "ready" } : previous);
      }}
      // A signed URL can expire between render and load (clock skew, a tab left
      // open). Drop the cached one and sign again rather than leaving the
      // customer looking at a broken stamp on their invoice.
      onError={() => {
        if (scope !== agentStorageScope()) return;
        if (cacheKey) signed.delete(cacheKey);
        if (!path || retried.current) {
          setImage((previous) => ({ ...previous, status: "error" }));
          return;
        }
        retried.current = true;
        const active = request.current;
        setImage((previous) => ({ ...previous, status: "loading" }));
        void companyAssetUrl(path).then((value) => {
          if (active !== request.current || scope !== agentStorageScope()) return;
          if (value && value !== url && cacheKey) signed.set(cacheKey, { url: value, ts: Date.now() });
          setImage({ source: src, scope, url: value || undefined, status: value && value !== url ? "loading" : "error" });
        }).catch(() => {
          if (active === request.current && scope === agentStorageScope()) setImage({ source: src, scope, url: undefined, status: "error" });
        });
      }}
    />
  );
}

function fromCache(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const hit = signed.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > CACHE_TTL) {
    signed.delete(key);
    return undefined;
  }
  return hit.url;
}
