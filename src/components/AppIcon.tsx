import type { CSSProperties, ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Banknote,
  BookCheck,
  Building2,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileSignature,
  FileText,
  FolderOpen,
  Inbox,
  Landmark,
  LayoutGrid,
  LineChart,
  Mail,
  MessageSquare,
  Package,
  PackageMinus,
  PackageOpen,
  PackagePlus,
  Receipt,
  ScrollText,
  Send,
  Settings,
  ShoppingCart,
  Target,
  UserCircle2,
  UserPlus,
  Users,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";

/* Lucide icon registry (Emergent reference mapping) — replaces the old
 * hand-drawn SVG mask set. Same string keys, so the module registry and
 * every AppIcon call site keep working unchanged. */
const iconMap: Record<string, LucideIcon> = {
  overview: LayoutGrid,
  dashboard: LayoutGrid,
  invoice: FileText,
  invoicing: FileText,
  bill: FileText,
  billing: FileText,
  po: ClipboardList,
  purchase: Package,
  lpo: ClipboardList,
  inventory: PackageOpen,
  stock: PackageOpen,
  product: PackageOpen,
  products: PackageOpen,
  orders: ShoppingCart,
  order: ShoppingCart,
  sales: ShoppingCart,
  customers: Users,
  crm: UserPlus,
  people: UserCircle2,
  suppliers: Building2,
  vendor: Building2,
  vendors: Building2,
  quotations: FileSignature,
  quote: FileSignature,
  quoting: FileSignature,
  estimate: FileSignature,
  estimates: FileSignature,
  purchaseOrder: ClipboardList,
  purchaseOrders: ClipboardList,
  accounting: Calculator,
  accounts: Calculator,
  delivery: Send,
  deliveries: Send,
  payment: Receipt,
  payments: Receipt,
  declaration: ScrollText,
  declarations: ScrollText,
  cheque: BookCheck,
  cheques: BookCheck,
  bank: Landmark,
  banks: Landmark,
  email: Mail,
  emails: Mail,
  followups: Target,
  followup: Target,
  tools: Wrench,
  tool: Wrench,
  files: FolderOpen,
  file: FolderOpen,
  documents: FolderOpen,
  money: CircleDollarSign,
  revenue: Banknote,
  outstanding: AlertTriangle,
  agent: MessageSquare,
  assistant: MessageSquare,
  ai: MessageSquare,
  reports: LineChart,
  report: LineChart,
  analytics: LineChart,
  settings: Settings,
  config: Settings,
  inventoryIn: PackagePlus,
  stockIn: PackagePlus,
  inventoryOut: PackageMinus,
  stockOut: PackageMinus,
  lowStock: AlertTriangle,
  stockAlert: AlertTriangle,
  activity: Activity,
  recent: Activity,
  success: CheckCircle2,
  done: CheckCircle2,
  warning: AlertTriangle,
  warn: AlertTriangle,
  danger: XCircle,
  error: XCircle,
  empty: Inbox,
  emptyState: Inbox,
};

export type AppIconName = keyof typeof iconMap;

export default function AppIcon({
  name,
  className = "",
  style,
  alt,
}: {
  name: AppIconName;
  className?: string;
  style?: CSSProperties;
  alt?: string;
}) {
  const Icon = iconMap[name] ?? LayoutGrid;
  return (
    <Icon
      role="img"
      aria-label={alt || name}
      className={className}
      style={style}
      strokeWidth={1.75}
    />
  );
}

export function getAppIconNode(
  name: AppIconName,
  className = "",
  alt?: string
): ReactNode {
  return <AppIcon name={name} className={className} alt={alt || name} />;
}
