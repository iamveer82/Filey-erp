import { useEffect, useState } from "react";
import { Bookmark, ChartNoAxesCombined, FilePenLine, FilePlus2, ListChecks, Paperclip } from "lucide-react";
import { DEMO_CATEGORIES, DEMOS, listCardTemplates, type CardTemplate, type DemoCategory } from "../lib/genUi";
import { cn } from "../lib/format";

const starters = [
  { label: "Create an invoice", icon: FilePlus2, prompt: "Create a new draft invoice. Ask me for the customer and items you need." },
  { label: "Draft a letter", icon: FilePenLine, prompt: "Draft a company letter using my saved company details. Ask me for its purpose and wording, leave missing optional details editable, and save it as a draft." },
  { label: "Review payments", icon: ListChecks, prompt: "Show me unpaid and overdue invoices, with amounts grouped by currency." },
  { label: "Business overview", icon: ChartNoAxesCombined, prompt: "Summarize my business using current workspace data, with totals grouped by currency." },
] as const;

/** Suggestions prepare an editable draft; they never start an AI request. */
export default function AgentChatStarters({ onDraft, onAttach }: {
  onDraft: (text: string) => void;
  onAttach: () => void;
}) {
  return <>
    <div className="filey-chat-starters" role="group" aria-label="Conversation starters">
      {starters.map(({ label, icon: Icon, prompt }) => <button key={label} type="button" onClick={() => onDraft(prompt)}>
        <Icon size={16} aria-hidden="true" /><span>{label}</span>
      </button>)}
      <button type="button" onClick={onAttach}><Paperclip size={16} aria-hidden="true" /><span>Work with a file</span></button>
    </div>
    <InteractiveGallery onDraft={onDraft} />
  </>;
}

/** OpenIntelligentUI's demo gallery: answers you can use, by what you want to do. */
function InteractiveGallery({ onDraft }: { onDraft: (text: string) => void }) {
  const [category, setCategory] = useState<DemoCategory>("Understand");
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  useEffect(() => {
    let alive = true;
    listCardTemplates().then(list => { if (alive) setTemplates(list.filter(t => !t.builtIn)); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <section aria-label="Interactive answers" className="mx-auto mt-7 w-[min(100%,560px)] text-left">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium text-muted-foreground">Try an interactive answer</h3>
        <div role="tablist" aria-label="Kind of answer" className="flex gap-1 rounded-lg bg-muted p-0.5">
          {DEMO_CATEGORIES.map(c => (
            <button key={c} type="button" role="tab" aria-selected={category === c} onClick={() => setCategory(c)}
              className={cn("rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors", category === c ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        {DEMOS.filter(d => d.category === category).map(d => (
          <button key={d.title} type="button" onClick={() => onDraft(d.prompt)}
            className="rounded-xl border border-border px-3.5 py-3 text-left transition-colors hover:bg-muted">
            <div className="text-[13px] font-medium text-foreground">{d.title}</div>
            <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{d.description}</div>
          </button>
        ))}
      </div>
      {!!templates.length && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Your card templates">
          <span className="text-[12px] text-muted-foreground">Your cards:</span>
          {templates.map(t => (
            <button key={t.name} type="button" onClick={() => onDraft(`Use my "${t.name}" card template with: `)}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-muted">
              <Bookmark size={12} aria-hidden="true" />{t.name}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
