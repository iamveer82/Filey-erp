import { type ReactNode, useState } from "react";
import { useAuth } from "@shared/auth";
import { isLocalMode } from "@shared/dataMode";
import { Spinner } from "./ui";

/** The auth gate: splash while the session resolves, login when signed out,
 *  a minimal profile form on first run, then the app. Same AuthProvider as the
 *  desktop, so a session there is a session here. */
export function Gate({ children }: { children: ReactNode }) {
  const auth = useAuth();

  if (auth.loading)
    return (
      <div className="grid h-dvh place-items-center bg-page">
        <Spinner className="h-8 w-8" />
      </div>
    );

  if (!auth.user) return <Login />;

  if (auth.needsProfile) return <ProfileSetup />;

  if (auth.profileLoading)
    return (
      <div className="grid h-dvh place-items-center bg-page">
        <Spinner className="h-8 w-8" />
      </div>
    );

  return <>{children}</>;
}

function Login() {
  const { signInWithPassword, sendLoginOtp, verifyOtp, configured } = useAuth();
  const [method, setMethod] = useState<"password" | "otp">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await signInWithPassword({ channel: "email", value: email.trim() }, password);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    setErr(null);
    setBusy(true);
    try {
      await sendLoginOtp({ channel: "email", value: email.trim() });
      setCodeSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setErr(null);
    setBusy(true);
    try {
      await verifyOtp({ channel: "email", value: email.trim() }, code, "login");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-page px-6">
      <div className="mx-auto w-full max-w-sm screen-in">
        <div className="mb-8 text-center">
          <img
            src="/icons/filey-logo.png"
            alt=""
            className="mx-auto mb-4 h-16 w-16 rounded-2xl object-cover"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
          <h1 className="text-[24px] font-semibold tracking-tight text-foreground">
            Filey
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Your business, in your pocket
          </p>
        </div>

        <div className="card space-y-3 p-5">
          {/* Method toggle — accounts sign in either by password or by a
              6-digit email code (no password). Both must exist or a code-only
              account is locked out of mobile entirely. */}
          <div className="flex rounded-lg bg-muted p-1 gap-1" role="tablist">
            {(
              [
                ["password", "Password"],
                ["otp", "Email code"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={method === v}
                onClick={() => {
                  setMethod(v);
                  setErr(null);
                }}
                className={
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-200 cursor-pointer " +
                  (method === v
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground")
                }
              >
                {label}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="label">Email</span>
            <input
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </label>

          {method === "password" ? (
            <label className="block">
              <span className="label">Password</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={(e) => e.key === "Enter" && !busy && void submit()}
              />
            </label>
          ) : !codeSent ? (
            <button
              className="btn-primary w-full"
              disabled={busy || !email.trim()}
              onClick={() => void sendCode()}
            >
              {busy ? "Sending…" : "Email me a code"}
            </button>
          ) : (
            <>
              <label className="block">
                <span className="label">6-digit code (sent to {email.trim()})</span>
                <input
                  className="input text-center text-[18px] tracking-[0.4em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="——————"
                  onKeyDown={(e) => e.key === "Enter" && code.length === 6 && !busy && void verify()}
                />
              </label>
              <button
                className="btn-primary w-full"
                disabled={busy || code.length !== 6}
                onClick={() => void verify()}
              >
                {busy ? "Verifying…" : "Verify & sign in"}
              </button>
              <button
                className="block mx-auto text-xs font-medium text-muted-foreground active:text-foreground transition-colors"
                disabled={busy}
                onClick={() => void sendCode()}
              >
                Resend code
              </button>
            </>
          )}

          {err && <p className="text-[12.5px] font-medium text-danger">{err}</p>}
          <button className="btn-primary w-full" onClick={() => void submit()} disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {!configured && !isLocalMode() && (
            <p className="text-center text-[11.5px] text-warning">
              Cloud not configured on this build.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileSetup() {
  const { createProfile, user } = useAuth();
  const [firstName, setFirst] = useState("");
  const [lastName, setLast] = useState("");
  const [company, setCompany] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await createProfile(firstName, lastName, company);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-page px-6">
      <div className="mx-auto w-full max-w-sm screen-in">
        <h1 className="mb-1 text-[22px] font-semibold tracking-tight text-foreground">
          Welcome{user?.email ? `, ${user.email.split("@")[0]}` : ""}
        </h1>
        <p className="mb-6 text-[13px] text-muted-foreground">
          One line about you and the business, then you're in.
        </p>
        <div className="card space-y-3 p-5">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">First name</span>
              <input className="input" value={firstName} onChange={(e) => setFirst(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Last name</span>
              <input className="input" value={lastName} onChange={(e) => setLast(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="label">Business name</span>
            <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
          {err && <p className="text-[12.5px] font-medium text-danger">{err}</p>}
          <button className="btn-primary w-full" onClick={() => void submit()} disabled={busy}>
            {busy ? "Setting up…" : "Start using Filey"}
          </button>
        </div>
      </div>
    </div>
  );
}
