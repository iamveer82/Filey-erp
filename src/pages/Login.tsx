import { useState } from "react";
import {
  ArrowLeft,
  Mail,
  Phone,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import Logo from "../components/Logo";
import { FormField } from "../components/ui";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../components/InputOTP";
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
    <div
      className="flex rounded-lg bg-muted p-1 gap-1"
      role="tablist"
    >
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
              "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-200 cursor-pointer disabled:cursor-not-allowed " +
              (active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
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
    signInWithGoogle,
    signUpWithPassword,
    sendLoginOtp,
    verifyOtp,
    resendOtp,
  } = useAuth();
  // Google blocks OAuth inside embedded webviews — web build only.
  const hasTauriShell =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Inline validation
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const setFieldError = (field: string, err: string) =>
    setFieldErrors((prev) =>
      err ? { ...prev, [field]: err } : { ...prev, [field]: "" }
    );
  const clearFieldErrors = () => setFieldErrors({});

  const cred = { channel, value: identifier };
  const idLabel = channel === "email" ? "Email" : "Phone number";
  const idPlaceholder = channel === "email" ? "you@company.com" : "+9715XXXXXXXX";

  const reset = (keepIdentifier = true) => {
    setErr(null);
    setMsg(null);
    if (!keepIdentifier) setIdentifier("");
    setPassword("");
    setConfirm("");
    setToken("");
    clearFieldErrors();
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    clearFieldErrors();

    // Inline field validation
    let hasError = false;
    if (!identifier.trim()) {
      setFieldError("identifier", `${idLabel} is required`);
      hasError = true;
    } else if (channel === "phone" && !/^\+\d{8,15}$/.test(identifier.trim())) {
      setFieldError(
        "identifier",
        "Enter phone in international format, e.g. +971****4567"
      );
      hasError = true;
    } else if (
      channel === "email" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())
    ) {
      setFieldError("identifier", "Enter a valid email address");
      hasError = true;
    }

    if (mode === "signup" || (mode === "signin" && method === "password")) {
      if (!password) {
        setFieldError("password", "Password is required");
        hasError = true;
      } else if (password.length < 6) {
        setFieldError("password", "Password must be at least 6 characters");
        hasError = true;
      }
      if (mode === "signup" && password !== confirm) {
        setFieldError("confirm", "Passwords do not match");
        hasError = true;
      }
    }

    if (hasError) return;

    setBusy(true);
    try {
      if (mode === "signup") {
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

  const Msg = ({
    kind,
    children,
  }: {
    kind: "err" | "msg";
    children: React.ReactNode;
  }) => (
    <p
      role={kind === "err" ? "alert" : "status"}
      aria-live="polite"
      className={
        "flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs font-medium " +
        (kind === "err"
          ? "text-danger bg-danger/10"
          : "text-foreground bg-muted")
      }
    >
      {kind === "err" ? (
        <AlertCircle size={15} className="mt-px shrink-0" />
      ) : (
        <CheckCircle2 size={15} className="mt-px shrink-0" />
      )}
      <span>{children}</span>
    </p>
  );

  const heading =
    screen === "otp"
      ? "Enter the code"
      : mode === "signin"
        ? "Welcome back"
        : "Create your account";
  const subheading =
    screen === "otp" ? (
      <>
        Sent to <span className="font-medium text-ink">{identifier}</span>
      </>
    ) : mode === "signin" ? (
      "Sign in to continue to your workspace."
    ) : (
      "Start managing your business in minutes."
    );

  // Minimal centered auth surface — the same quiet canvas+card language as
  // the rest of the app (SetupNotice, ProfileSetup). No brand circus.
  return (
    <div className="min-h-full bg-canvas grid place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-6">
          <Logo size={44} />
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
            {heading}
          </h1>
          <p className="mt-1.5 text-sm text-brand-500">{subheading}</p>
        </div>

        <div className="card p-6">
          {screen === "form" ? (
            <form onSubmit={submitForm} className="space-y-4">
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

              <FormField
                label={idLabel}
                error={fieldErrors.identifier}
                hint={
                  channel === "phone"
                    ? "International format, e.g. +9715XXXXXXXX"
                    : undefined
                }
                required
              >
                <div className="relative">
                  {channel === "email" ? (
                    <Mail
                      size={16}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-400"
                    />
                  ) : (
                    <Phone
                      size={16}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-400"
                    />
                  )}
                  <input
                    id="identifier"
                    className="input pl-10"
                    type={channel === "email" ? "email" : "tel"}
                    inputMode={channel === "email" ? "email" : "tel"}
                    autoComplete={channel === "email" ? "email" : "tel"}
                    placeholder={idPlaceholder}
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value);
                      if (fieldErrors.identifier) setFieldError("identifier", "");
                    }}
                  />
                </div>
              </FormField>

              {!(mode === "signin" && method === "otp") && (
                <FormField
                  label="Password"
                  error={fieldErrors.password}
                  hint="At least 6 characters"
                  required
                >
                  <div className="relative">
                    <Lock
                      size={16}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-400"
                    />
                    <input
                      id="password"
                      className="input pl-10 pr-10"
                      type={showPw ? "text" : "password"}
                      autoComplete={
                        mode === "signup" ? "new-password" : "current-password"
                      }
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (fieldErrors.password) setFieldError("password", "");
                      }}
                      minLength={6}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={showPw ? "Hide password" : "Show password"}
                      onClick={() => setShowPw((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    >
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </FormField>
              )}

              {mode === "signup" && (
                <FormField label="Confirm password" error={fieldErrors.confirm} required>
                  <div className="relative">
                    <Lock
                      size={16}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-400"
                    />
                    <input
                      id="confirm"
                      className="input pl-10 pr-10"
                      type={showConfirm ? "text" : "password"}
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => {
                        setConfirm(e.target.value);
                        if (fieldErrors.confirm) setFieldError("confirm", "");
                      }}
                      minLength={6}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                      onClick={() => setShowConfirm((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    >
                      {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </FormField>
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

              {err && <Msg kind="err">{err}</Msg>}
              {msg && <Msg kind="msg">{msg}</Msg>}

              <button className="btn-primary w-full" disabled={busy}>
                {busy && <Loader2 size={16} className="animate-spin" />}
                {busy
                  ? "Please wait…"
                  : mode === "signup"
                    ? "Create account"
                    : method === "otp"
                      ? "Send code"
                      : "Sign in"}
              </button>

              {!hasTauriShell && (
                <>
                  <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-brand-400">
                    <span className="h-px flex-1 bg-brand-200 dark:bg-white/10" />
                    or
                    <span className="h-px flex-1 bg-brand-200 dark:bg-white/10" />
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className="btn-ghost w-full"
                    onClick={async () => {
                      setErr(null);
                      try {
                        await signInWithGoogle();
                      } catch (e) {
                        setErr(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.3H12v4.5h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.02.15 3.5 2.7.24.02c2.2-2 3.5-5 3.5-8.6z" />
                      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.1 0-5.8-2.1-6.7-5l-.14.01-3.6 2.8-.05.13C3.5 21.3 7.4 24 12 24z" />
                      <path fill="#FBBC05" d="M5.3 14.4c-.3-.8-.4-1.6-.4-2.4s.1-1.7.4-2.4l-.01-.16-3.7-2.8-.12.06C.5 8.2 0 10 0 12s.5 3.8 1.5 5.4l3.8-3z" />
                      <path fill="#EA4335" d="M12 4.7c2.2 0 3.7 1 4.6 1.8l3.3-3.2C17.9 1.2 15.2 0 12 0 7.4 0 3.5 2.7 1.5 6.6l3.8 3c.9-2.9 3.6-4.9 6.7-4.9z" />
                    </svg>
                    Continue with Google
                  </button>
                </>
              )}
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
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:text-ink cursor-pointer"
              >
                <ArrowLeft size={14} /> Back
              </button>

              <FormField label="6-digit code" required>
                <InputOTP
                  maxLength={6}
                  value={token}
                  onChange={(v) => setToken(v.replace(/\D/g, "").slice(0, 6))}
                >
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot key={i} index={i} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </FormField>

              {err && <Msg kind="err">{err}</Msg>}
              {msg && <Msg kind="msg">{msg}</Msg>}

              <button className="btn-primary w-full" disabled={busy || token.length < 6}>
                {busy && <Loader2 size={16} className="animate-spin" />}
                {busy ? "Verifying…" : "Verify"}
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={resend}
                className="text-xs font-medium text-brand-500 hover:text-ink w-full text-center cursor-pointer disabled:opacity-50"
              >
                Resend code
              </button>
            </form>
          )}
        </div>

        {screen === "form" && (
          <button
            type="button"
            className="mt-4 w-full text-center text-xs text-brand-500 cursor-pointer"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setMethod("password");
              reset(true);
            }}
          >
            {mode === "signin" ? (
              <>
                No account yet?{" "}
                <span className="font-medium text-ink">Create one</span>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <span className="font-medium text-ink">Sign in</span>
              </>
            )}
          </button>
        )}

        <p className="text-[11px] text-brand-400 text-center mt-6">
          Protected workspace · Supabase-secured
        </p>
      </div>
    </div>
  );
}
