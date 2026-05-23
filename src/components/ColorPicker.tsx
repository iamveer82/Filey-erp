import { useEffect, useRef, useState } from "react";
import { hexToHsva, hsvaToHex, type HsvaColor } from "@uiw/color-convert";
import Hue from "@uiw/react-color-hue";
import Saturation from "@uiw/react-color-saturation";
import { cn } from "../lib/format";

const DEFAULT_SWATCHES = [
  "#FFD600",
  "#F8371A",
  "#F97C1B",
  "#3FD0B6",
  "#2CADF6",
  "#6462FC",
  "#0A0A0A",
  "#6E6E6E",
];

function safeHsva(hex: string): HsvaColor {
  try {
    return hexToHsva(hex);
  } catch {
    return { h: 0, s: 0, v: 0, a: 1 };
  }
}

/** Compact colour picker — swatch trigger + popover with saturation/hue,
 *  a hex field and quick swatches. Closes on outside-click / Escape. */
export default function ColorPicker({
  value,
  onChange,
  swatches = DEFAULT_SWATCHES,
  className,
}: {
  value: string;
  onChange: (hex: string) => void;
  swatches?: string[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hsva = safeHsva(value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Pick a colour"
        className="flex h-9 items-center gap-2 rounded-lg border border-brand-200 bg-white px-2 text-ink shadow-sm shadow-black/5 transition-colors hover:border-brand-300 cursor-pointer dark:bg-[#1A1B1E] dark:border-[#33353A] dark:text-[#F0F0F0]"
      >
        <span
          className="h-5 w-5 rounded-md border border-black/10"
          style={{ background: value }}
        />
        <span className="font-mono text-xs uppercase">{value}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-40 w-[248px] rounded-2xl border border-brand-200 bg-white p-3 shadow-bento-hover dark:bg-[#222327] dark:border-[#33353A]">
          <Saturation
            hsva={hsva}
            onChange={(c) => onChange(hsvaToHex(c))}
            style={{
              width: "100%",
              height: "auto",
              aspectRatio: "4 / 2",
              borderRadius: "0.6rem",
            }}
          />
          <div className="mt-3 overflow-hidden rounded-full">
            <Hue
              hue={hsva.h}
              onChange={(c) => onChange(hsvaToHex({ ...hsva, ...c }))}
              style={{ height: 14 }}
            />
          </div>
          <input
            className="input mt-3 font-mono text-xs uppercase"
            value={hsvaToHex(hsva)}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {swatches.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange(s)}
                aria-label={`Set colour ${s}`}
                className="h-6 w-6 rounded-md border border-black/10 transition-transform hover:scale-110 cursor-pointer"
                style={{ background: s }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
