import {
  Activity,
  Building2,
  CheckSquare,
  Kanban,
  StickyNote,
  Pin,
  Target,
  Users,
} from "lucide-react";
import { cn } from "../../lib/format";
import { recordName, text, type CrmObject, type CrmRow } from "../../lib/crmWorkspace";

const CRM_ICONS = {
  companies: Building2,
  contacts: Users,
  leads: Target,
  deals: Kanban,
  tasks: CheckSquare,
  notes: StickyNote,
  activities: Activity,
};

export function RecordAvatar({
  kind,
  name,
  large = false,
}: {
  kind: CrmObject;
  name: string;
  large?: boolean;
}) {
  const Icon = CRM_ICONS[kind];
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join("")
    .toLocaleUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center border border-border bg-muted/60 font-medium text-muted-foreground",
        large ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs",
        kind === "contacts" || kind === "leads" ? "rounded-full" : "rounded-[8px]"
      )}
    >
      {["contacts", "leads"].includes(kind) ? (
        initials || <Icon size={16} />
      ) : (
        <Icon size={large ? 20 : 15} />
      )}
    </span>
  );
}

function recordSubtitle(kind: CrmObject, row: CrmRow): string {
  if (kind === "companies")
    return [row.city, row.country_code].map(text).filter(Boolean).join(", ");
  if (kind === "contacts") return text(row.title);
  if (kind === "leads") return text(row.company);
  return "";
}

export default function RecordIdentity({ kind, row }: { kind: CrmObject; row: CrmRow }) {
  const name = recordName(kind, row),
    subtitle = recordSubtitle(kind, row);
  return (
    <span className="flex min-w-0 items-center gap-3">
      <RecordAvatar kind={kind} name={name} />
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {Boolean(row.pinned) && <Pin size={14} className="mr-1 inline" role="img" aria-label="Pinned" />}
          {name}
        </span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
}
