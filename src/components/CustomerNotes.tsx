import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Plus, X, StickyNote, GripHorizontal } from "lucide-react";
import { cn } from "../lib/format";

interface Note {
  id: string;
  text: string;
  x: number;
  y: number;
  color: NoteColor;
}

type NoteColor = "amber" | "sky" | "emerald" | "rose" | "violet";

const COLORS: NoteColor[] = ["amber", "sky", "emerald", "rose", "violet"];

const colorClass: Record<NoteColor, string> = {
  amber:
    "bg-amber-100 border-amber-200 dark:bg-amber-400/15 dark:border-amber-400/30",
  sky: "bg-sky-100 border-sky-200 dark:bg-sky-400/15 dark:border-sky-400/30",
  emerald:
    "bg-emerald-100 border-emerald-200 dark:bg-emerald-400/15 dark:border-emerald-400/30",
  rose: "bg-rose-100 border-rose-200 dark:bg-rose-400/15 dark:border-rose-400/30",
  violet:
    "bg-violet-100 border-violet-200 dark:bg-violet-400/15 dark:border-violet-400/30",
};

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

/** A small drag-and-drop sticky-note board for a customer. Notes are
 *  stored locally (per customer) so they persist across reloads without
 *  a backend table. Add, edit and delete; drag to reposition. */
export default function CustomerNotes({ customerId }: { customerId: string }) {
  const key = `notes:customer:${customerId}`;
  const [notes, setNotes] = useState<Note[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      setNotes(raw ? (JSON.parse(raw) as Note[]) : []);
    } catch {
      setNotes([]);
    }
  }, [key]);

  const persist = (next: Note[]) => {
    setNotes(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* storage full / unavailable — keep in-memory */
    }
  };

  const addNote = () => {
    const i = notes.length;
    persist([
      ...notes,
      {
        id: newId(),
        text: "",
        x: 16 + (i % 4) * 28,
        y: 16 + (i % 4) * 24,
        color: COLORS[i % COLORS.length],
      },
    ]);
  };

  const updateText = (id: string, text: string) =>
    persist(notes.map((n) => (n.id === id ? { ...n, text } : n)));

  const moveNote = (id: string, x: number, y: number) =>
    persist(
      notes.map((n) =>
        n.id === id
          ? { ...n, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) }
          : n
      )
    );

  const removeNote = (id: string) =>
    persist(notes.filter((n) => n.id !== id));

  return (
    <section className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-ink">Notes</h2>
        <button onClick={addNote} className="btn-ghost h-8 text-xs">
          <Plus size={14} /> Add note
        </button>
      </div>
      <div
        ref={canvasRef}
        className="relative card overflow-hidden p-0 min-h-[280px] bg-brand-50/40 dark:bg-white/[0.02]"
      >
        {notes.length === 0 && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-100 text-brand-400">
                <StickyNote size={20} />
              </span>
              <p className="text-sm font-semibold text-brand-500">
                No notes yet
              </p>
              <p className="text-xs text-brand-400">
                Add a note and drag it anywhere on the board.
              </p>
            </div>
          </div>
        )}

        {notes.map((n) => (
          <motion.div
            key={n.id}
            drag
            dragMomentum={false}
            dragConstraints={canvasRef}
            dragElastic={0}
            style={{ x: n.x, y: n.y }}
            whileDrag={{ scale: 1.03, zIndex: 30 }}
            onDragEnd={(_, info) =>
              moveNote(n.id, n.x + info.offset.x, n.y + info.offset.y)
            }
            className={cn(
              "absolute w-48 rounded-xl border shadow-bento",
              colorClass[n.color]
            )}
          >
            {/* drag handle */}
            <div className="flex items-center justify-between px-2 py-1 cursor-grab active:cursor-grabbing text-ink/40 dark:text-white/45">
              <GripHorizontal size={14} />
              <button
                onClick={() => removeNote(n.id)}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="Delete note"
                className="rounded p-0.5 text-ink/40 dark:text-white/45 hover:text-danger hover:bg-black/5 cursor-pointer"
              >
                <X size={13} />
              </button>
            </div>
            <textarea
              value={n.text}
              onChange={(e) => updateText(n.id, e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              placeholder="Write a note…"
              rows={4}
              className="w-full bg-transparent resize-none px-3 pb-3 text-sm text-ink placeholder:text-ink/40 dark:placeholder:text-white/40 outline-none"
            />
          </motion.div>
        ))}
      </div>
    </section>
  );
}
