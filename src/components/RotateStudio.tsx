import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, RotateCw, Check } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { rotatePdf, type OutFile } from "../lib/pdfTools";
import { useUI } from "../lib/ui";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/* Dead-simple rotate: tap the round arrows to spin every page, see it live,
 * then apply & download. No degree dropdowns. */

const RENDER_W = 800;

export default function RotateStudio({
  file,
  onApply,
}: {
  file: File;
  onApply: (out: OutFile) => void;
}) {
  const { toast } = useUI();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [pageImg, setPageImg] = useState("");
  const [aspect, setAspect] = useState<{ w: number; h: number } | null>(null);
  const [angle, setAngle] = useState(0); // 0 | 90 | 180 | 270
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        const p = await pdf.getPage(1);
        const pt = p.getViewport({ scale: 1 });
        if (dead) return;
        setAspect({ w: pt.width, h: pt.height });
        const scale = RENDER_W / pt.width;
        const vp = p.getViewport({ scale });
        const c = document.createElement("canvas");
        c.width = vp.width;
        c.height = vp.height;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        await p.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
        if (!dead) setPageImg(c.toDataURL("image/png"));
      } catch (e) {
        if (!dead) toastRef.current.error(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      dead = true;
    };
  }, [file]);

  const spin = (d: number) => setAngle((a) => (((a + d) % 360) + 360) % 360);

  const apply = async () => {
    if (angle === 0) {
      toastRef.current.error("Rotate the page first.");
      return;
    }
    setSaving(true);
    try {
      const out = await rotatePdf(file, angle);
      onApply(out);
      toast.success(`Rotated ${angle}° & downloaded.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Swap aspect box when rotated a quarter-turn so the preview fits.
  const quarter = angle === 90 || angle === 270;
  const boxAspect = aspect
    ? quarter
      ? `${aspect.h} / ${aspect.w}`
      : `${aspect.w} / ${aspect.h}`
    : undefined;

  return (
    <div>
      <div className="mb-3 flex items-center justify-center gap-2">
        <button onClick={() => spin(-90)} className="btn-ghost h-10 w-12" title="Rotate left">
          <RotateCcw size={18} />
        </button>
        <span className="w-16 text-center text-sm font-bold tabular-nums text-ink">{angle}°</span>
        <button onClick={() => spin(90)} className="btn-ghost h-10 w-12" title="Rotate right">
          <RotateCw size={18} />
        </button>
      </div>

      <div
        className="mx-auto grid w-full max-w-xl place-items-center overflow-hidden rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-[#3A3D45] dark:bg-black/20"
        style={{ minHeight: 360 }}
      >
        {pageImg ? (
          <div
            className="overflow-hidden bg-white shadow"
            style={{ aspectRatio: boxAspect, maxHeight: 420, maxWidth: "100%" }}
          >
            <img
              src={pageImg}
              alt="preview"
              draggable={false}
              className="h-full w-full select-none object-contain transition-transform duration-200"
              style={{ transform: `rotate(${angle}deg)` }}
            />
          </div>
        ) : (
          <Loader2 size={22} className="animate-spin text-brand-400" />
        )}
      </div>

      <button onClick={apply} disabled={saving || angle === 0} className="btn-primary mt-4 w-full">
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
        Apply rotation to all pages & download
      </button>
    </div>
  );
}
