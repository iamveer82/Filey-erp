// Filey module registry — an Odoo-style "mini app" system.
// Every screen is a self-contained module with a manifest. Non-core
// modules can be enabled/disabled per user from Settings → Apps.
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
  Wrench,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import type { ReactElement } from "react";

import Overview from "../pages/Overview";
import Inventory from "../pages/Inventory";
import Orders from "../pages/Orders";
import Invoicing from "../pages/Invoicing";
import Quoting from "../pages/Quoting";
import Crm from "../pages/Crm";
import Suppliers from "../pages/Suppliers";
import Purchase from "../pages/Purchase";
import Reports from "../pages/Reports";
import ToolsPage from "../pages/PdfTools";
import Settings from "../pages/Tools";

export interface AppModule {
  id: string;
  label: string;
  short: string;
  desc: string;
  icon: LucideIcon;
  to: string;
  element: ReactElement;
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
    element: <Overview />,
    core: true,
  },
  {
    id: "inventory",
    label: "Inventory",
    short: "Inventory",
    desc: "Products, stock levels & reorder alerts",
    icon: Boxes,
    to: "/inventory",
    element: <Inventory />,
  },
  {
    id: "orders",
    label: "Orders",
    short: "Orders",
    desc: "Sales orders & fulfilment status",
    icon: ClipboardList,
    to: "/orders",
    element: <Orders />,
  },
  {
    id: "invoicing",
    label: "Invoicing",
    short: "Invoicing",
    desc: "FTA tax invoices with live preview",
    icon: FileText,
    to: "/invoicing",
    element: <Invoicing />,
  },
  {
    id: "quoting",
    label: "Quoting",
    short: "Quoting",
    desc: "Create quotations & convert leads",
    icon: FileSignature,
    to: "/quoting",
    element: <Quoting />,
  },
  {
    id: "crm",
    label: "CRM",
    short: "CRM",
    desc: "Customer dashboard & pipeline",
    icon: Target,
    to: "/crm",
    element: <Crm />,
  },
  {
    id: "suppliers",
    label: "Suppliers",
    short: "Suppliers",
    desc: "Supply groups & sourcing performance",
    icon: Users,
    to: "/suppliers",
    element: <Suppliers />,
  },
  {
    id: "purchase",
    label: "Purchase",
    short: "Purchase",
    desc: "Purchase spend & expense tracking",
    icon: ShoppingCart,
    to: "/purchase",
    element: <Purchase />,
  },
  {
    id: "reports",
    label: "Reports",
    short: "Reports",
    desc: "Inventory & financial reporting",
    icon: BarChart3,
    to: "/reports",
    element: <Reports />,
  },
  {
    id: "tools",
    label: "Tools",
    short: "Tools",
    desc: "Local PDF toolkit",
    icon: Wrench,
    to: "/tools",
    element: <ToolsPage />,
  },
  {
    id: "settings",
    label: "Settings",
    short: "Settings",
    desc: "Company, account, users & system",
    icon: Settings2,
    to: "/settings",
    element: <Settings />,
    core: true,
  },
];
