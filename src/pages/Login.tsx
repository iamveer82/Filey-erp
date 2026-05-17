import { useState } from "react";
import {
  Boxes,
  ArrowLeft,
  ShieldCheck,
  Zap,
  BarChart3,
  Star,
} from "lucide-react";
import { useAuth, type Channel } from "../lib/auth";

type Mode = "signin" | "signup";
type Method = "password" | "otp";
type Screen = "form" | "otp";

function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex rounded-xl bg-brand-100 p-1 gap-1" role="tablist">
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(o.v)}
            className={
              "flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200 cursor-pointer disabled:cursor-not-allowed " +
              (active
                ? "bg-white text-ink shadow-bento"
                : "text-brand-500 hover:text-ink")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function Login() {
  const {
    signInWithPassword,
    signUpWithPassword,
    sendLoginOtp,
    verifyOtp,
    resendOtp,
  } = useAuth();

  const [screen, setScreen] = useState<Screen>("form");
  const [mode, setMode] = useState<Mode>("signin");
  const [channel, setChannel] = useState<Channel>("email");
  const [method, setMethod] = useState<Method>("password");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [token, setToken] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [otpPurpose, setOtpPurpose] = useState<"signup" | "login">("login");

  const cred = { channel, value: identifier };
  const idLabel = channel === "email" ? "Email" : "Phone number";
  const idPlaceholder =
    channel === "email" ? "you@company.com" : "+9715XXXXXXXX";

  const reset = (keepIdentifier = true) => {
    setErr(null);
    setMsg(null);
    if (!keepIdentifier) setIdentifier("");
    setPassword("");
    setConfirm("");
    setToken("");
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);

    if (channel === "phone" && !/^\+\d{8,15}$/.test(identifier.trim())) {
      setErr("Enter phone in international format, e.g. +971501234567");
      return;
    }

    setBusy(true);
    try {
      if (mode === "signup") {
        if (password !== confirm) {
          setErr("Passwords do not match.");
          return;
        }
        const { needsOtp } = await signUpWithPassword(cred, password);
        if (needsOtp) {
          setOtpPurpose("signup");
          setScreen("otp");
          setMsg(
            channel === "email"
              ? "We sent a 6-digit code to your email. Enter it below. (If you got a confirmation link instead, click it.)"
              : "We sent a 6-digit code by SMS. Enter it below."
          );
        }
      } else if (method === "password") {
        await signInWithPassword(cred, password);
      } else {
        await sendLoginOtp(cred);
        setOtpPurpose("login");
        setScreen("otp");
        setMsg(
          channel === "email"
            ? "We emailed you a one-time code."
            : "We sent a one-time code by SMS."
        );
      }
    } catch (e2: any) {
      setErr(e2?.message ?? String(e2));
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await verifyOtp(cred, token, otpPurpose);
    } catch (e2: any) {
      setErr(e2?.message ?? String(e2));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      await resendOtp(cred, otpPurpose);
      setMsg("A new code is on its way.");
    } catch (e2: any) {
      setErr(e2?.message ?? String(e2));
    } finally {
      setBusy(false);
    }
  };

  const FEATURES = [
    { icon: BarChart3, t: "Real-time inventory & sales insights" },
    { icon: Zap, t: "Local PDF tools & instant invoicing" },
    { icon: ShieldCheck, t: "FTA-compliant tax invoices, secured" },
  ];

  return (
    <div className="min-h-full grid lg:grid-cols-2 bg-background">
      {/* ── Brand panel ── */}
      <div className="hidden lg:flex relative overflow-hidden flex-col justify-between p-12 bg-gradient-to-br from-primary-300 via-primary-400 to-secondary-400">
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-white/20 blur-2xl" />
        <div className="absolute -bottom-32 -left-20 w-96 h-96 rounded-full bg-ink/10 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <div className="rounded-2xl bg-ink p-2.5 text-white">
            <Boxes size={24} />
          </div>
          <p className="text-2xl font-bold text-ink">Filey</p>
        </div>

        <div className="relative">
          <h2 className="text-[34px] leading-[1.15] font-bold text-ink max-w-md">
            Run your whole business from one calm place.
          </h2>
          <p className="text-ink/70 mt-4 max-w-sm">
            Inventory, orders, invoicing and CRM — fast, offline-friendly
            and beautifully simple.
          </p>

          <div className="mt-8 space-y-3">
            {FEATURES.map(({ icon: Icon, t }) => (
              <div key={t} className="flex items-center gap-3">
                <div className="rounded-xl bg-white/40 p-2 text-ink">
                  <Icon size={18} />
                </div>
                <span className="text-sm font-semibold text-ink">{t}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative rounded-2xl bg-white/30 backdrop-blur p-4 max-w-sm">
          <div className="flex gap-1 text-ink">
            {[0, 1, 2, 3, 4].map((i) => (
              <Star key={i} size={14} fill="currentColor" />
            ))}
          </div>
          <p className="text-sm text-ink/80 mt-2">
            “Filey replaced three tools for us. The invoicing alone pays
            for itself.”
          </p>
          <p className="text-xs font-semibold text-ink mt-2">
            Olivia Rhye · Operations Lead
          </p>
        </div>
      </div>

      {/* ── Form panel ── */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="flex lg:hidden flex-col items-center mb-8">
            <div className="rounded-2xl bg-ink p-3 text-white">
              <Boxes size={26} />
            </div>
            <h1 className="text-2xl font-bold text-ink mt-3">Filey</h1>
          </div>

          {screen === "form" ? (
            <form onSubmit={submitForm} className="space-y-4">
              <div className="mb-2">
                <h1 className="text-2xl font-bold text-ink">
                  {mode === "signin"
                    ? "Welcome back"
                    : "Create your account"}
                </h1>
                <p className="text-sm text-brand-500 mt-1">
                  {mode === "signin"
                    ? "Sign in to continue to your workspace."
                    : "Start managing your business in minutes."}
                </p>
              </div>

              <Segmented<Channel>
                value={channel}
                disabled={busy}
                onChange={(v) => {
                  setChannel(v);
                  reset(false);
                }}
                options={[
                  { v: "email", label: "Email" },
                  { v: "phone", label: "Phone" },
                ]}
              />

              <div>
                <label className="label" htmlFor="identifier">
                  {idLabel}
                </label>
                <input
                  id="identifier"
                  className="input"
                  type={channel === "email" ? "email" : "tel"}
                  inputMode={channel === "email" ? "email" : "tel"}
                  autoComplete={channel === "email" ? "email" : "tel"}
                  placeholder={idPlaceholder}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                />
              </div>

              {!(mode === "signin" && method === "otp") && (
                <div>
                  <label className="label" htmlFor="password">
                    Password
                  </label>
                  <input
                    id="password"
                    className="input"
                    type="password"
                    autoComplete={
                      mode === "signup"
                        ? "new-password"
                        : "current-password"
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
              )}

              {mode === "signup" && (
                <div>
                  <label className="label" htmlFor="confirm">
                    Confirm password
                  </label>
                  <input
                    id="confirm"
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
              )}

              {mode === "signin" && (
                <Segmented<Method>
                  value={method}
                  disabled={busy}
                  onChange={(v) => {
                    setMethod(v);
                    setErr(null);
                    setMsg(null);
                  }}
                  options={[
                    { v: "password", label: "Password" },
                    { v: "otp", label: "One-time code" },
                  ]}
                />
              )}

              {err && (
                <p className="text-xs font-semibold text-danger bg-danger/10 rounded-lg px-3 py-2">
                  {err}
                </p>
              )}
              {msg && (
                <p className="text-xs font-semibold text-brand-600 bg-brand-100 rounded-lg px-3 py-2">
                  {msg}
                </p>
              )}

              <button
                className="btn-primary w-full justify-center"
                disabled={busy}
              >
                {busy
                  ? "Please wait…"
                  : mode === "signup"
                  ? "Create account"
                  : method === "otp"
                  ? "Send code"
                  : "Sign in"}
              </button>

              <button
                type="button"
                className="text-xs font-semibold text-brand-500 hover:text-ink w-full text-center cursor-pointer"
                onClick={() => {
                  setMode(mode === "signin" ? "signup" : "signin");
                  setMethod("password");
                  reset(true);
                }}
              >
                {mode === "signin"
                  ? "No account? Create one"
                  : "Have an account? Sign in"}
              </button>
            </form>
          ) : (
            <form onSubmit={submitOtp} className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setScreen("form");
                  setToken("");
                  setErr(null);
                  setMsg(null);
                }}
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-500 hover:text-ink cursor-pointer"
              >
                <ArrowLeft size={14} /> Back
              </button>

              <div>
                <h1 className="text-2xl font-bold text-ink">
                  Enter the code
                </h1>
                <p className="text-sm text-brand-500 mt-1">
                  Sent to{" "}
                  <span className="font-semibold text-ink">
                    {identifier}
                  </span>
                </p>
              </div>

              <div>
                <label className="label" htmlFor="otp">
                  6-digit code
                </label>
                <input
                  id="otp"
                  className="input tracking-[0.5em] text-center text-lg"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={token}
                  onChange={(e) =>
                    setToken(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  required
                  autoFocus
                />
              </div>

              {err && (
                <p className="text-xs font-semibold text-danger bg-danger/10 rounded-lg px-3 py-2">
                  {err}
                </p>
              )}
              {msg && (
                <p className="text-xs font-semibold text-brand-600 bg-brand-100 rounded-lg px-3 py-2">
                  {msg}
                </p>
              )}

              <button
                className="btn-primary w-full justify-center"
                disabled={busy || token.length < 6}
              >
                {busy ? "Verifying…" : "Verify"}
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={resend}
                className="text-xs font-semibold text-brand-500 hover:text-ink w-full text-center cursor-pointer disabled:opacity-50"
              >
                Resend code
              </button>
            </form>
          )}

          <p className="text-[11px] text-brand-400 text-center mt-8">
            Protected workspace · Supabase-secured
          </p>
        </div>
      </div>
    </div>
  );
}
