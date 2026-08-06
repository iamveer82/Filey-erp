import { useEffect, useState } from "react";
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
const CACHE_TTL = 240_000;
const signed = new Map<string, { url: string; ts: number }>();

/** Render a company asset from either a signed/data URL or a Supabase Storage
 *  path. A storage path is resolved to a signed (cloud) or data: (local) URL
 *  first; until it resolves — or if it can't — nothing is rendered, so a dead
 *  path never shows a broken-image placeholder. */
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
  // Storage paths start unresolved (undefined) so we never paint a raw path
  // into <img src> — that's what produced the broken-image placeholder. A
  // still-valid signed URL from an earlier render paints immediately.
  const [url, setUrl] = useState<string | undefined>(() =>
    path ? fromCache(path) : src
  );

  useEffect(() => {
    if (!src) return setUrl(undefined);
    if (!path) return setUrl(src);
    const hit = fromCache(path);
    if (hit) return setUrl(hit);
    let alive = true;
    setUrl(undefined);
    void companyAssetUrl(path).then((u) => {
      if (!alive || !u) return;
      signed.set(path, { url: u, ts: Date.now() });
      setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [src, path]);

  if (!url) return null;
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      style={style}
      draggable={false}
      // A signed URL can expire between render and load (clock skew, a tab left
      // open). Drop the cached one and sign again rather than leaving the
      // customer looking at a broken stamp on their invoice.
      onError={() => {
        if (!path) return;
        signed.delete(path);
        void companyAssetUrl(path).then((u) => {
          if (!u || u === url) return;
          signed.set(path, { url: u, ts: Date.now() });
          setUrl(u);
        });
      }}
    />
  );
}

function fromCache(path: string): string | undefined {
  const hit = signed.get(path);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > CACHE_TTL) {
    signed.delete(path);
    return undefined;
  }
  return hit.url;
}
