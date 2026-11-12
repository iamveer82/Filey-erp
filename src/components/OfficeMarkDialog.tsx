import { useEffect, useRef, useState } from "react";
import { MousePointer2, X } from "lucide-react";
import type { Box } from "../lib/officePlacement";
import type { OfficeMarkImage } from "../lib/officeWord";

interface Props {
  image: OfficeMarkImage;
  onCancel: () => void;
  onConfirm: (rect: Box) => void;
}

/** Mark where an image belongs: the person drags a circle or box on a page/slide
 *  image and the app turns it into page points. Not a screenshot annotator:
 *  the image is the app's own page export, so the mapping is exact. */
export default function OfficeMarkDialog({ image, onCancel, onConfirm }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rect, setRect] = useState<Box | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  const fitCanvas = () => {
    const img = imgRef.current, canvas = canvasRef.current;
    if (!img || !canvas) return;
    if (canvas.width !== img.clientWidth || canvas.height !== img.clientHeight) {
      canvas.width = img.clientWidth;
      canvas.height = img.clientHeight;
    }
    draw(rect);
  };

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const box = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, event.clientX - box.left)),
      y: Math.max(0, Math.min(canvas.height, event.clientY - box.top)),
    };
  };

  const draw = (area: Box | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!area) return;
    ctx.save();
    ctx.fillStyle = "rgba(37, 99, 235, 0.14)";
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.ellipse(area.x + area.width / 2, area.y + area.height / 2, area.width / 2, area.height / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeRect(area.x, area.y, area.width, area.height);
    ctx.restore();
  };

  useEffect(() => {
    fitCanvas();
    const onResize = () => fitCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // fitCanvas also redraws the current rect; re-running on every rect change would fight the drag.
  }, [image.dataUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event);
    setDrag(p);
    setRect({ x: p.x, y: p.y, width: 0, height: 0 });
    draw({ x: p.x, y: p.y, width: 0, height: 0 });
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag) return;
    const p = point(event);
    const next = {
      x: Math.min(drag.x, p.x),
      y: Math.min(drag.y, p.y),
      width: Math.abs(p.x - drag.x),
      height: Math.abs(p.y - drag.y),
    };
    setRect(next);
    draw(next);
  };

  const end = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  };

  const confirm = () => {
    const canvas = canvasRef.current, img = imgRef.current;
    if (!rect || !canvas || !img || rect.width < 4 || rect.height < 4) return;
    const naturalWidth = img.naturalWidth || image.width || canvas.width;
    const naturalHeight = img.naturalHeight || image.height || canvas.height;
    const sx = (image.pageWidth ?? naturalWidth) / naturalWidth;
    const sy = (image.pageHeight ?? naturalHeight) / naturalHeight;
    onConfirm({ x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy });
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Mark placement" className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4">
      <div className="w-full max-w-4xl rounded-2xl border border-border bg-card p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Where should it go?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Drag a circle or a box around the place on the {image.kind === "slide" ? "slide" : image.kind === "sheet" ? "sheet" : "page"}. The exact area is sent to Filey.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onCancel} className="btn-ghost h-9 w-9 shrink-0 !px-0">
            <X size={16} />
          </button>
        </div>
        <div className="grid max-h-[68vh] place-items-center overflow-auto rounded-xl border border-border bg-muted p-2">
          <div className="relative inline-block max-w-full">
            <img ref={imgRef} src={image.dataUrl} alt="Page to mark" className="block max-h-[62vh] max-w-full select-none" onLoad={fitCanvas} draggable={false} />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MousePointer2 size={14} /> Drag anywhere; drag again to adjust.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="button" className="btn-primary" disabled={!rect || rect.width < 4 || rect.height < 4} onClick={confirm}>
              Use this area
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
