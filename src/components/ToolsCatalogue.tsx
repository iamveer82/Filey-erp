import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, FolderOpen, Search, ShieldCheck, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { FilterChip, PageHeader, SearchInput } from "./ui";
import { PDF_TOOLS, toolById, type Tool } from "./PdfToolbox";
import ToolCover from "./ToolCover";
import { getCacheScope } from "../lib/api";
import { useUI } from "../lib/ui";

const POPULAR = ["merge", "split", "compress", "esign", "img2pdf", "pdf2img", "watermark", "csv2json"];
const CATEGORIES: Record<string, { title: string; description: string }> = {
  Organize: { title: "Organize & manage", description: "Combine documents, reorder pages and keep the parts you need." },
  Edit: { title: "Edit & annotate", description: "Add a signature, fill a form or give your document the finishing touches." },
  "To PDF": { title: "Convert to PDF", description: "Bring images, documents and spreadsheets into one familiar format." },
  "From PDF": { title: "Convert from PDF", description: "Take text, images and data out of your documents." },
  Optimize: { title: "Optimize & repair", description: "Reduce file sizes and prepare documents for sharing and printing." },
  Secure: { title: "Protect & clean", description: "Manage passwords, redact sensitive content and remove hidden information." },
  Data: { title: "Images & data", description: "Resize images, trace vectors and convert structured data." },
};

export default function ToolsCatalogue({ category, query, onFilter, onOpen }: {
  category: string; query: string;
  onFilter: (category: string, query: string) => void;
  onOpen: (tool: Tool) => void;
}) {
  const { toast } = useUI();
  // Preferences contain tool IDs only and follow the account across storage modes.
  const scope = getCacheScope();
  const key = scope ? `filey:tool-favourites:${encodeURIComponent(scope)}` : "filey:tool-favourites:guest";
  const read = () => {
    try {
      const value: unknown = JSON.parse(key ? localStorage.getItem(key) || "[]" : "[]");
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && !!toolById(id)) : [];
    } catch { return []; }
  };
  const [favourites, setFavourites] = useState<string[]>(read);
  useEffect(() => {
    const refresh = (event: StorageEvent) => { if (event.key === key) setFavourites(read()); };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
    // The parent remounts this catalogue when its account scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const toggleFavourite = (id: string) => {
    const next = favourites.includes(id) ? favourites.filter(value => value !== id) : [...favourites, id];
    setFavourites(next);
    try { if (key) localStorage.setItem(key, JSON.stringify(next)); }
    catch { toast.info("Favourite kept for this visit. Device storage is unavailable."); }
  };
  const categories = [...new Set(PDF_TOOLS.map(tool => tool.cat))];
  const selected = ["All tools", "Popular", "Favourites", ...categories].includes(category) ? category : "All tools";
  const needle = query.trim().toLowerCase();
  const popular = POPULAR.map(toolById).filter((tool): tool is Tool => !!tool);
  const tools = selected === "Popular" ? (popular.length ? popular : PDF_TOOLS.slice(0, 8)) : PDF_TOOLS;
  const filtered = tools.filter(tool =>
    (selected === "All tools" || selected === "Popular" || (selected === "Favourites" ? favourites.includes(tool.id) : tool.cat === selected)) &&
    (!needle || `${tool.name} ${tool.desc} ${tool.cat} ${CATEGORIES[tool.cat]?.title || ""}`.toLowerCase().includes(needle))
  );
  const grouped = selected === "All tools" && !needle;
  const groups = grouped ? categories.map(cat => ({ key: cat, tools: filtered.filter(tool => tool.cat === cat) })) : [{ key: selected, tools: filtered }];

  return <div className="tools-page">
    <PageHeader title="Tools" subtitle="Everything you need to work with your files."
      action={<Link to="/files" className="btn-ghost"><FolderOpen size={16} /> My Files</Link>} />
    <section className="tools-intro" aria-label="Local file tools">
      <div>
        <h2>Your files. Ready for what’s next.</h2>
        <p>Convert, edit, organize and protect. Pick a tool to get started.</p>
        <div className="tools-assurances"><span><ShieldCheck size={15} /> On-device processing</span><span><CheckCircle2 size={15} /> Free · No API key</span></div>
      </div>
      <div className="tools-intro-art" aria-hidden="true">
        {["img2pdf", "merge", "esign"].map(id => <img key={id} src={`/tool-covers/tools/${id}.webp`} alt="" width="160" height="112" />)}
      </div>
    </section>
    <div className="tools-toolbar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput value={query} onChange={value => onFilter(value.trim() && selected === "Popular" ? "All tools" : selected, value)} placeholder="Search tools by name or what they do…" className="w-full max-w-lg" />
        <span className="text-xs text-muted-foreground" role="status">{filtered.length} of {PDF_TOOLS.length} tools</span>
      </div>
      <nav className="tools-categories" aria-label="Tool categories">
        {["All tools", "Popular", "Favourites", ...categories].map(cat => <FilterChip key={cat} active={selected === cat} onClick={() => onFilter(cat, query)}>
          {cat === "Favourites" && <Star size={13} />}{CATEGORIES[cat]?.title || cat}{cat === "Favourites" && ` · ${favourites.length}`}
        </FilterChip>)}
      </nav>
    </div>
    {filtered.length ? groups.map(group => <section key={group.key} className="tools-group" aria-label={CATEGORIES[group.key]?.title || group.key}>
      <div className="tools-group-heading"><div>
        <h2>{needle ? "Search results" : CATEGORIES[group.key]?.title || (group.key === "Popular" ? "Everyday essentials" : "Your favourites")}</h2>
        <p>{needle ? `Tools matching “${query.trim()}”` : CATEGORIES[group.key]?.description || (group.key === "Popular" ? "A shortcut to the tools you’ll reach for most." : "Your saved shortcuts, always close by.")}</p>
      </div><span className="tools-count">{group.tools.length}</span></div>
      <div className="tools-grid">
        {group.tools.map(tool => <article key={tool.id} className="tool-card">
          <button type="button" className="tool-card-open" aria-label={`Open ${tool.name}`} onClick={() => onOpen(tool)}>
            <ToolCover tool={tool} />
            <div className="tool-card-copy"><h3>{tool.name}</h3><p>{tool.desc}</p><span className="tool-card-action">Open tool <ArrowRight size={14} /></span></div>
          </button>
          <button type="button" className="tool-favourite" aria-label={`${favourites.includes(tool.id) ? "Remove" : "Add"} ${tool.name} ${favourites.includes(tool.id) ? "from" : "to"} favourites`} aria-pressed={favourites.includes(tool.id)} onClick={() => toggleFavourite(tool.id)}>
            <Star size={16} fill={favourites.includes(tool.id) ? "currentColor" : "none"} />
          </button>
        </article>)}
      </div>
    </section>) : <div className="tools-empty">
      {selected === "Favourites" && !needle ? <Star size={28} /> : <Search size={28} />}
      <h2>{selected === "Favourites" && !needle ? "Keep your go-to tools here" : "No matching tools"}</h2>
      <p>{selected === "Favourites" && !needle ? "Select the star on any tool to save a shortcut." : "Try a file type like PDF, or an action like merge."}</p>
      <button className="btn-ghost" onClick={() => onFilter("All tools", "")}>{selected === "Favourites" && !needle ? "Browse tools" : "Clear filters"}</button>
    </div>}
    <footer className="tools-footer"><span><ShieldCheck size={15} /> Files stay on this device unless you choose Save to My Files.</span><span>Original files are never overwritten.</span></footer>
  </div>;
}
