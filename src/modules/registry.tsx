// Filey module registry — an Odoo-style "mini app" system.
// Every screen is a self-contained module with a manifest. Non-core
// modules can be enabled/disabled per user from Settings → Apps.
// Pages are lazy-loaded so the initial bundle stays small; heavy
// screens (PDF tools, charts) only download when first visited.
import {
  LayoutGrid,
  Boxes,
  ClipboardList,
  FileText,
  FileSignature,
  Target,
  Users,
  ShoppingCart,
  BarChart3,
  Contact,
  Landmark,
  Wrench,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const Overview = lazy(() => import("../pages/Overview"));
const Inventory = lazy(() => import("../pages/Inventory"));
const Orders = lazy(() => import("../pages/Orders"));
const Invoicing = lazy(() => import("../pages/Invoicing"));
const Quoting = lazy(() => import("../pages/Quoting"));
const Crm = lazy(() => import("../pages/Crm"));
const Suppliers = lazy(() => import("../pages/Suppliers"));
const Purchase = lazy(() => import("../pages/Purchase"));
const Reports = lazy(() => import("../pages/Reports"));
const People = lazy(() => import("../pages/People"));
const Accounting = lazy(() => import("../pages/Accounting"));
const ToolsPage = lazy(() => import("../pages/PdfTools"));
const Settings = lazy(() => import("../pages/Tools"));

export interface AppModule {
  id: string;
  label: string;
  short: string;
  desc: string;
  icon: LucideIcon;
  to: string;
  Component: LazyExoticComponent<ComponentType>;
  /** Core modules are always on and cannot be disabled. */
  core?: boolean;
}

export const MODULES: AppModule[] = [
  {
    id: "overview",
    label: "Overview",
    short: "Overview",
    desc: "Inventory KPIs & operational snapshot",
    icon: LayoutGrid,
    to: "/overview",
    Component: Overview,
    core: true,
  },
  {
    id: "inventory",
    label: "Inventory",
    short: "Inventory",
    desc: "Products, stock levels & reorder alerts",
    icon: Boxes,
    to: "/inventory",
    Component: Inventory,
  },
  {
    id: "orders",
    label: "Orders",
    short: "Orders",
    desc: "Sales orders & fulfilment status",
    icon: ClipboardList,
    to: "/orders",
    Component: Orders,
  },
  {
    id: "invoicing",
    label: "Invoicing",
    short: "Invoicing",
    desc: "FTA tax invoices with live preview",
    icon: FileText,
    to: "/invoicing",
    Component: Invoicing,
  },
  {
    id: "quoting",
    label: "Quoting",
    short: "Quoting",
    desc: "Create quotations & convert leads",
    icon: FileSignature,
    to: "/quoting",
    Component: Quoting,
  },
  {
    id: "crm",
    label: "CRM",
    short: "CRM",
    desc: "Customer dashboard & pipeline",
    icon: Target,
    to: "/crm",
    Component: Crm,
  },
  {
    id: "suppliers",
    label: "Suppliers",
    short: "Suppliers",
    desc: "Supply groups & sourcing performance",
    icon: Users,
    to: "/suppliers",
    Component: Suppliers,
  },
  {
    id: "purchase",
    label: "Purchase",
    short: "Purchase",
    desc: "Purchase spend & expense tracking",
    icon: ShoppingCart,
    to: "/purchase",
    Component: Purchase,
  },
  {
    id: "reports",
    label: "Reports",
    short: "Reports",
    desc: "Inventory & financial reporting",
    icon: BarChart3,
    to: "/reports",
    Component: Reports,
  },
  {
    id: "people",
    label: "People",
    short: "People",
    desc: "Employees, attendance & payroll",
    icon: Contact,
    to: "/people",
    Component: People,
  },
  {
    id: "accounting",
    label: "Accounting",
    short: "Accounting",
    desc: "Chart of accounts & journal entries",
    icon: Landmark,
    to: "/accounting",
    Component: Accounting,
  },
  {
    id: "tools",
    label: "Tools",
    short: "Tools",
    desc: "Local PDF toolkit",
    icon: Wrench,
    to: "/tools",
    Component: ToolsPage,
  },
  {
    id: "settings",
    label: "Settings",
    short: "Settings",
    desc: "Company, account, users & system",
    icon: Settings2,
    to: "/settings",
    Component: Settings,
    core: true,
  },
];
