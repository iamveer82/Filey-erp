import { Suspense, lazy, useEffect, useState } from "react";
import { HashRouter } from "react-router-dom";
import { getDataMode } from "./lib/dataMode";
import { AuthProvider, useAuth } from "./lib/auth";
import { UIProvider } from "./lib/ui";
import { LanguageProvider } from "./lib/i18n";
import Login from "./pages/Login";
import PasswordRecovery from "./components/PasswordRecovery";
import TwoFactorGate from "./components/TwoFactorGate";
import ProfileSetup from "./pages/ProfileSetup";
import SetupNotice from "./pages/SetupNotice";
import FileyLoader from "./components/FileyLoader";
import { maybePromptDesktopShortcut } from "./lib/shortcut";

const Workspace = lazy(() => import("./components/Workspace"));
const PortalView = lazy(() => import("./pages/PortalView"));
function Splash() { return <FileyLoader />; }

function recoveryLink(): { token: string; email: string } | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash;
  if (raw.split("?")[0] !== "#/reset-password") return null;
  const params = new URLSearchParams(raw.split("?")[1] || "");
  const token = params.get("token_hash")?.trim() || "";
  const email = params.get("email")?.trim().toLowerCase() || "";
  return { token, email };
}

function ProfileLoadError({ onRetry, title = "Couldn't load your profile", description = "You're signed in, but we couldn't read your account details. This is usually a connection problem — your data is untouched." }: { onRetry: () => void; title?: string; description?: string }) {
  return (
    <div className="min-h-screen grid place-items-center p-6 bg-canvas">
      <div className="card max-w-sm w-full text-center space-y-3">
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        <p className="text-sm text-brand-500">
          {description}
        </p>
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
    profile,
    needsProfile,
    profileLoading,
    profileError,
    reloadProfile,
    mfaPending,
    mfaLoading,
    mfaError,
    refreshMfaPending,
  } = useAuth();
  // Desktop app, first sign-in on this device: offer to place a Desktop
  // shortcut (once per device; the helper self-guards and never throws).
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => void maybePromptDesktopShortcut(), 2000);
    return () => clearTimeout(t);
  }, [user]);
  if (loading) return <Splash />;
  // Ask once on first launch across all platforms. Existing signed-in accounts
  // keep their established workspace; a saved choice is never reset.
  if (!getDataMode() && !user) return <SetupNotice />;
  if (!configured) return <SetupNotice />;
  // Marketing lives on the separate website. Every ERP runtime returns to
  // authentication after sign-out, including browser previews and local mode.
  if (!user) return <Login />;
  // A correct password yields a real session that still sits at aal1 when the
  // account has an authenticator app. Nothing else may render until the code
  // is accepted. Cloud APIs also enforce assurance independently of this UI.
  if (mfaLoading) return <Splash />;
  if (mfaError) return <ProfileLoadError title="Couldn't verify sign-in" description={mfaError} onRetry={() => void refreshMfaPending().catch(() => {})} />;
  if (mfaPending) return <TwoFactorGate />;
  // Signed in but still fetching the profile — show the splash, not the
  // profile-setup form (which would otherwise flash for existing users).
  if (profileLoading) return <Splash />;
  // A failed profile READ must never fall through to ProfileSetup — completing
  // that form upserts over the real name and company.
  if (profileError)
    return <ProfileLoadError onRetry={() => void reloadProfile()} />;
  if (needsProfile) return <ProfileSetup />;

  return <Suspense fallback={<Splash />}><Workspace key={`${user.id}:${profile?.org_id ?? "default"}`} /></Suspense>;
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
