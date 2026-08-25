import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@shared/auth";
import { initDisplayCurrency } from "@shared/displayCurrency";
import { billing } from "@shared/api";
import { Gate } from "@mobile/components/Gate";
import { TabShell } from "@mobile/components/TabShell";
import Dashboard from "@mobile/screens/Dashboard";
import Invoices from "@mobile/screens/Invoices";
import InvoiceDetail from "@mobile/screens/InvoiceDetail";
import InvoiceCreate from "@mobile/screens/InvoiceCreate";
import Inventory from "@mobile/screens/Inventory";
import Customers from "@mobile/screens/Customers";
import CustomerDetail from "@mobile/screens/CustomerDetail";
import Settings from "@mobile/screens/Settings";
import Agent from "@mobile/screens/Agent";
import More from "@mobile/screens/More";

// Same boot sequence as the desktop topbar: the display currency drives every
// total on every screen. Never awaited — it lands and subscribers re-render.
void initDisplayCurrency().catch(() => {});

export default function App() {
  return (
    <AuthProvider>
      <Gate>
        <HashRouter>
          <TabShell>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/invoices/new" element={<InvoiceCreate />} />
              <Route path="/invoices/:id" element={<InvoiceDetail />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/customers/:id" element={<CustomerDetail />} />
              <Route path="/agent" element={<Agent />} />
              <Route path="/more" element={<More />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </TabShell>
        </HashRouter>
      </Gate>
    </AuthProvider>
  );
}
