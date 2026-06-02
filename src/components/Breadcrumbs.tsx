import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

const SEGMENT_LABELS: Record<string, string> = {
  overview: "Overview",
  inventory: "Inventory",
  invoicing: "Invoicing",
  quoting: "Quoting",
  crm: "CRM",
  customers: "Customers",
  suppliers: "Suppliers",
  purchase: "Purchase",
  "purchase-orders": "POs",
  reports: "Reports",
  people: "People",
  accounting: "Accounting",
  tools: "PDF Tools",
  files: "My Files",
  settings: "Settings",
  orders: "Orders",
  "follow-ups": "Follow-ups",
};

function segmentLabel(seg: string): string {
  return SEGMENT_LABELS[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " ");
}

export default function Breadcrumbs() {
  const { pathname } = useLocation();
  const parts = pathname.split("/").filter(Boolean);

  // Don't show on top-level pages (only one segment)
  if (parts.length <= 1) return null;

  // Build cumulative paths
  const crumbs: { label: string; to: string }[] = [];
  let accum = "";
  for (const seg of parts) {
    accum += "/" + seg;
    crumbs.push({ label: segmentLabel(seg), to: accum });
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 px-1 pb-2 text-xs text-brand-400 dark:text-[#9AA0A8]"
    >
      <Link
        to="/overview"
        className="inline-flex items-center gap-1 hover:text-ink dark:hover:text-[#F4F5F6] transition-colors"
        title="Home"
      >
        <Home size={13} />
      </Link>
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={c.to} className="flex items-center gap-1.5">
            <ChevronRight size={11} className="shrink-0 text-brand-300 dark:text-[#555963]" />
            {isLast ? (
              <span className="font-semibold text-brand-600 dark:text-[#DDE0E4] truncate max-w-[200px]">
                {c.label}
              </span>
            ) : (
              <Link
                to={c.to}
                className="hover:text-ink dark:hover:text-[#F4F5F6] transition-colors truncate max-w-[160px]"
              >
                {c.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
