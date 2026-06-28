import { useEffect, useState } from "react";
import { companyAssetUrl } from "../lib/files";

/** A Supabase Storage path looks like `…/company/…` or starts with `files/`.
 *  A data: URL (local mode) or an http(s)/blob URL is already renderable. */
const isStoragePath = (s: string) =>
  !s.startsWith("data:") &&
  !s.startsWith("blob:") &&
  !s.startsWith("http") &&
  (s.includes("/company/") || s.startsWith("files/"));

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
  // Storage paths start unresolved (undefined) so we never paint a raw path
  // into <img src> — that's what produced the broken-image placeholder.
  const [url, setUrl] = useState<string | undefined>(
    src && isStoragePath(src) ? undefined : src
  );

  useEffect(() => {
    if (!src) {
      setUrl(undefined);
      return;
    }
    if (isStoragePath(src)) {
      setUrl(undefined);
      let alive = true;
      companyAssetUrl(src).then((u) => {
        if (alive && u) setUrl(u);
      });
      return () => {
        alive = false;
      };
    }
    setUrl(src);
  }, [src]);

  if (!url) return null;
  return <img src={url} alt={alt} className={className} style={style} draggable={false} />;
}
