import {
  LayoutGrid,
  Boxes,
  ClipboardList,
  FileText,
  Users,
  ShoppingCart,
  BarChart3,
  Settings2,
  type LucideIcon,
} from "lucide-react";

export interface AppDef {
  to: string;
  label: string;
  short: string;
  desc: string;
  icon: LucideIcon;
  /** tailwind class fragments for the icon chip */
  tile: string;
  dot: string;
}

export const APPS: AppDef[] = [
  {
    to: "/overview",
    label: "Overview",
    short: "Overview",
    desc: "Inventory KPIs & operational snapshot",
    icon: LayoutGrid,
    tile: "bg-primary-400",
    dot: "bg-primary-400",
  },
  {
    to: "/inventory",
    label: "Inventory",
    short: "Inventory",
    desc: "Products, stock levels & reorder alerts",
    icon: Boxes,
    tile: "bg-secondary-400",
    dot: "bg-secondary-400",
  },
  {
    to: "/orders",
    label: "Orders",
    short: "Orders",
    desc: "Sales orders & fulfilment status",
    icon: ClipboardList,
    tile: "bg-info",
    dot: "bg-info",
  },
  {
    to: "/quoting",
    label: "Quoting",
    short: "Quoting",
    desc: "Build, theme & download VAT invoices",
    icon: FileText,
    tile: "bg-accentpurple",
    dot: "bg-accentpurple",
  },
  {
    to: "/suppliers",
    label: "Suppliers",
    short: "Suppliers",
    desc: "Supply groups & sourcing performance",
    icon: Users,
    tile: "bg-success",
    dot: "bg-success",
  },
  {
    to: "/purchase",
    label: "Purchase",
    short: "Purchase",
    desc: "Purchase spend & expense tracking",
    icon: ShoppingCart,
    tile: "bg-primary-600",
    dot: "bg-primary-600",
  },
  {
    to: "/reports",
    label: "Reports",
    short: "Reports",
    desc: "Inventory & financial reporting",
    icon: BarChart3,
    tile: "bg-brand-700",
    dot: "bg-brand-700",
  },
  {
    to: "/settings",
    label: "Settings",
    short: "Settings",
    desc: "Users, company settings & audit log",
    icon: Settings2,
    tile: "bg-brand-500",
    dot: "bg-brand-500",
  },
];
