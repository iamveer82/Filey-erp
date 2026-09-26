import { useDeferredValue, useMemo } from "react";
import { MODULES } from "../modules/registry";
import { todayYmd } from "./format";
import { useModules } from "./modules";
import { getCacheScope } from "./api";
import { workspaceQueries, workspaceQueryScope, emptyDataset, type WorkspaceDataset } from "./workspaceQueries";

function useDataset(enabled = true): WorkspaceDataset {
  const { isEnabled, loading, error } = useModules();
  const modules = ["inventory", "orders", "invoicing", "customers"].filter(isEnabled);
  const { currentData, isError } = workspaceQueries.useDatasetQuery(
    { scope: workspaceQueryScope(), modules },
    { skip: !enabled || loading || !!error || !getCacheScope() },
  );
  return !loading && !error && !isError && enabled ? currentData ?? emptyDataset : emptyDataset;
}

export type SearchHit = {
  group: "Pages" | "Products" | "Orders" | "Invoices" | "Customers";
  label: string;
  sub?: string;
  to: string;
};

/** Global cross-module search: nav pages + live products / orders /
 * invoices / customers, substring-matched. */
export function useGlobalSearch(query: string): SearchHit[] {
  const deferredQuery = useDeferredValue(query);
  const { products, orders, invoices, customers } = useDataset(!!deferredQuery.trim());
  const { isEnabled } = useModules();
  return useMemo(() => {
    const s = deferredQuery.trim().toLowerCase();
    if (!s) return [];
    const has = (...v: (string | undefined)[]) =>
      v.some((x) => x && x.toLowerCase().includes(s));
    const hits: SearchHit[] = [];

    for (const m of MODULES)
      if (isEnabled(m.id) && has(m.label, m.desc))
        hits.push({ group: "Pages", label: m.label, sub: m.desc, to: m.to });
    for (const p of products)
      if (has(p.name, p.sku, p.category))
        hits.push({
          group: "Products",
          label: p.name,
          sub: p.sku,
          to: "/inventory",
        });
    for (const o of orders)
      if (has(o.order_number, o.customer_name))
        hits.push({
          group: "Orders",
          label: o.order_number,
          sub: o.customer_name,
          to: "/orders",
        });
    for (const i of invoices)
      if (has(i.number, i.customer_name))
        hits.push({
          group: "Invoices",
          label: i.number,
          sub: i.customer_name,
          to: "/invoicing",
        });
    for (const c of customers)
      if (has(c.name, c.company, c.email))
        hits.push({
          group: "Customers",
          label: c.name,
          sub: c.company || c.email,
          to: "/crm",
        });

    return hits.slice(0, 24);
  }, [deferredQuery, products, orders, invoices, customers, isEnabled]);
}

export type Notif = {
  id: string;
  title: string;
  detail: string;
  to: string;
  tone: "warn" | "danger" | "info";
};

/** Derives actionable notifications from live data: low/out stock,
 * overdue unpaid invoices, draft orders. */
export function useNotifications(): Notif[] {
  const { products, invoices, orders } = useDataset();
  return useMemo(() => {
    const n: Notif[] = [];
    for (const p of products)
      if (p.quantity <= p.reorder_level)
        n.push({
          id: `low-${p.id}`,
          title: p.quantity === 0 ? `Out of stock: ${p.name}` : `Low stock: ${p.name}`,
          detail: `${p.quantity} on hand · reorder at ${p.reorder_level}`,
          to: "/inventory",
          tone: p.quantity === 0 ? "danger" : "warn",
        });
    const today = todayYmd();
    for (const i of invoices)
      if (i.status !== "paid" && i.due_date && i.due_date < today)
        n.push({
          id: `ovd-${i.id}`,
          title: `Overdue invoice ${i.number}`,
          detail: `${i.customer_name} · due ${i.due_date}`,
          to: "/invoicing",
          tone: "danger",
        });
    for (const o of orders)
      if (o.status === "draft")
        n.push({
          id: `drf-${o.id}`,
          title: `Draft order ${o.order_number}`,
          detail: o.customer_name,
          to: "/orders",
          tone: "info",
        });
    return n.slice(0, 50);
  }, [products, invoices, orders]);
}
