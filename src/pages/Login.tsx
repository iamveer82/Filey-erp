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
import PeekingCharacters from "../components/PeekingCharacters";
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
      className="flex rounded-xl bg-brand-100 dark:bg-white/8 p-1 gap-1"
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
              "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-200 cursor-pointer disabled:cursor-not-allowed " +
              (active
                ? "bg-white text-ink dark:bg-[#2C2C2E] dark:text-[#F4F5F6]"
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
  const { signInWithPassword, signUpWithPassword, sendLoginOtp, verifyOtp, resendOtp } =
    useAuth();

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
  const [isTyping, setIsTyping] = useState(false);

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
          : "text-brand-700 bg-brand-100 dark:text-[#DDE0E4] dark:bg-white/12")
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

  return (
    <div className="min-h-full grid lg:grid-cols-2 bg-background dark:bg-[#1C1C1E]">
      {/* ── Brand panel with playful characters ── */}
      <div className="hidden lg:flex relative overflow-hidden flex-col justify-between p-12 bg-ink text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.7) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />

        <div className="relative flex items-center gap-3">
          <Logo size={56} />
          <p className="text-2xl font-medium">Filey</p>
        </div>

        <div className="relative">
          <h2 className="text-[32px] leading-[1.15] font-medium max-w-md">
            Run your whole business from one calm place.
          </h2>
          <p className="text-white/60 mt-3 max-w-sm">
            Inventory, orders, invoicing and CRM — fast and beautifully simple. (Mind the
            password — they're watching.)
          </p>
        </div>

        <div className="relative flex items-end justify-center">
          <PeekingCharacters
            typing={isTyping}
            passwordLength={password.length}
            passwordVisible={showPw}
          />
        </div>
      </div>

      {/* ── Form panel ── */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="flex lg:hidden flex-col items-center mb-8">
            <Logo size={104} />
            <h1 className="text-2xl font-medium text-ink mt-3">Filey</h1>
          </div>

          {screen === "form" ? (
            <form onSubmit={submitForm} className="space-y-4">
              <div className="mb-2">
                <h1 className="text-2xl font-medium text-ink">
                  {mode === "signin" ? "Welcome back" : "Create your account"}
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
                    onFocus={() => setIsTyping(true)}
                    onBlur={() => setIsTyping(false)}
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
                      onFocus={() => setIsTyping(true)}
                      onBlur={() => setIsTyping(false)}
                      minLength={6}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={showPw ? "Hide password" : "Show password"}
                      onClick={() => setShowPw((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-2xl p-1.5 text-brand-400 hover:text-ink hover:bg-brand-50 dark:hover:bg-white/5 dark:hover:text-[#F4F5F6] transition-colors cursor-pointer"
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
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-2xl p-1.5 text-brand-400 hover:text-ink hover:bg-brand-50 dark:hover:bg-white/5 dark:hover:text-[#F4F5F6] transition-colors cursor-pointer"
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

              <button
                type="button"
                className="text-xs font-medium text-brand-500 hover:text-ink w-full text-center cursor-pointer"
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
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:text-ink cursor-pointer"
              >
                <ArrowLeft size={14} /> Back
              </button>

              <div>
                <h1 className="text-2xl font-medium text-ink">Enter the code</h1>
                <p className="text-sm text-brand-500 mt-1">
                  Sent to <span className="font-medium text-ink">{identifier}</span>
                </p>
              </div>

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

          <p className="text-[11px] text-brand-400 text-center mt-8">
            Protected workspace · Supabase-secured
          </p>
        </div>
      </div>
    </div>
  );
}
