import { Suspense, lazy, useState } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { UIProvider } from "./lib/ui";
import { LanguageProvider } from "./lib/i18n";
import { ModulesProvider, useModules } from "./lib/modules";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Landing from "./pages/Landing";
import ProfileSetup from "./pages/ProfileSetup";
import SetupNotice from "./pages/SetupNotice";
import FileyLoader from "./components/FileyLoader";
import Copilot from "./components/Copilot";
import CommandPalette from "./components/CommandPalette";
import OverdueReminder from "./components/OverdueReminder";

const CustomerDetail = lazy(() => import("./pages/CustomerDetail"));
const SupplierDetail = lazy(() => import("./pages/SupplierDetail"));
const PortalView = lazy(() => import("./pages/PortalView"));

function Splash() {
  return <FileyLoader />;
}

function ModuleDisabled({ name }: { name: string }) {
  return (
    <div className="card max-w-md mx-auto mt-10 text-center">
      <p className="text-lg font-bold text-ink">{name} is disabled</p>
      <p className="text-sm text-brand-500 mt-2">
        Enable this module from <b>Settings → Apps</b> to use it.
      </p>
    </div>
  );
}

function AppRoutes() {
  const { modules, isEnabled } = useModules();
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        {modules.map((m) => {
          const Page = m.Component;
          return (
            <Route
              key={m.id}
              path={m.to}
              element={
                isEnabled(m.id) ? <Page /> : <ModuleDisabled name={m.label} />
              }
            />
          );
        })}
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/suppliers/:id" element={<SupplierDetail />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </Suspense>
  );
}

function Gate() {
  const { loading, configured, user, needsProfile, profileLoading } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  if (loading) return <Splash />;
  if (!configured) return <SetupNotice />;
  if (!user)
    return showLogin ? (
      <Login />
    ) : (
      <Landing onGetStarted={() => setShowLogin(true)} />
    );
  // Signed in but still fetching the profile — show the splash, not the
  // profile-setup form (which would otherwise flash for existing users).
  if (profileLoading) return <Splash />;
  if (needsProfile) return <ProfileSetup />;

  return (
    <ModulesProvider>
      <HashRouter>
        <Layout>
          <AppRoutes />
        </Layout>
        <Copilot />
        <CommandPalette />
        <OverdueReminder />
      </HashRouter>
    </ModulesProvider>
  );
}

export default function App() {
  // Public customer portal — shared invoice links open here without auth.
  if (typeof window !== "undefined" && window.location.hash.startsWith("#/portal/")) {
    return (
      <Suspense fallback={<Splash />}>
        <PortalView />
      </Suspense>
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
