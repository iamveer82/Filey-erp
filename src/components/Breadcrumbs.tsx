import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

const SEGMENT_LABELS: Record<string, string> = {
  overview: "Overview",
  "overview-modern": "Overview",
  inventory: "Inventory",
  invoicing: "Invoicing",
  quoting: "Quoting",
  crm: "CRM",
  customers: "Customers",
  suppliers: "Suppliers",
  purchase: "Purchase",
  "purchase-orders": "Purchase Orders",
  reports: "Reports",
  people: "People",
  accounting: "Accounting",
  tools: "PDF Tools",
  files: "My Files",
  settings: "Settings",
  orders: "Orders",
  "follow-ups": "Follow-ups",
  delivery: "Delivery",
  "delivery-challans": "Delivery Challans",
  "payment-receipts": "Payment Receipts",
  declaration: "Declaration Letter",
  cheques: "Cheques",
  "bank-accounts": "Bank Accounts",
  "email-templates": "Email Templates",
  "sms-templates": "SMS Templates",
};

function segmentLabel(seg: string): string {
  return (
    SEGMENT_LABELS[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " ")
  );
}

function useBreadcrumbCrumbs(pathname: string): { label: string; to: string }[] {
  const parts = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; to: string }[] = [];
  let accum = "";
  for (const seg of parts) {
    accum += "/" + seg;
    crumbs.push({ label: segmentLabel(seg), to: accum });
  }
  return crumbs;
}

export interface BreadcrumbsProps {
  /** Optional leaf label override for detail/edit pages. */
  leafLabel?: string;
}

export default function Breadcrumbs({ leafLabel }: BreadcrumbsProps = {}) {
  const { pathname } = useLocation();
  const crumbs = useBreadcrumbCrumbs(pathname);

  // Don't show on top-level pages (only one segment)
  if (crumbs.length <= 1 && !leafLabel) return null;

  const visible = leafLabel ? crumbs.slice(0, -1) : crumbs;

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
      {visible.map((c, i) => {
        const isLast = i === visible.length - 1 && !leafLabel;
        return (
          <span key={c.to} className="flex items-center gap-1.5">
            <ChevronRight
              size={11}
              className="shrink-0 text-brand-300 dark:text-[#555963]"
            />
            {isLast ? (
              <span className="font-medium text-brand-600 dark:text-[#DDE0E4] truncate max-w-[200px]">
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
      {leafLabel && (
        <span className="flex items-center gap-1.5">
          <ChevronRight
            size={11}
            className="shrink-0 text-brand-300 dark:text-[#555963]"
          />
          <span className="font-medium text-brand-600 dark:text-[#DDE0E4] truncate max-w-[200px]">
            {leafLabel}
          </span>
        </span>
      )}
    </nav>
  );
}
