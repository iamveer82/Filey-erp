import { Link } from "react-router-dom";
import {
  FileSignature,
  ClipboardList,
  Receipt,
  Wallet,
  Calculator,
  Truck,
  BookCheck,
  Landmark,
  Megaphone,
  Wrench,
  FolderOpen,
  Mail,
  ScrollText,
  UserCircle2,
  Target,
  ChevronRight,
} from "lucide-react";
import { Screen, Card } from "@mobile/components/ui";

/* The other 20 modules. The five highest-frequency ones are tabs; these live
 * here honestly labelled — the ones the phone can do today, and the ones that
 * remain desktop-first (wide editors, PDF workspaces). */

const MODULES: { to?: string; label: string; desc: string; icon: React.ReactNode; ready?: boolean }[] = [
  { to: "/agent", label: "Filey AI", desc: "Works fully on mobile", icon: <Sparkle />, ready: true },
  { label: "Quoting", desc: "Desktop for now", icon: <FileSignature size={17} /> },
  { label: "Purchase Orders", desc: "Desktop for now", icon: <ClipboardList size={17} /> },
  { label: "Payment Receipts", desc: "Desktop for now", icon: <Receipt size={17} /> },
  { label: "Expenses", desc: "Desktop for now", icon: <Wallet size={17} /> },
  { label: "Accounting", desc: "Desktop for now", icon: <Calculator size={17} /> },
  { label: "Delivery", desc: "Desktop for now", icon: <Truck size={17} /> },
  { label: "Cheques", desc: "Desktop for now", icon: <BookCheck size={17} /> },
  { label: "Bank Accounts", desc: "Desktop for now", icon: <Landmark size={17} /> },
  { label: "People & Payroll", desc: "Desktop for now", icon: <UserCircle2 size={17} /> },
  { label: "Marketing", desc: "Desktop for now", icon: <Megaphone size={17} /> },
  { label: "Reports", desc: "Desktop for now", icon: <Target size={17} /> },
  { label: "Declaration Letters", desc: "Desktop for now", icon: <ScrollText size={17} /> },
  { label: "My Files", desc: "Desktop for now", icon: <FolderOpen size={17} /> },
  { label: "PDF Tools", desc: "Desktop for now", icon: <Wrench size={17} /> },
  { label: "Email Templates", desc: "Desktop for now", icon: <Mail size={17} /> },
];

export default function More() {
  return (
    <Screen title="All modules" subtitle="Everything Filey does">
      <div className="space-y-2">
        {MODULES.map((m) => {
          const inner = (
            <Card
              className={cn(
                "flex items-center gap-3",
                m.ready && "!border-primary-500/40"
              )}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                {m.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-foreground">{m.label}</p>
                <p className="text-[11.5px] text-muted-foreground">{m.desc}</p>
              </div>
              <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
            </Card>
          );
          return m.to ? (
            <Link key={m.label} to={m.to}>
              {inner}
            </Link>
          ) : (
            <div key={m.label}>{inner}</div>
          );
        })}
      </div>
    </Screen>
  );
}

function Sparkle() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.9 5.7a2 2 0 0 0 1.3 1.3L21 11l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 20l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 11l5.8-2a2 2 0 0 0 1.3-1.3L12 2z" />
    </svg>
  );
}

function cn(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
