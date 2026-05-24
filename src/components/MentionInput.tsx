import { useRef, useState, type KeyboardEvent } from "react";

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
  name.trim().split(/\s+/)[0]?.replace(/[^\w.\-]/g, "") || "user";

/** Text input with @mention autocomplete — a member picker (avatar + name)
 *  appears while typing "@". Picking inserts "@Handle ". */
export default function MentionInput({
  value,
  onChange,
  onEnter,
  members,
  placeholder,
  small,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  members: MentionMember[];
  placeholder?: string;
  small?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const matches = open
    ? members
        .filter((m) =>
          m.name.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 6)
    : [];

  const refresh = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = /@([\w.\-]*)$/.exec(before);
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
    const before = value.slice(0, caret).replace(/@([\w.\-]*)$/, "");
    const after = value.slice(caret);
    const next = `${before}@${handle(member.name)} ${after}`;
    onChange(next);
    setOpen(false);
    setTimeout(() => el?.focus(), 0);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
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
        pick(matches[active]);
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
        placeholder={placeholder}
        value={value}
        maxLength={500}
        onChange={(e) => {
          onChange(e.target.value);
          refresh(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={onKey}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && matches.length > 0 && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-xl border border-brand-200 dark:border-[#3A3D45] bg-white dark:bg-[#24262C] shadow-bento-hover p-1.5">
          {matches.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left cursor-pointer transition-colors ${
                i === active ? "bg-primary-100 dark:bg-primary-400/15" : "hover:bg-brand-50 dark:hover:bg-white/5"
              }`}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${tone(
                  m.id
                )}`}
              >
                {initials(m.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">
                  {m.name}
                </span>
                <span className="block truncate text-[11px] text-brand-400">
                  @{handle(m.name)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
