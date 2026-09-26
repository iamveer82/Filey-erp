import { useId, useRef, useState, type KeyboardEvent } from "react";

import { MenuPopover } from "./ui-menu";

export interface MentionMember {
  id: string;
  name: string;
}

const AVATAR_TONES = [
  "bg-primary-100 text-primary-700",
  "bg-secondary-400/20 text-secondary-600",
  "bg-info/15 text-info",
  "bg-success/15 text-success",
];
const tone = (id: string) => {
  let h = 0;
  for (const c of id) h = (h + c.charCodeAt(0)) % AVATAR_TONES.length;
  return AVATAR_TONES[h];
};
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
const handle = (name: string) =>
  name
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^\p{L}\p{N}_.-]/gu, "") || "user";

/** Text input with @mention autocomplete — a member picker (avatar + name)
 * appears while typing "@". Picking inserts "@Handle ". */
export default function MentionInput({
  value,
  onChange,
  onEnter,
  members,
  placeholder,
  label = "Message",
  small,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  members: MentionMember[];
  placeholder?: string;
  label?: string;
  small?: boolean;
}) {
  const listId = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const matches = open
    ? members
        .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 6)
    : [];

  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));
  const expanded = open && matches.length > 0;

  const refresh = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = /@([\p{L}\p{N}_.-]*)$/u.exec(before);
    if (m) {
      setQuery(m[1]);
      setActive(0);
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  const pick = (member: MentionMember) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([\p{L}\p{N}_.-]*)$/u, "");
    const after = value.slice(caret);
    const next = `${before}@${handle(member.name)} ${after}`;
    onChange(next);
    setOpen(false);
    setTimeout(() => { el?.focus(); const position = before.length + handle(member.name).length + 2; el?.setSelectionRange(position, position); }, 0);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); return; }
    if (open && matches.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onEnter?.();
    }
  };

  return (
    <div className="relative flex-1">
      <input
        ref={ref}
        className={small ? "input !py-1.5 text-sm" : "input"}
        aria-label={label}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded ? `${listId}-${matches[activeIndex].id}` : undefined}
        placeholder={placeholder}
        value={value}
        maxLength={500}
        onChange={(e) => {
          onChange(e.target.value);
          refresh(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={onKey}
        onBlur={() => setOpen(false)}
      />
      {open && matches.length > 0 && (
        <MenuPopover open={expanded} onClose={() => setOpen(false)} anchorRef={ref} side="top" role="presentation" className="w-64 max-w-[calc(100vw-1rem)]">
        <div id={listId} role="listbox" aria-label="Mention a team member" className="text-foreground">
          {matches.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="option"
              id={`${listId}-${m.id}`}
              aria-selected={i === activeIndex}
              tabIndex={-1}
              onClick={() => pick(m)}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start cursor-pointer transition-colors ${
                i === activeIndex
                  ? "bg-muted"
                  : "hover:bg-muted"
              }`}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-medium ${tone(
                  m.id
                )}`}
              >
                {initials(m.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">
                  {m.name}
                </span>
                <span className="block truncate text-[11px] text-brand-400">
                  @{handle(m.name)}
                </span>
              </span>
            </button>
          ))}
        </div>
        </MenuPopover>
      )}
    </div>
  );
}
