import { configureStore } from "@reduxjs/toolkit";
import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { erp, billing, crm, getCacheScope, type Product, type Order, type InvoiceDocSummary, type CrmCustomer } from "./api";
import { effectiveDataMode, assertWorkspaceCurrent } from "./dataMode";

export type WorkspaceDataset = {
  products: Product[];
  orders: Order[];
  invoices: InvoiceDocSummary[];
  customers: CrmCustomer[];
};
export const emptyDataset: WorkspaceDataset = { products: [], orders: [], invoices: [], customers: [] };
export const workspaceQueryScope = () => `${effectiveDataMode()}:${getCacheScope() ?? "signed-out"}`;

// One subscription-backed snapshot for the search and notification consumers.
// Query arguments include identity and allowed modules; nothing is persisted.
export const workspaceQueries = createApi({
  reducerPath: "workspaceQueries",
  baseQuery: fakeBaseQuery<{ message: string }>(),
  tagTypes: ["Workspace"],
  keepUnusedDataFor: 0,
  refetchOnFocus: true,
  refetchOnReconnect: true,
  endpoints: build => ({
    dataset: build.query<WorkspaceDataset, { scope: string; modules: string[] }>({
      async queryFn({ scope, modules }) {
        try {
          assertWorkspaceCurrent();
          if (!getCacheScope() || scope !== workspaceQueryScope()) throw new Error("Workspace changed");
          const [products, orders, invoices, customers] = await Promise.all([
            modules.includes("inventory") ? erp.products() : [],
            modules.includes("orders") ? erp.orders() : [],
            modules.includes("invoicing") ? billing.listDocs() : [],
            modules.includes("customers") ? crm.customers() : [],
          ]);
          assertWorkspaceCurrent();
          if (scope !== workspaceQueryScope()) throw new Error("Workspace changed");
          return { data: { products, orders, invoices, customers } };
        } catch {
          return { error: { message: "Workspace records could not be refreshed." } };
        }
      },
      providesTags: ["Workspace"],
    }),
  }),
});

export const createWorkspaceStore = () => configureStore({
  reducer: { [workspaceQueries.reducerPath]: workspaceQueries.reducer },
  middleware: getDefault => getDefault().concat(workspaceQueries.middleware),
  devTools: import.meta.env.DEV,
});
