import { Suspense, lazy, useEffect, useState } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { cloudConfigured } from "./lib/supabase";
import { getDataMode } from "./lib/dataMode";
import { AuthProvider, useAuth } from "./lib/auth";
import {
  ENFORCE_LICENSING,
  CLOUD_DEVICE_LIMIT,
  listOrgDevices,
  releaseOrgDevice,
  type OrgDevice,
} from "./lib/license";
import { UIProvider } from "./lib/ui";
import { LanguageProvider } from "./lib/i18n";
import { ModulesProvider, useModules } from "./lib/modules";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Landing from "./pages/Landing";
import NotFound from "./pages/NotFound";
import ProfileSetup from "./pages/ProfileSetup";
import SetupNotice from "./pages/SetupNotice";
import FileyLoader from "./components/FileyLoader";
import CommandPalette from "./components/CommandPalette";
import OverdueReminder from "./components/OverdueReminder";
import Notifier from "./components/Notifier";
import UpdateNotice from "./components/UpdateNotice";
import AgentScheduler from "./components/AgentScheduler";
import { Toaster } from "./components/Toaster";

const CustomerDetail = lazy(() => import("./pages/CustomerDetail"));
const SupplierDetail = lazy(() => import("./pages/SupplierDetail"));
const PortalView = lazy(() => import("./pages/PortalView"));
const ModernOverview = lazy(() => import("./pages/ModernOverview"));

function Splash() {
  return <FileyLoader />;
}

function ModuleDisabled({ name }: { name: string }) {
  return (
    <div className="card max-w-md mx-auto mt-10 text-center">
      <p className="text-lg font-medium text-ink">{name} is disabled</p>
      <p className="text-sm text-brand-500 mt-2">
        Enable this module from <b>Settings → Apps</b> to use it.
      </p>
    </div>
  );
}

function AppRoutes() {
  const { modules, isEnabled } = useModules();
  const location = useLocation();
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
        <Route path="/my-files" element={<Navigate to="/files" replace />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/suppliers/:id" element={<SupplierDetail />} />
        <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

const hasTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Org hit its cloud device limit and this device was refused a slot —
 *  blocking screen with self-serve release (only when licensing enforced). */
function DeviceLimitScreen() {
  const { retryDeviceRegistration, signOut } = useAuth();
  const [devices, setDevices] = useState<OrgDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => {
    listOrgDevices().then(setDevices).catch(() => {});
  };
  useEffect(load, []);
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card max-w-md w-full space-y-4">
        <h1 className="text-lg font-medium text-ink">Device limit reached</h1>
        <p className="text-sm text-brand-500">
          Your workspace already has {CLOUD_DEVICE_LIMIT} devices connected.
          Release one below to use Filey on this device.
        </p>
        <ul className="space-y-1.5">
          {devices.map((d) => (
            <li key={d.id} className="text-sm flex items-center justify-between gap-2">
              <span className="text-ink min-w-0 truncate">{d.device_name || "Device"}</span>
              <button
                className="text-xs text-danger hover:underline cursor-pointer shrink-0"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await releaseOrgDevice(d.id);
                    await retryDeviceRegistration();
                    load();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Release
              </button>
            </li>
          ))}
        </ul>
        <button className="btn-ghost w-full" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function Gate() {
  const { loading, configured, user, needsProfile, profileLoading, deviceLimitBlocked } =
    useAuth();
  const [showLogin, setShowLogin] = useState(false);
  // First run: let the user pick where data lives — local (offline) or cloud.
  // Desktop always asks; the hosted web SaaS (cloud pre-configured) goes
  // straight in so existing users aren't prompted.
  if (!getDataMode() && (hasTauri || !cloudConfigured)) return <SetupNotice />;
  if (loading) return <Splash />;
  if (!configured) return <SetupNotice />;
  if (!user)
    return showLogin ? <Login /> : <Landing onGetStarted={() => setShowLogin(true)} />;
  // Signed in but still fetching the profile — show the splash, not the
  // profile-setup form (which would otherwise flash for existing users).
  if (profileLoading) return <Splash />;
  if (needsProfile) return <ProfileSetup />;
  if (deviceLimitBlocked && ENFORCE_LICENSING) return <DeviceLimitScreen />;

  return (
    <ModulesProvider>
      <HashRouter>
        <Layout>
          <AppRoutes />
        </Layout>
        <CommandPalette />
        <OverdueReminder />
        <Notifier />
        <UpdateNotice />
        <AgentScheduler />
        <Toaster />
      </HashRouter>
    </ModulesProvider>
  );
}

export default function App() {
  // Public customer portal — shared invoice links open here without auth.
  // Still wrap in AuthProvider so any lazy-loaded child can safely call useAuth().
  if (typeof window !== "undefined" && window.location.hash.startsWith("#/portal/")) {
    return (
      <LanguageProvider>
        <UIProvider>
          <AuthProvider>
            <Suspense fallback={<Splash />}>
              <PortalView />
            </Suspense>
          </AuthProvider>
        </UIProvider>
      </LanguageProvider>
    );
  }
  return (
    <LanguageProvider>
      <UIProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </UIProvider>
    </LanguageProvider>
  );
}
