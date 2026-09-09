import type { ReactNode } from "react";
import { Minus, Monitor, Plus, Smartphone } from "lucide-react";

export default function DocumentPreviewControls({
  device,
  onDeviceChange,
  zoom,
  onZoomChange,
  minZoom = 50,
  maxZoom = 150,
  children,
}: {
  device: "desktop" | "mobile";
  onDeviceChange: (device: "desktop" | "mobile") => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  minZoom?: number;
  maxZoom?: number;
  children?: ReactNode;
}) {
  return (
    <div className="no-print mt-3 flex flex-wrap items-center justify-between gap-3" role="group" aria-label="Document preview controls">
      <div className="flex items-center gap-1" role="group" aria-label="Preview size">
        <button type="button" className="btn-ghost h-10 w-10 p-0 aria-pressed:bg-primary-100 aria-pressed:border-primary-400" aria-label="Desktop preview" aria-pressed={device === "desktop"} onClick={() => onDeviceChange("desktop")}>
          <Monitor size={16} />
        </button>
        <button type="button" className="btn-ghost h-10 w-10 p-0 aria-pressed:bg-primary-100 aria-pressed:border-primary-400" aria-label="Mobile preview" aria-pressed={device === "mobile"} onClick={() => onDeviceChange("mobile")}>
          <Smartphone size={16} />
        </button>
      </div>
      <div className="flex items-center gap-2" role="group" aria-label="Preview zoom">
        <button type="button" className="btn-ghost h-10 w-10 p-0" aria-label="Zoom out" disabled={zoom <= minZoom} onClick={() => onZoomChange(Math.max(minZoom, zoom - 10))}>
          <Minus size={16} />
        </button>
        <output className="w-10 text-center text-xs font-medium tabular-nums text-muted-foreground" aria-label="Preview zoom level">{zoom}%</output>
        <button type="button" className="btn-ghost h-10 w-10 p-0" aria-label="Zoom in" disabled={zoom >= maxZoom} onClick={() => onZoomChange(Math.min(maxZoom, zoom + 10))}>
          <Plus size={16} />
        </button>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
