import { Suspense, lazy } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary";
import { ModulesProvider, useModules } from "../lib/modules";
import Layout from "./Layout";
import FileyLoader from "./FileyLoader";
import NotFound from "../pages/NotFound";
import CommandPalette from "./CommandPalette";
import OverdueReminder from "./OverdueReminder";
import Notifier from "./Notifier";
import UpdateNotice from "./UpdateNotice";
import UpgradeDialog from "./UpgradeDialog";
import AgentScheduler from "./AgentScheduler";
import { Toaster } from "./Toaster";
import WorkspaceDataProvider from "./WorkspaceDataProvider";
import { workspaceQueryScope } from "../lib/workspaceQueries";

const CustomerDetail = lazy(() => import("../pages/CustomerDetail"));
const SupplierDetail = lazy(() => import("../pages/SupplierDetail"));
const PayslipPage = lazy(() => import("../pages/PayslipPage"));
const EmployeeDetail = lazy(() => import("../pages/EmployeeDetail"));
const ModernOverview = lazy(() => import("../pages/ModernOverview"));
const KnowledgeCenter = lazy(() => import("../pages/KnowledgeCenter"));
const IntegrationConnect = lazy(() => import("../pages/IntegrationConnect"));
const ExpenseEntry = lazy(() => import("../pages/ExpenseEntry"));

function Splash() {
  return <FileyLoader />;
}

function ModuleDisabled({ name }: { name: string }) {
  return (
    <div className="card max-w-md mx-auto mt-10 text-center">
      <p className="text-lg font-medium text-ink">{name} is unavailable</p>
      <p className="text-sm text-brand-500 mt-2">
        Ask your workspace administrator to review your access and enabled apps.
      </p>
    </div>
  );
}

function AppRoutes() {
  const { modules, isEnabled, loading, error, retry } = useModules();
  const location = useLocation();
  if (loading) return <Splash />;
  if (error) return <div role="alert" className="card mx-auto mt-10 max-w-md space-y-3"><h1 className="text-lg font-semibold">Workspace access could not be loaded</h1><p className="text-sm text-muted-foreground">{error}</p><button className="btn-primary" onClick={retry}>Try again</button></div>;
  return (
    // Per-route boundary: a crash in one page shows a contained error in the
    // content area (sidebar/nav stay alive), and navigating away recovers.
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<Splash />}>
        <Routes>
        <Route path="/" element={<Navigate to="/overview-modern" replace />} />
        {/* Legacy alias — older bookmarks pointing at /overview still work. */}
        <Route path="/overview" element={<ModernOverview />} />
        {modules.map((m) => {
          const Page = m.Component;
          return (
            <Route
              key={m.id}
              path={m.to}
              element={isEnabled(m.id) ? <Page /> : <ModuleDisabled name={m.label} />}
            />
          );
        })}
        <Route path="/help" element={<KnowledgeCenter />} />
        <Route path="/docs" element={<KnowledgeCenter />} />
        <Route path="/my-files" element={<Navigate to="/files" replace />} />
        <Route path="/purchase/new" element={isEnabled("purchase") ? <ExpenseEntry key="new-expense" /> : <ModuleDisabled name="Purchase" />} />
        <Route path="/purchase/:id" element={isEnabled("purchase") ? <ExpenseEntry key={location.pathname} /> : <ModuleDisabled name="Purchase" />} />
        {/* declared after the module routes so /integrations itself still
            resolves to the directory page */}
        <Route path="/integrations/:app" element={isEnabled("integrations") ? <IntegrationConnect /> : <ModuleDisabled name="Integrations" />} />
        <Route path="/customers/:id" element={isEnabled("customers") ? <CustomerDetail /> : <ModuleDisabled name="Customers" />} />
        <Route path="/suppliers/:id" element={isEnabled("suppliers") ? <SupplierDetail /> : <ModuleDisabled name="Suppliers" />} />
        {/* payslip is declared first so it isn't swallowed by /people/:id */}
        <Route path="/people/:id/payslip" element={isEnabled("people") ? <PayslipPage /> : <ModuleDisabled name="People" />} />
        <Route path="/people/:id" element={isEnabled("people") ? <EmployeeDetail /> : <ModuleDisabled name="People" />} />
        <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default function Workspace() {
  return (
    <WorkspaceDataProvider key={workspaceQueryScope()}>
    <ModulesProvider>
      <Layout>
        <AppRoutes />
      </Layout>
      <CommandPalette />
      <OverdueReminder />
      <Notifier />
      <UpdateNotice />
      <AgentScheduler />
      {/* Opens wherever a plan limit is hit, so the way out is on the screen
          the person is already looking at. */}
      <UpgradeDialog />
      <Toaster />
    </ModulesProvider>
    </WorkspaceDataProvider>
  );
}
