import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { type AppIconName } from "../components/AppIcon";

/** The same import promise serves navigation intent and React.lazy. */
function page(load: () => Promise<{ default: ComponentType }>) {
  let pending: ReturnType<typeof load> | undefined;
  const preload = () => pending ??= load().catch(error => { pending = undefined; throw error; });
  return Object.assign(lazy(preload), { preload });
}

export function prefetchModule(id: string): void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || connection?.effectiveType?.includes("2g")) return;
  void MODULES.find(module => module.id === id)?.Component.preload().catch(() => {});
}

const ModernOverview = page(() => import("../pages/ModernOverview"));
const AgentChat = page(() => import("../pages/AgentChat"));
const WorkspaceBrowser = page(() => import("../pages/WorkspaceBrowser"));
const Inventory = page(() => import("../pages/Inventory"));
const Orders = page(() => import("../pages/Orders"));
const Invoicing = page(() => import("../pages/Invoicing"));
const PurchaseInvoicing = page(async () => {
  const m = await import("../pages/Invoicing");
  return { default: () => <m.default mode="purchase" /> };
});
const Quoting = page(() => import("../pages/Quoting"));
const Crm = page(() => import("../pages/Crm"));
const Customers = page(() => import("../pages/Customers"));
const FollowUpsPage = page(() => import("../pages/FollowUps"));
const Suppliers = page(() => import("../pages/Suppliers"));
const Purchase = page(() => import("../pages/Purchase"));
const PurchaseOrders = page(() => import("../pages/PurchaseOrders"));
const Reports = page(() => import("../pages/reports/Reports"));
const People = page(() => import("../pages/People"));
const Accounting = page(() => import("../pages/Accounting"));
const ToolsPage = page(() => import("../pages/PdfTools"));
const MyFilesPage = page(() => import("../pages/MyFiles"));
const Settings = page(() => import("../pages/Tools"));
const Integrations = page(() => import("../pages/Integrations"));
const Marketing = page(() => import("../pages/Marketing"));
const DeliveryChallan = page(() => import("../pages/DeliveryChallan"));
const PaymentReceipt = page(() => import("../pages/PaymentReceipt"));
const DeclarationLetter = page(() => import("../pages/DeclarationLetter"));
const ChequeRegister = page(() => import("../pages/ChequeRegister"));
const BankAccounts = page(() => import("../pages/BankAccounts"));
const EmailTemplates = page(() => import("../pages/EmailTemplates"));
const Work = page(() => import("../pages/Work"));
const Team = page(() => import("../pages/Team"));
const Comms = page(() => import("../pages/Comms"));

export interface AppModule {
  id: string;
  label: string;
  short: string;
  desc: string;
  icon: AppIconName;
  to: string;
  Component: LazyExoticComponent<ComponentType> & { preload: () => Promise<{ default: ComponentType }> };
  /** Core modules are always on and cannot be disabled. */
  core?: boolean;
}

export const MODULES: AppModule[] = [
  {
    id: "projects",
    label: "Projects",
    short: "Projects",
    desc: "Customer delivery, tasks and time tracking",
    icon: "projects",
    to: "/projects",
    Component: Work,
  },
  {
    id: "helpdesk",
    label: "Helpdesk",
    short: "Support",
    desc: "Customer tickets, resolution targets and history",
    icon: "helpdesk",
    to: "/helpdesk",
    Component: Work,
  },
  {
    id: "overview",
    label: "Overview",
    short: "Overview",
    desc: "Inventory KPIs & operational snapshot",
    icon: "overview",
    to: "/overview-modern",
    Component: ModernOverview,
    core: true,
  },
  {
    id: "agent",
    label: "Filey AI",
    short: "AI",
    desc: "Your autonomous business agent — chat, automate and act across the app",
    icon: "agent",
    to: "/agent",
    Component: AgentChat,
    core: true,
  },
  {
    id: "browser",
    label: "Browser",
    short: "Browser",
    desc: "Business websites and social apps beside Filey AI",
    icon: "browser",
    to: "/browser",
    Component: WorkspaceBrowser,
  },
  {
    id: "inventory",
    label: "Inventory",
    short: "Inventory",
    desc: "Products, stock levels & reorder alerts",
    icon: "inventory",
    to: "/inventory",
    Component: Inventory,
  },
  {
    id: "orders",
    label: "Orders",
    short: "Orders",
    desc: "Sales orders & fulfilment status",
    icon: "orders",
    to: "/orders",
    Component: Orders,
  },
  {
    id: "invoicing",
    label: "Invoicing",
    short: "Invoicing",
    desc: "FTA tax invoices with live preview",
    icon: "invoicing",
    to: "/invoicing",
    Component: Invoicing,
  },
  {
    id: "quoting",
    label: "Quoting",
    short: "Quoting",
    desc: "Create quotations & convert leads",
    icon: "quotations",
    to: "/quoting",
    Component: Quoting,
  },
  {
    id: "team",
    label: "Team",
    short: "Team",
    desc: "Channels, mentions and threads",
    icon: "team",
    to: "/team",
    Component: Team,
  },
  {
    id: "comms",
    label: "Comms log",
    short: "Comms",
    desc: "Email sent and calls logged",
    icon: "comms",
    to: "/comms",
    Component: Comms,
  },
  {
    id: "crm",
    label: "CRM",
    short: "CRM",
    desc: "Companies, contacts, leads, deals, tasks & reporting",
    icon: "crm",
    to: "/crm",
    Component: Crm,
  },
  {
    id: "customers",
    label: "Customers",
    short: "Customers",
    desc: "Customer directory — names, TRN & addresses for invoicing",
    icon: "customers",
    to: "/customers",
    Component: Customers,
  },
  {
    id: "follow-ups",
    label: "Follow-ups",
    short: "Follow-ups",
    desc: "Reminders & to-dos, surfaced when they're due",
    icon: "followups",
    to: "/follow-ups",
    Component: FollowUpsPage,
  },
  {
    id: "suppliers",
    label: "Suppliers",
    short: "Suppliers",
    desc: "Supply groups & sourcing performance",
    icon: "suppliers",
    to: "/suppliers",
    Component: Suppliers,
  },
  {
    id: "purchase",
    label: "Purchase",
    short: "Purchase",
    desc: "Purchase spend & expense tracking",
    icon: "purchase",
    to: "/purchase",
    Component: Purchase,
  },
  {
    id: "purchase-orders",
    label: "Purchase Orders",
    short: "POs",
    desc: "Order from suppliers & receive stock",
    icon: "po",
    to: "/purchase-orders",
    Component: PurchaseOrders,
  },
  {
    id: "purchase-invoices",
    label: "Purchase Invoices",
    short: "Bills",
    desc: "Record supplier bills — receives stock & posts to Inventory & Payables",
    icon: "purchaseInvoice",
    to: "/purchase-invoices",
    Component: PurchaseInvoicing,
  },
  {
    id: "reports",
    label: "Reports",
    short: "Reports",
    desc: "Inventory & financial reporting",
    icon: "reports",
    to: "/reports",
    Component: Reports,
  },
  {
    id: "people",
    label: "People",
    short: "People",
    desc: "Employees, attendance & payroll",
    icon: "people",
    to: "/people",
    Component: People,
  },
  {
    id: "accounting",
    label: "Accounting",
    short: "Accounting",
    desc: "Chart of accounts & journal entries",
    icon: "accounting",
    to: "/accounting",
    Component: Accounting,
  },
  {
    id: "tools",
    label: "Tools",
    short: "Tools",
    desc: "Local PDF toolkit",
    icon: "tools",
    to: "/tools",
    Component: ToolsPage,
  },
  {
    id: "files",
    label: "My Files",
    short: "Files",
    desc: "Tool outputs saved to your account",
    icon: "files",
    to: "/files",
    Component: MyFilesPage,
  },
  {
    id: "settings",
    label: "Settings",
    short: "Settings",
    desc: "Company, account, users & system",
    icon: "settings",
    to: "/settings",
    Component: Settings,
    core: true,
  },
  {
    id: "marketing",
    label: "Marketing",
    short: "Marketing",
    desc: "Rank leads from your trading history and fill in their details",
    icon: "marketing",
    to: "/marketing",
    Component: Marketing,
  },
  {
    id: "integrations",
    label: "Integrations",
    short: "Integrations",
    desc: "Connect Filey with the tools you already use",
    icon: "integrations",
    to: "/integrations",
    Component: Integrations,
  },
  {
    id: "delivery-challans",
    label: "Delivery",
    short: "Delivery",
    desc: "Track delivery orders, goods received notes & returns",
    icon: "delivery",
    to: "/delivery-challans",
    Component: DeliveryChallan,
  },
  {
    id: "payment-receipts",
    label: "Payment Receipts",
    short: "Receipts",
    desc: "Issue payment receipts to customers & suppliers",
    icon: "payment",
    to: "/payment-receipts",
    Component: PaymentReceipt,
  },
  {
    id: "declaration",
    label: "Declaration Letter",
    short: "Declaration",
    desc: "VAT supply declaration letters in the standard UAE format",
    icon: "declaration",
    to: "/declaration",
    Component: DeclarationLetter,
  },
  {
    id: "cheques",
    label: "Cheques",
    short: "Cheques",
    desc: "Track issued & received cheques with status",
    icon: "cheque",
    to: "/cheques",
    Component: ChequeRegister,
  },
  {
    id: "bank-accounts",
    label: "Bank Accounts",
    short: "Bank",
    desc: "Manage company bank accounts & balances",
    icon: "bank",
    to: "/bank-accounts",
    Component: BankAccounts,
  },
  {
    id: "email-templates",
    label: "Email Templates",
    short: "Emails",
    desc: "Reusable email templates with placeholders",
    icon: "email",
    to: "/email-templates",
    Component: EmailTemplates,
  },
  /* {
    id: "sms-templates",
    label: "SMS Templates",
    short: "SMS",
    desc: "Reusable SMS templates with placeholders + 6-digit OTP",
    icon: "email",
    to: "/sms-templates",
    Component: SmsTemplates,
  }, */
];
