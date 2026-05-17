import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import Layout from "./components/Layout";
import Overview from "./pages/Overview";
import Inventory from "./pages/Inventory";
import Orders from "./pages/Orders";
import Invoicing from "./pages/Invoicing";
import Quoting from "./pages/Quoting";
import Crm from "./pages/Crm";
import Suppliers from "./pages/Suppliers";
import Purchase from "./pages/Purchase";
import Reports from "./pages/Reports";
import ToolsPage from "./pages/PdfTools";
import Settings from "./pages/Tools";
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

function Gate() {
  const { loading, configured, user, needsProfile } = useAuth();
  if (loading) return <Splash />;
  if (!configured) return <SetupNotice />;
  if (!user) return <Login />;
  if (needsProfile) return <ProfileSetup />;

  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/invoicing" element={<Invoicing />} />
          <Route path="/quoting" element={<Quoting />} />
          <Route path="/crm" element={<Crm />} />
          <Route path="/suppliers" element={<Suppliers />} />
          <Route path="/purchase" element={<Purchase />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
