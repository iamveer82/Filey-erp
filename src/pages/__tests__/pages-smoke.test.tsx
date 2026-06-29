// Render-smoke: every listed page must mount without throwing.
//
// This is the cheapest UI safety net — it catches the class of bug that has
// actually bitten this app (conditional hooks, bad imports, null-deref on first
// render) without a browser or Playwright. The data layer is mocked to return
// empty results, so each page renders its empty state.
//
// Heavy/route-param pages (Reports/charts, PdfTools, Tools, MyFiles, AgentChat,
// *Detail/:id) are intentionally not here yet — they need canvas/worker shims or
// route params. Add them as the harness grows.

import { describe, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { UIProvider } from "../../lib/ui";

// ── Mock the data boundary: a chainable, awaitable stub that always yields
// {data:[], error:null}. Covers pages that call sb() directly and via lib/api. ──
vi.mock("../../lib/supabase", () => {
  const result = { data: [], error: null, count: 0 };
  const makeQuery = (): unknown => {
    const proxy: unknown = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => void) => res(result);
        return () => proxy; // every builder method is chainable
      },
      apply: () => proxy,
    });
    return proxy;
  };
  const sb = () => ({
    from: makeQuery,
    rpc: makeQuery,
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
  });
  return { sb, supabase: null, isConfigured: true, cloudConfigured: false };
});

// Force local mode so anything reading the data mode behaves deterministically.
vi.mock("../../lib/dataMode", () => ({
  isLocalMode: () => true,
  getDataMode: () => "local",
  setDataMode: () => {},
}));

// Tauri isn't present in jsdom — make invoke a no-op resolve.
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));

function wrap(node: ReactElement) {
  return render(
    <MemoryRouter>
      <UIProvider>{node}</UIProvider>
    </MemoryRouter>
  );
}

// Curated low-risk list/index pages. Static imports so vi.mock hoists correctly.
import Customers from "../Customers";
import Suppliers from "../Suppliers";
import Inventory from "../Inventory";
import Orders from "../Orders";
import Invoicing from "../Invoicing";
import Quoting from "../Quoting";
import Purchase from "../Purchase";
import PurchaseOrders from "../PurchaseOrders";
import FollowUps from "../FollowUps";
import BankAccounts from "../BankAccounts";
import ChequeRegister from "../ChequeRegister";
import Crm from "../Crm";

const pages: [string, () => ReactElement][] = [
  ["Customers", () => <Customers />],
  ["Suppliers", () => <Suppliers />],
  ["Inventory", () => <Inventory />],
  ["Orders", () => <Orders />],
  ["Invoicing", () => <Invoicing />],
  ["Quoting", () => <Quoting />],
  ["Purchase", () => <Purchase />],
  ["PurchaseOrders", () => <PurchaseOrders />],
  ["FollowUps", () => <FollowUps />],
  ["BankAccounts", () => <BankAccounts />],
  ["ChequeRegister", () => <ChequeRegister />],
  ["Crm", () => <Crm />],
];

describe("page render smoke", () => {
  for (const [name, make] of pages) {
    it(`${name} mounts without throwing`, () => {
      const { unmount } = wrap(make());
      unmount();
    });
  }
});
