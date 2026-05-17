import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { ModulesProvider, useModules } from "./lib/modules";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import ProfileSetup from "./pages/ProfileSetup";
import SetupNotice from "./pages/SetupNotice";

function Splash() {
  return (
    <div className="min-h-full grid place-items-center bg-background">
      <p className="text-sm font-semibold text-brand-400">Loading…</p>
    </div>
  );
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
    <Routes>
      <Route path="/" element={<Navigate to="/overview" replace />} />
      {modules.map((m) => (
        <Route
          key={m.id}
          path={m.to}
          element={
            isEnabled(m.id) ? m.element : <ModuleDisabled name={m.label} />
          }
        />
      ))}
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}

function Gate() {
  const { loading, configured, user, needsProfile } = useAuth();
  if (loading) return <Splash />;
  if (!configured) return <SetupNotice />;
  if (!user) return <Login />;
  if (needsProfile) return <ProfileSetup />;

  return (
    <ModulesProvider>
      <HashRouter>
        <Layout>
          <AppRoutes />
        </Layout>
      </HashRouter>
    </ModulesProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
