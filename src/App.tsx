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
import PasswordRecovery from "./components/PasswordRecovery";
import TwoFactorGate from "./components/TwoFactorGate";
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
import { maybePromptDesktopShortcut } from "./lib/shortcut";

const CustomerDetail = lazy(() => import("./pages/CustomerDetail"));
const SupplierDetail = lazy(() => import("./pages/SupplierDetail"));
const PayslipPage = lazy(() => import("./pages/PayslipPage"));
const EmployeeDetail = lazy(() => import("./pages/EmployeeDetail"));
const PortalView = lazy(() => import("./pages/PortalView"));
const ModernOverview = lazy(() => import("./pages/ModernOverview"));
const KnowledgeCenter = lazy(() => import("./pages/KnowledgeCenter"));
const IntegrationConnect = lazy(() => import("./pages/IntegrationConnect"));

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
        <Route path="/help" element={<KnowledgeCenter />} />
        <Route path="/docs" element={<KnowledgeCenter />} />
        <Route path="/my-files" element={<Navigate to="/files" replace />} />
        {/* declared after the module routes so /integrations itself still
            resolves to the directory page */}
        <Route path="/integrations/:app" element={<IntegrationConnect />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/suppliers/:id" element={<SupplierDetail />} />
        {/* payslip is declared first so it isn't swallowed by /people/:id */}
        <Route path="/people/:id/payslip" element={<PayslipPage />} />
        <Route path="/people/:id" element={<EmployeeDetail />} />
        <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

const hasTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function recoveryLink(): { token: string; email: string } | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash;
  if (raw.split("?")[0] !== "#/reset-password") return null;
  const params = new URLSearchParams(raw.split("?")[1] || "");
  const token = params.get("token_hash")?.trim() || "";
  const email = params.get("email")?.trim().toLowerCase() || "";
  return { token, email };
}

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

function ProfileLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="min-h-screen grid place-items-center p-6 bg-canvas">
      <div className="card max-w-sm w-full text-center space-y-3">
        <h1 className="text-lg font-semibold text-ink">Couldn't load your profile</h1>
        <p className="text-sm text-brand-500">
          You're signed in, but we couldn't read your account details. This is
          usually a connection problem — your data is untouched.
        </p>
        <p className="text-xs text-brand-400 break-words">{message}</p>
        <button
          className="btn-primary"
          onClick={onRetry}
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function Gate() {
  const {
    loading,
    configured,
    user,
    needsProfile,
    profileLoading,
    profileError,
    reloadProfile,
    mfaPending,
    deviceLimitBlocked,
  } = useAuth();
  // Desktop app, first sign-in on this device: offer to place a Desktop
  // shortcut (once per device; the helper self-guards and never throws).
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => void maybePromptDesktopShortcut(), 2000);
    return () => clearTimeout(t);
  }, [user]);
  // First run: let the user pick where data lives — local (offline) or cloud.
  // Desktop always asks; the hosted web SaaS (cloud pre-configured) goes
  // straight in so existing users aren't prompted.
  if (!getDataMode() && (hasTauri || !cloudConfigured)) return <SetupNotice />;
  if (loading) return <Splash />;
  if (!configured) return <SetupNotice />;
  // Marketing lives on the separate website. Every ERP runtime returns to
  // authentication after sign-out, including browser previews and local mode.
  if (!user) return <Login />;
  // A correct password yields a real session that still sits at aal1 when the
  // account has an authenticator app. Nothing else may render until the code
  // is accepted — this is the whole enforcement point for 2FA.
  if (mfaPending) return <TwoFactorGate />;
  // Signed in but still fetching the profile — show the splash, not the
  // profile-setup form (which would otherwise flash for existing users).
  if (profileLoading) return <Splash />;
  // A failed profile READ must never fall through to ProfileSetup — completing
  // that form upserts over the real name and company.
  if (profileError)
    return <ProfileLoadError message={profileError} onRetry={() => void reloadProfile()} />;
  if (needsProfile) return <ProfileSetup />;
  if (deviceLimitBlocked && ENFORCE_LICENSING) return <DeviceLimitScreen />;

  return (
    <ModulesProvider>
      <Layout>
        <AppRoutes />
      </Layout>
      <CommandPalette />
      <OverdueReminder />
      <Notifier />
      <UpdateNotice />
      <AgentScheduler />
      <Toaster />
    </ModulesProvider>
  );
}

export default function App() {
  const [resetLink, setResetLink] = useState(recoveryLink);
  useEffect(() => {
    // Retain the one-time token only in memory, outside the app's persisted auth.
    const captureLink = () => {
      const next = recoveryLink();
      if (!next) return;
      setResetLink(next);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#/reset-password`);
    };
    if (resetLink) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#/reset-password`);
    window.addEventListener("hashchange", captureLink);
    return () => window.removeEventListener("hashchange", captureLink);
  }, [resetLink]);
  if (resetLink) {
    const valid = !!resetLink.token && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetLink.email);
    return (
      <LanguageProvider>
        <UIProvider>
          <PasswordRecovery
            initialEmail={resetLink.email}
            recoveryToken={valid ? resetLink.token : ""}
            initialError={valid ? "" : "This reset link is incomplete or no longer available. Request a new link to continue."}
            offline={typeof navigator !== "undefined" && !navigator.onLine}
            onBack={() => {
              window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#/`);
              setResetLink(null);
            }}
          />
        </UIProvider>
      </LanguageProvider>
    );
  }
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
          {/* Router wraps the WHOLE gate, not just the signed-in app. Gate
              returns SetupNotice / Login / ProfileSetup before it
              ever reaches the routed shell, and those screens are real pages
              that may use router hooks — ProfileSetup calls useNavigate() at
              the top level, so a brand-new account (needsProfile) crashed on
              mount with "useNavigate() may be used only in the context of a
              <Router>" before the form could even be shown. */}
          <HashRouter>
            <Gate />
          </HashRouter>
        </AuthProvider>
      </UIProvider>
    </LanguageProvider>
  );
}
