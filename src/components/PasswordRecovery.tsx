import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import Logo from "./Logo";
import { FormField } from "./ui";
import { createRecoveryClient, requestPasswordResetEmail } from "../lib/supabase";
import { checkPassword } from "../lib/password";
import { getLocalCredential, rememberLocalCredential } from "../lib/localAuth";
import { mfaFactor, mfaVerify } from "../lib/mfa";

type RecoveryProps = {
  initialEmail: string;
  recoveryToken?: string;
  initialError?: string;
  offline: boolean;
  onBack: () => void;
};

export default function PasswordRecovery(props: RecoveryProps) {
  // A new link must never inherit a previously verified account or its password fields.
  return <RecoveryForm key={`${props.initialEmail}\0${props.recoveryToken || ""}`} {...props} />;
}

function RecoveryForm({ initialEmail, recoveryToken = "", initialError = "", offline, onBack }: RecoveryProps) {
  const client = useRef<SupabaseClient | null>(null);
  const inFlight = useRef(false);
  const [email, setEmail] = useState(initialEmail);
  const [token, setToken] = useState(recoveryToken);
  const [isOffline, setIsOffline] = useState(offline);
  const [sentTo, setSentTo] = useState(initialEmail && recoveryToken ? initialEmail.trim().toLowerCase() : "");
  const [verifiedId, setVerifiedId] = useState("");
  const [factorId, setFactorId] = useState("");
  const [factorCode, setFactorCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [done, setDone] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const recovery = client.current;
      client.current = null;
      void recovery?.auth.signOut({ scope: "local" }).catch(() => {});
    };
  }, []);
  useEffect(() => setIsOffline(offline), [offline]);
  useEffect(() => {
    const online = () => setIsOffline(false);
    const disconnected = () => setIsOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", disconnected);
    };
  }, []);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const sendLink = async (enteredEmail = email) => {
    if (inFlight.current || isOffline || cooldown) return;
    const address = (sentTo || enteredEmail).trim().toLowerCase();
    if (address.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
      return setError("Enter your account's email address.");
    setEmail(address);
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await requestPasswordResetEmail(address);
      if (!mounted.current) return;
      setSentTo(address);
      setCooldown(60);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const resetPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || isOffline) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const password = String(values.get("newPassword") || "");
    const verdict = checkPassword(password, sentTo);
    if (!verdict.ok) return setError(verdict.problem || "Choose a stronger password.");
    if (password !== values.get("confirmPassword")) return setError("Passwords do not match.");
    if (!verifiedId && !token) return setError("Open the reset link from your email to continue.");
    inFlight.current = true;
    setBusy(true);
    setError("");
    let recovery: SupabaseClient | null = null;
    try {
      recovery = client.current ??= createRecoveryClient();
      const currentAttempt = () => mounted.current && client.current === recovery;
      let accountId = verifiedId;
      if (!verifiedId) {
        const { data, error } = await recovery.auth.verifyOtp({ token_hash: token, type: "recovery" });
        if (error) throw error;
        if (!currentAttempt()) return;
        if (!data.user?.id || data.user.email?.toLowerCase() !== sentTo)
          throw new Error("Could not verify this account. Request a new reset link.");
        accountId = data.user.id;
        setVerifiedId(accountId);
      }
      // Re-check the server identity on retries; never apply a reset to another user.
      const current = await recovery.auth.getUser();
      if (!currentAttempt()) return;
      if (current.error) throw current.error;
      const user = current.data.user;
      if (!user?.id || user.email?.toLowerCase() !== sentTo || user.id !== accountId)
        throw new Error("Your recovery session changed. Request a new reset link.");
      const assurance = await recovery.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!currentAttempt()) return;
      if (assurance.error) throw assurance.error;
      if (!assurance.data?.currentLevel || !assurance.data.nextLevel)
        throw new Error("Could not check two-step verification. Try again.");
      if (assurance.data.nextLevel === "aal2" && assurance.data.currentLevel !== "aal2") {
        const factor = await mfaFactor(recovery);
        if (!currentAttempt()) return;
        if (!factor) throw new Error("Your account requires another verification method. Contact your administrator.");
        setFactorId(factor.id);
        if (factorId !== factor.id || !/^\d{6}$/.test(factorCode))
          return setError("Enter the six-digit code from your authenticator app to finish.");
        await mfaVerify(factor.id, factorCode, recovery);
        if (!currentAttempt()) return;
        setFactorCode("");
      }
      if (!currentAttempt()) return;
      const { error } = await recovery.auth.updateUser({ password });
      if (error) throw error;
      if (!currentAttempt()) return;
      // Resetting an account does not claim or replace a device workspace.
      if (getLocalCredential()?.userId === user.id) {
        await rememberLocalCredential(sentTo, user.id, password).catch(() => {
          if (mounted.current) setError("Password saved online. Sign in online once to refresh this device's offline password.");
        });
      }
      if (!currentAttempt()) return;
      form.reset();
      setFactorCode("");
      setDone(true);
      await recovery.auth.signOut({ scope: "local" }).catch(() => {});
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!mounted.current) await recovery?.auth.signOut({ scope: "local" }).catch(() => {});
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const requestNewLink = () => {
    if (inFlight.current) return;
    const recovery = client.current;
    client.current = null;
    void recovery?.auth.signOut({ scope: "local" }).catch(() => {});
    setToken("");
    setSentTo("");
    setVerifiedId("");
    setFactorId("");
    setFactorCode("");
    setError("");
  };

  return (
    <div className="min-h-full bg-canvas grid place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-6">
          <Logo size={44} />
          <h1 className="mt-4 text-[22px] font-semibold tracking-tight text-foreground">
            {done ? "Password reset" : "Reset your password"}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {done ? "You can now sign in with your new password." : "Verify your email and choose a new password."}
          </p>
        </div>
        <div className="card p-6">
          {isOffline && !done && <p role="status" className="mb-4 text-sm text-muted-foreground">Connect to the internet to reset your password.</p>}
          {done ? (
            <p role="status" className="text-sm text-foreground">Your password has been updated. Your workspace and business records stay unchanged.</p>
          ) : !sentTo ? (
            <form className="space-y-4" onSubmit={(e) => {
              e.preventDefault();
              void sendLink(String(new FormData(e.currentTarget).get("email") || ""));
            }}>
              <FormField label="Email" htmlFor="recovery-email" required>
                <input id="recovery-email" name="email" className="input h-11" type="email" autoComplete="email" required
                  value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
              </FormField>
              <p className="text-xs text-muted-foreground">Use the email address you registered with Filey. You do not need your old password.</p>
              <button className="btn-primary h-11 w-full" disabled={busy || isOffline || cooldown > 0}>
                {busy && <Loader2 size={16} className="animate-spin" />} {cooldown > 0 ? `Send reset link in ${cooldown}s` : "Send reset link"}
              </button>
            </form>
          ) : !token && !verifiedId ? (
            <div className="space-y-4">
              <p role="status" className="text-sm text-muted-foreground break-words">
                If an account exists for {sentTo}, a reset link is on its way. Check your inbox and spam folder, then open the link to choose a new password.
              </p>
              <button type="button" className="btn-ghost" disabled={busy || isOffline || cooldown > 0} onClick={() => void sendLink()}>
                {cooldown > 0 ? `Resend reset link in ${cooldown}s` : "Resend reset link"}
              </button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={resetPassword}>
              <p role="status" className="text-sm text-muted-foreground break-words">
                {verifiedId ? "Reset link verified." : "Choose a new password below. We'll verify your link when you continue."}
              </p>
              <FormField label="New password" htmlFor="recovery-password" hint="At least 8 characters. A memorable phrase works well." required>
                <input id="recovery-password" name="newPassword" className="input h-11" type={showPassword ? "text" : "password"}
                  autoComplete="new-password" required disabled={busy} />
              </FormField>
              <FormField label="Confirm new password" htmlFor="recovery-confirm" required>
                <input id="recovery-confirm" name="confirmPassword" className="input h-11" type={showPassword ? "text" : "password"}
                  autoComplete="new-password" required disabled={busy} />
              </FormField>
              <button type="button" className="btn-ghost" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />} {showPassword ? "Hide passwords" : "Show passwords"}
              </button>
              {factorId && <FormField label="Authenticator code" htmlFor="recovery-mfa" required>
                <input id="recovery-mfa" className="input h-11" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  required value={factorCode} disabled={busy} onChange={(e) => setFactorCode(e.target.value.replace(/\D/g, ""))} />
              </FormField>}
              <button className="btn-primary h-11 w-full" disabled={busy || isOffline}>
                {busy && <Loader2 size={16} className="animate-spin" />} {busy ? "Saving…" : "Reset password"}
              </button>
            </form>
          )}
          {error && <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2.5 text-xs font-medium text-danger">{error}</p>}
          {!done && sentTo && <button type="button" className="btn-ghost mt-3 w-full" disabled={busy} onClick={requestNewLink}>
            {token ? "Request a new reset link" : "Use a different email"}
          </button>}
        </div>
        <button type="button" className="btn-ghost mt-4 w-full" disabled={busy} onClick={onBack}>
          <ArrowLeft size={15} /> Back to sign in
        </button>
      </div>
    </div>
  );
}
