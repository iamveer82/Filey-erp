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
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { ReactElement } from "react";
import { UIProvider } from "../../lib/ui";
import { AuthProvider } from "../../lib/auth";

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
      <AuthProvider>
        <UIProvider>{node}</UIProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

// Static imports so vi.mock hoists correctly.
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
import ModernOverview from "../ModernOverview";
import People from "../People";
import Accounting from "../Accounting";
import Reports from "../reports/Reports";
import EmailTemplates from "../EmailTemplates";
import Integrations from "../Integrations";
import Marketing from "../Marketing";
import DeliveryChallan from "../DeliveryChallan";
import PaymentReceipt from "../PaymentReceipt";
import DeclarationLetter from "../DeclarationLetter";
import MyFiles from "../MyFiles";
import Tools from "../Tools";
import PdfTools from "../PdfTools";
import AgentChat from "../AgentChat";
import CustomerDetail from "../CustomerDetail";
import EmployeeDetail from "../EmployeeDetail";
import PayslipPage from "../PayslipPage";
import SupplierDetail from "../SupplierDetail";
import PortalView from "../PortalView";
import Login from "../Login";
import NotFound from "../NotFound";

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
  ["ModernOverview", () => <ModernOverview />],
  ["People", () => <People />],
  ["Accounting", () => <Accounting />],
  ["Reports", () => <Reports />],
  ["EmailTemplates", () => <EmailTemplates />],
  ["Integrations", () => <Integrations />],
  ["Marketing", () => <Marketing />],
  ["DeliveryChallan", () => <DeliveryChallan />],
  ["PaymentReceipt", () => <PaymentReceipt />],
  ["DeclarationLetter", () => <DeclarationLetter />],
  ["MyFiles", () => <MyFiles />],
  ["Tools", () => <Tools />],
  ["PdfTools", () => <PdfTools />],
  ["AgentChat", () => <AgentChat />],
  // Purchase Invoices = the same page in purchase mode; its branches
  // (supplier labels, doc_type) must mount too.
  ["Invoicing (purchase)", () => <Invoicing mode="purchase" />],
  ["PortalView", () => <PortalView />],
  ["Login", () => <Login />],
  ["NotFound", () => <NotFound />],
];

describe("page render smoke", () => {
  for (const [name, make] of pages) {
    it(`${name} mounts without throwing`, () => {
      const { unmount } = wrap(make());
      unmount();
    });
  }
});

// Detail pages need a route param; render them at a concrete URL.
function wrapAt(path: string, route: string, node: ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <UIProvider>
          <Routes>
            <Route path={route} element={node} />
          </Routes>
        </UIProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("detail page render smoke", () => {
  it("CustomerDetail mounts without throwing", () => {
    wrapAt("/customers/1", "/customers/:id", <CustomerDetail />).unmount();
  });
  it("SupplierDetail mounts without throwing", () => {
    wrapAt("/suppliers/1", "/suppliers/:id", <SupplierDetail />).unmount();
  });
  it("EmployeeDetail mounts without throwing", () => {
    wrapAt("/people/1", "/people/:id", <EmployeeDetail />).unmount();
  });
  it("PayslipPage mounts without throwing", () => {
    wrapAt("/people/1/payslip", "/people/:id/payslip", <PayslipPage />).unmount();
  });
});
