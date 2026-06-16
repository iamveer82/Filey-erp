import type { CSSProperties, ReactNode } from "react";
import overviewIcon from "../assets/icons/overview.svg";
import invoiceIcon from "../assets/icons/invoice.svg";
import poIcon from "../assets/icons/po.svg";
import inventoryIcon from "../assets/icons/inventory.svg";
import ordersIcon from "../assets/icons/orders.svg";
import customersIcon from "../assets/icons/customers.svg";
import suppliersIcon from "../assets/icons/suppliers.svg";
import quotationsIcon from "../assets/icons/quotations.svg";
import purchaseIcon from "../assets/icons/purchase.svg";
import accountingIcon from "../assets/icons/accounting.svg";
import deliveryIcon from "../assets/icons/delivery.svg";
import paymentIcon from "../assets/icons/payment.svg";
import declarationIcon from "../assets/icons/declaration.svg";
import chequeIcon from "../assets/icons/cheque.svg";
import bankIcon from "../assets/icons/bank.svg";
import emailIcon from "../assets/icons/email.svg";
import followupsIcon from "../assets/icons/followups.svg";
import toolsIcon from "../assets/icons/tools.svg";
import filesIcon from "../assets/icons/files.svg";
import peopleIcon from "../assets/icons/people.svg";
import moneyIcon from "../assets/icons/money.svg";
import reportsIcon from "../assets/icons/reports.svg";
import settingsIcon from "../assets/icons/settings.svg";
import inventoryInIcon from "../assets/icons/inventory-in.svg";
import inventoryOutIcon from "../assets/icons/inventory-out.svg";
import lowStockIcon from "../assets/icons/low-stock.svg";
import activityIcon from "../assets/icons/activity.svg";
import successIcon from "../assets/icons/success.svg";
import warningIcon from "../assets/icons/warning.svg";
import dangerIcon from "../assets/icons/danger.svg";
import emptyIcon from "../assets/icons/empty.svg";
import outstandingIcon from "../assets/icons/low-stock.svg";

const iconMap: Record<string, string> = {
  overview: overviewIcon,
  dashboard: overviewIcon,
  invoice: invoiceIcon,
  invoicing: invoiceIcon,
  bill: invoiceIcon,
  billing: invoiceIcon,
  po: poIcon,
  purchase: poIcon,
  lpo: poIcon,
  inventory: inventoryIcon,
  stock: inventoryIcon,
  product: inventoryIcon,
  products: inventoryIcon,
  orders: ordersIcon,
  order: ordersIcon,
  sales: ordersIcon,
  customers: customersIcon,
  crm: customersIcon,
  people: peopleIcon,
  suppliers: suppliersIcon,
  vendor: suppliersIcon,
  vendors: suppliersIcon,
  quotations: quotationsIcon,
  quote: quotationsIcon,
  quoting: quotationsIcon,
  estimate: quotationsIcon,
  estimates: quotationsIcon,
  purchaseOrder: purchaseIcon,
  purchaseOrders: purchaseIcon,
  accounting: accountingIcon,
  accounts: accountingIcon,
  delivery: deliveryIcon,
  deliveries: deliveryIcon,
  payment: paymentIcon,
  payments: paymentIcon,
  declaration: declarationIcon,
  declarations: declarationIcon,
  cheque: chequeIcon,
  cheques: chequeIcon,
  bank: bankIcon,
  banks: bankIcon,
  email: emailIcon,
  emails: emailIcon,
  followups: followupsIcon,
  followup: followupsIcon,
  tools: toolsIcon,
  tool: toolsIcon,
  files: filesIcon,
  file: filesIcon,
  documents: filesIcon,
  money: moneyIcon,
  revenue: moneyIcon,
  outstanding: outstandingIcon,
  reports: reportsIcon,
  report: reportsIcon,
  analytics: reportsIcon,
  settings: settingsIcon,
  config: settingsIcon,
  inventoryIn: inventoryInIcon,
  stockIn: inventoryInIcon,
  inventoryOut: inventoryOutIcon,
  stockOut: inventoryOutIcon,
  lowStock: lowStockIcon,
  stockAlert: lowStockIcon,
  activity: activityIcon,
  recent: activityIcon,
  success: successIcon,
  done: successIcon,
  warning: warningIcon,
  warn: warningIcon,
  danger: dangerIcon,
  error: dangerIcon,
  empty: emptyIcon,
  emptyState: emptyIcon,
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
  return (
    <img
      src={iconMap[name]}
      alt={alt || name}
      className={className}
      style={style}
    />
  );
}

export function getAppIconSrc(name: AppIconName): string {
  return iconMap[name];
}

export function getAppIconNode(
  name: AppIconName,
  className = "",
  alt?: string
): ReactNode {
  return <AppIcon name={name} className={className} alt={alt || name} />;
}
