import { ChartNoAxesCombined, FilePenLine, FilePlus2, ListChecks, Paperclip } from "lucide-react";

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
  return <div className="filey-chat-starters" role="group" aria-label="Conversation starters">
    {starters.map(({ label, icon: Icon, prompt }) => <button key={label} type="button" onClick={() => onDraft(prompt)}>
      <Icon size={16} aria-hidden="true" /><span>{label}</span>
    </button>)}
    <button type="button" onClick={onAttach}><Paperclip size={16} aria-hidden="true" /><span>Work with a file</span></button>
  </div>;
}
