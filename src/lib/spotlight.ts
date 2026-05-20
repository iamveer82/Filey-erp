import { useEffect, useMemo, useState } from "react";
import {
  erp,
  billing,
  crm,
  type Product,
  type Order,
  type InvoiceDocSummary,
  type CrmCustomer,
} from "./api";
import { MODULES } from "../modules/registry";

type Dataset = {
  products: Product[];
  orders: Order[];
  invoices: InvoiceDocSummary[];
  customers: CrmCustomer[];
};

const EMPTY: Dataset = {
  products: [],
  orders: [],
  invoices: [],
  customers: [],
};

/** Loads the searchable/alertable datasets once. The api layer already
 *  caches these, so this stays cheap and shares across hooks. */
function useDataset(): Dataset {
  const [data, setData] = useState<Dataset>(EMPTY);
  useEffect(() => {
    let alive = true;
    Promise.all([
      erp.products().catch(() => [] as Product[]),
      erp.orders().catch(() => [] as Order[]),
      billing.listDocs().catch(() => [] as InvoiceDocSummary[]),
      crm.customers().catch(() => [] as CrmCustomer[]),
    ]).then(([products, orders, invoices, customers]) => {
      if (alive) setData({ products, orders, invoices, customers });
    });
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

export type SearchHit = {
  group: "Pages" | "Products" | "Orders" | "Invoices" | "Customers";
  label: string;
  sub?: string;
  to: string;
};

/** Global cross-module search: nav pages + live products / orders /
 *  invoices / customers, substring-matched. */
export function useGlobalSearch(query: string): SearchHit[] {
  const { products, orders, invoices, customers } = useDataset();
  return useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return [];
    const has = (...v: (string | undefined)[]) =>
      v.some((x) => x && x.toLowerCase().includes(s));
    const hits: SearchHit[] = [];

    for (const m of MODULES)
      if (has(m.label, m.desc))
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
  }, [query, products, orders, invoices, customers]);
}

export type Notif = {
  id: string;
  title: string;
  detail: string;
  to: string;
  tone: "warn" | "danger" | "info";
};

/** Derives actionable notifications from live data: low/out stock,
 *  overdue unpaid invoices, draft orders. */
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
    const today = new Date().toISOString().slice(0, 10);
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
