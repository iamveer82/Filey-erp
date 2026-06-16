import { useEffect, useState } from "react";
import { companyAssetUrl } from "../lib/files";

/** Render a company asset from either a signed URL or a Supabase Storage path.
 * If the value looks like a storage path, it refreshes a short-lived signed URL. */
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
  const [url, setUrl] = useState(src);

  useEffect(() => {
    if (!src) return;
    // Storage paths contain /company/ or start with {uid}/company/
    if (src.includes("/company/") || src.startsWith("files/")) {
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
