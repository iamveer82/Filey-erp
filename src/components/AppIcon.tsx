import type { CSSProperties, ReactNode } from "react";
import invoiceIcon from "../assets/icons/invoice.svg";
import poIcon from "../assets/icons/po.svg";
import inventoryIcon from "../assets/icons/inventory.svg";
import ordersIcon from "../assets/icons/orders.svg";
import customersIcon from "../assets/icons/customers.svg";
import suppliersIcon from "../assets/icons/suppliers.svg";
import quotationsIcon from "../assets/icons/quotations.svg";
import expensesIcon from "../assets/icons/expenses.svg";
import reportsIcon from "../assets/icons/reports.svg";
import settingsIcon from "../assets/icons/settings.svg";
import inventoryInIcon from "../assets/icons/inventory-in.svg";
import inventoryOutIcon from "../assets/icons/inventory-out.svg";

const iconMap: Record<string, string> = {
  invoice: invoiceIcon,
  invoicing: invoiceIcon,
  po: poIcon,
  purchase: poIcon,
  inventory: inventoryIcon,
  orders: ordersIcon,
  order: ordersIcon,
  customers: customersIcon,
  crm: customersIcon,
  suppliers: suppliersIcon,
  quotations: quotationsIcon,
  quote: quotationsIcon,
  expenses: expensesIcon,
  reports: reportsIcon,
  settings: settingsIcon,
  inventoryIn: inventoryInIcon,
  inventoryOut: inventoryOutIcon,
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
