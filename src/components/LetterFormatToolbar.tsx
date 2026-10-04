import { useEffect, useId, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Underline,
} from "lucide-react";
import type { LetterTextStyle } from "../lib/letters";
import { cn } from "../lib/format";
import { SelectMenu } from "./ui-menu";

const PRESETS = [
  { value: "normal", label: "Normal", fontSize: 11, bold: false },
  { value: "heading", label: "Heading", fontSize: 16, bold: true },
  { value: "title", label: "Title", fontSize: 24, bold: true },
  { value: "small", label: "Small", fontSize: 9, bold: false },
];
const FONTS = [
  { value: "modern", label: "Inter" },
  { value: "classic", label: "Lora" },
  { value: "mono", label: "Monospace" },
];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36];
const toggleClass =
  "grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11";
const selectClass =
  "w-full !h-8 !rounded-md !px-2 text-xs [@media(pointer:coarse)]:!h-11";

function numberOptions(common: number[], current: number, unit: string) {
  const values = common.includes(current)
    ? common
    : [...common, current].sort((a, b) => a - b);
  return values.map((value) => ({ value: String(value), label: `${value}${unit}` }));
}

function parseNumber(text: string) {
  const normalized = text.trim().replace(",", ".");
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

/** Keep partial typing local; only valid numbers reach saved document styles. */
function FormatNumberInput({
  id,
  label,
  value,
  min,
  max,
  unit,
  presets,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  presets: number[];
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [message, setMessage] = useState("");
  useEffect(() => {
    setDraft((current) => (parseNumber(current) === value ? current : String(value)));
    setMessage("");
  }, [value]);
  const commit = (text: string) => {
    const number = parseNumber(text);
    if (number === null || number < min || number > max) return false;
    if (number !== value) onChange(number);
    return true;
  };
  const finish = () => {
    if (disabled) return;
    if (commit(draft)) {
      setDraft(String(parseNumber(draft)));
      setMessage("");
    } else {
      setDraft(String(value));
      setMessage(`Use ${min}–${max}${unit}.`);
    }
  };
  return (
    <>
      <div className="flex h-8 min-w-0 items-center rounded-md border border-transparent bg-muted/60 focus-within:border-muted-foreground focus-within:ring-2 focus-within:ring-ring/20 [@media(pointer:coarse)]:h-11">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-label={label}
          aria-describedby={message ? `${id}-hint` : undefined}
          title={`${min}–${max}${unit}`}
          disabled={disabled}
          value={draft}
          className="h-full w-full min-w-0 rounded-l-md bg-transparent px-2 text-xs text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:text-base"
          onFocus={() => setMessage("")}
          onChange={(event) => {
            if (disabled) return;
            setDraft(event.target.value);
            setMessage("");
            commit(event.target.value);
          }}
          onBlur={finish}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setDraft(String(value));
              setMessage("");
            }
          }}
        />
        <span aria-hidden="true" className="shrink-0 text-[11px] text-muted-foreground">
          {unit.trim()}
        </span>
        <SelectMenu
          ariaLabel={`${label} presets`}
          size="sm"
          disabled={disabled}
          value={String(value)}
          options={numberOptions(presets, value, unit)}
          className="!h-8 !w-7 shrink-0 !justify-center !gap-0 !rounded-md !bg-transparent !px-1 [&_[data-slot=select-value]]:hidden [@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!w-11"
          onChange={(next) => {
            if (disabled || !commit(next)) return;
            setDraft(String(parseNumber(next)));
            setMessage("");
          }}
        />
      </div>
      {message && (
        <p
          id={`${id}-hint`}
          role="status"
          className="mt-1 text-[11px] leading-4 text-danger"
        >
          {message}
        </p>
      )}
    </>
  );
}

export interface LetterFormatToolbarProps {
  value: LetterTextStyle;
  onChange: (style: LetterTextStyle) => void;
  disabled?: boolean;
  targetLabel?: string;
}

/** Formatting stays in the editor flow, so it wraps instead of covering text on phones. */
export function LetterFormatToolbar({
  value,
  onChange,
  disabled = false,
  targetLabel = "Letter text",
}: LetterFormatToolbarProps) {
  const id = useId();
  const size = value.fontSize ?? 11;
  const lineSpacing = value.lineSpacing ?? 1.5;
  const paragraphSpacing = value.paragraphSpacing ?? 16;
  const preset =
    PRESETS.find((option) => option.fontSize === size && option.bold === !!value.bold)
      ?.value ?? "custom";
  const set = (patch: Partial<LetterTextStyle>) => {
    if (!disabled) onChange({ ...value, ...patch });
  };
  const labelClass = "mb-1 block text-[11px] leading-4 text-muted-foreground";

  return (
    <div
      role="group"
      aria-label={`${targetLabel} formatting`}
      className="min-w-0 rounded-xl border border-border bg-muted/20 p-3"
    >
      <p className="mb-2 text-xs font-medium text-foreground">{targetLabel}</p>
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <div className="w-28 max-w-full">
          <label className={labelClass} htmlFor={`${id}-style`}>
            Style
          </label>
          <SelectMenu
            id={`${id}-style`}
            ariaLabel="Text style"
            size="sm"
            className={selectClass}
            disabled={disabled}
            value={preset}
            options={[
              ...(preset === "custom" ? [{ value: "custom", label: "Custom" }] : []),
              ...PRESETS.map(({ value, label }) => ({ value, label })),
            ]}
            onChange={(next) => {
              const selected = PRESETS.find((option) => option.value === next);
              if (selected) set({ fontSize: selected.fontSize, bold: selected.bold });
            }}
          />
        </div>
        <div className="w-32 max-w-full">
          <label className={labelClass} htmlFor={`${id}-font`}>
            Font
          </label>
          <SelectMenu
            id={`${id}-font`}
            ariaLabel="Font"
            size="sm"
            className={selectClass}
            disabled={disabled}
            value={value.font ?? "modern"}
            options={FONTS}
            onChange={(next) => {
              if (FONTS.some((option) => option.value === next))
                set({ font: next as LetterTextStyle["font"] });
            }}
          />
        </div>
        <div className="w-28 max-w-full">
          <label className={labelClass} htmlFor={`${id}-size`}>
            Size
          </label>
          <FormatNumberInput
            key={`${targetLabel}-size`}
            id={`${id}-size`}
            label="Font size"
            disabled={disabled}
            value={size}
            min={8}
            max={36}
            unit=" pt"
            presets={SIZES}
            onChange={(fontSize) => set({ fontSize })}
          />
        </div>
        <div>
          <span className={labelClass}>Emphasis</span>
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background/60 p-0.5">
            {(
              [
                { key: "bold", label: "Bold", Icon: Bold },
                { key: "italic", label: "Italic", Icon: Italic },
                { key: "underline", label: "Underline", Icon: Underline },
              ] as const
            ).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={!!value[key]}
                disabled={disabled}
                className={cn(toggleClass, value[key] && "bg-muted text-foreground")}
                onClick={() => set({ [key]: !value[key] })}
              >
                <Icon size={15} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor={`${id}-color`}>
            Color
          </label>
          <input
            id={`${id}-color`}
            type="color"
            aria-label="Text color"
            title="Text color"
            value={value.color ?? "#222222"}
            disabled={disabled}
            className="h-9 w-11 cursor-pointer rounded-md border border-border bg-background p-1 disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-11"
            onChange={(event) => {
              if (/^#[0-9a-f]{6}$/i.test(event.target.value))
                set({ color: event.target.value });
            }}
          />
        </div>
        <div>
          <span className={labelClass}>Alignment</span>
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background/60 p-0.5">
            {(
              [
                { key: "left", label: "Align left", Icon: AlignLeft },
                { key: "center", label: "Align center", Icon: AlignCenter },
                { key: "right", label: "Align right", Icon: AlignRight },
              ] as const
            ).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={(value.align ?? "left") === key}
                disabled={disabled}
                className={cn(
                  toggleClass,
                  (value.align ?? "left") === key && "bg-muted text-foreground"
                )}
                onClick={() => set({ align: key })}
              >
                <Icon size={15} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
        <div className="w-28 max-w-full">
          <label className={labelClass} htmlFor={`${id}-line`}>
            Line spacing
          </label>
          <FormatNumberInput
            key={`${targetLabel}-line`}
            id={`${id}-line`}
            label="Line spacing"
            disabled={disabled}
            value={lineSpacing}
            min={1}
            max={2.5}
            unit="×"
            presets={[1, 1.15, 1.5, 2, 2.5]}
            onChange={(lineSpacing) => set({ lineSpacing })}
          />
        </div>
        <div className="w-32 max-w-full">
          <label className={labelClass} htmlFor={`${id}-paragraph`}>
            Paragraph spacing
          </label>
          <FormatNumberInput
            key={`${targetLabel}-paragraph`}
            id={`${id}-paragraph`}
            label="Paragraph spacing"
            disabled={disabled}
            value={paragraphSpacing}
            min={0}
            max={32}
            unit=" px"
            presets={[0, 8, 12, 16, 24, 32]}
            onChange={(paragraphSpacing) => set({ paragraphSpacing })}
          />
        </div>
      </div>
    </div>
  );
}

export default LetterFormatToolbar;
