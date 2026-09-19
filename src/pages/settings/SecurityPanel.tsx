import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { rememberLocalCredential } from "../../lib/localAuth";
import { checkPassword } from "../../lib/password";
import { isLocalMode } from "../../lib/dataMode";
import {
  mfaFactor,
  mfaEnroll,
  mfaVerify,
  mfaDisable,
  type MfaFactor,
} from "../../lib/mfa";
import { Modal, Field } from "../../components/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Lock, KeyRound, Monitor, ShieldAlert, ChevronRight } from "lucide-react";
import { SettingsPanel, SettingsSection } from "../../components/SettingsLayout";

function ManageRow({
  icon,
  title,
  desc,
  right,
  danger,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  right?: ReactNode;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="w-full flex items-center gap-3 py-4 text-left transition-colors enabled:hover:bg-hover disabled:cursor-default"
    >
      <span className={`shrink-0 ${danger ? "text-danger" : "text-muted-foreground"}`}>
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span
          className={`block text-[13px] font-medium ${danger ? "text-danger" : "text-foreground"}`}
        >
          {title}
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
          {desc}
        </span>
      </span>
      {right}
      {!danger && onClick && <ChevronRight size={16} className="text-muted-foreground" aria-hidden="true" />}
    </button>
  );
}


export default function SecurityPanel({
  onChangePassword,
}: {
  onChangePassword: () => void;
}) {
  // 2FA lives in the cloud account. An offline install signs in against this
  // device's own hash and never asks Supabase, so there is nothing to enforce.
  const cloud = !!supabase && !isLocalMode();
  const [factor, setFactor] = useState<MfaFactor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [twoFaOpen, setTwoFaOpen] = useState(false);

  const refreshFactor = async () => {
    if (!cloud) return setLoaded(true);
    setLoaded(false);
    setLoadError(false);
    try {
      setFactor(await mfaFactor());
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    void refreshFactor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud]);

  const twoFaDesc = !cloud
    ? "Needs a cloud account — offline installs sign in on this device"
    : !loaded
      ? "Checking…"
      : loadError
        ? "Status unavailable"
        : factor
          ? "On — a code from your authenticator app is required to sign in"
          : "Off — add an authenticator app for a second step at sign-in";

  return (
    <SettingsPanel>
      <SettingsSection
        title="Security"
        description="Protect your sign-in and manage account access."
      >
        <div className="-my-4 divide-y divide-border">
          <ManageRow
            icon={<Lock size={16} />}
            title="Change Password"
            desc="Verify with your password or a fresh email code"
            onClick={onChangePassword}
          />
          <div>
            <ManageRow
              icon={<KeyRound size={16} />}
              title="Two-Factor Authentication"
              desc={twoFaDesc}
              right={
                cloud && loaded && !loadError && factor ? (
                  <span className="rounded-full bg-success/10 px-2 py-1 text-xs font-medium text-success">
                    ON
                  </span>
                ) : undefined
              }
              onClick={
                cloud && loaded && !loadError ? () => setTwoFaOpen(true) : undefined
              }
            />
            {loadError && (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 pb-4"
              >
                <p className="text-xs text-muted-foreground">
                  Could not check two-factor authentication. Try again.
                </p>
                <button className="btn-ghost" onClick={() => void refreshFactor()}>
                  Retry
                </button>
              </div>
            )}
          </div>
          <ManageRow
            icon={<Monitor size={16} />}
            title="Active Sessions"
            desc="Not available yet — planned for a future release"
          />
        </div>
      </SettingsSection>
      <TwoFactorModal
        open={twoFaOpen}
        factor={factor}
        onClose={() => setTwoFaOpen(false)}
        onChanged={refreshFactor}
      />
    </SettingsPanel>
  );
}

/** Enrol an authenticator app, or turn an existing one off. Enrolment is only
 *  real once a code from the app has been accepted — until then Supabase holds
 *  an unverified factor that mfaEnroll clears on the next attempt. */
function TwoFactorModal({
  open,
  factor,
  onClose,
  onChanged,
}: {
  open: boolean;
  factor: MfaFactor | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    if (!open) return;
    setQr("");
    setSecret("");
    setFactorId("");
    setCode("");
    setErr("");
    setOk("");
  }, [open]);

  const startEnrol = async () => {
    setBusy(true);
    setErr("");
    try {
      const e = await mfaEnroll();
      setFactorId(e.factorId);
      setQr(e.qr);
      setSecret(e.secret);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setErr("");
    try {
      await mfaVerify(factorId, code);
      await onChanged();
      setOk("Two-factor authentication is on. Keep a backup of the secret.");
      setQr("");
    } catch (e: any) {
      // Wrong code: keep the QR on screen so the next attempt doesn't restart
      // enrolment (which would invalidate what they just scanned).
      setErr(
        /invalid|incorrect/i.test(e?.message ?? "")
          ? "That code didn't match. Try the next one."
          : (e?.message ?? String(e))
      );
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (!factor) return;
    setBusy(true);
    setErr("");
    try {
      await mfaDisable(factor.id);
      await onChanged();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Two-Factor Authentication">
      {factor ? (
        <div className="space-y-3">
          <p className="break-words text-sm text-muted-foreground">
            {factor.friendlyName} is set up. Signing in on a new device asks for a 6-digit
            code from it.
          </p>
          <div className="flex items-start gap-1.5 rounded-lg bg-info/5 px-2.5 py-1.5">
            <ShieldAlert size={13} className="text-info shrink-0 mt-px" />
            <p className="text-[11px] text-muted-foreground">
              Turning this off removes the second step for every device.
            </p>
          </div>
          {err && (
            <p className="text-xs font-medium text-danger bg-danger/10 rounded-xl px-3 py-2">
              {err}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={onClose}>
              Close
            </button>
            <button className="btn-danger" disabled={busy} onClick={turnOff}>
              {busy ? "Turning off…" : "Turn off"}
            </button>
          </div>
        </div>
      ) : ok ? (
        <div className="space-y-3">
          <p className="text-xs font-medium text-success bg-success/10 rounded-xl px-3 py-2">
            {ok}
          </p>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : qr ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Scan this with Google Authenticator, 1Password, Authy or similar, then enter
            the code it shows.
          </p>
          <div className="flex justify-center rounded-xl bg-white p-3">
            <img src={qr} alt="Two-factor setup QR code" width={180} height={180} />
          </div>
          <Field label="Or enter this secret by hand">
            <input className="input font-mono text-xs" readOnly value={secret} />
          </Field>
          <Field label="6-digit code">
            <input
              className="input tracking-[0.3em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </Field>
          {err && (
            <p className="text-xs font-medium text-danger bg-danger/10 rounded-xl px-3 py-2">
              {err}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={busy || code.length < 6}
              onClick={confirm}
            >
              {busy ? "Verifying…" : "Turn on"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add a second step at sign-in: your password, then a 6-digit code from an
            authenticator app on your phone.
          </p>
          {err && (
            <p className="text-xs font-medium text-danger bg-danger/10 rounded-xl px-3 py-2">
              {err}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" disabled={busy} onClick={startEnrol}>
              {busy ? "Preparing…" : "Set up"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function ChangePasswordModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [proof, setProof] = useState<"password" | "email">("password");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<{ email: string; id: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const [currentPw, setCurrentPw] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const { refreshMfaPending } = useAuth();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setCurrentPw("");
      setProof("password");
      setCode("");
      setChallenge(null);
      setCooldown(0);
      setPw("");
      setPw2("");
      setErr("");
      setOk(false);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [open]);

  const close = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    onClose();
  };

  const sendCode = async () => {
    if (!supabase || busy || cooldown) return;
    setBusy(true);
    setErr("");
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user?.email)
        throw new Error("Sign in with your email account first.");
      const sent = await supabase.auth.signInWithOtp({
        email: data.user.email,
        options: { shouldCreateUser: false },
      });
      if (sent.error) throw sent.error;
      setChallenge({ email: data.user.email, id: data.user.id });
      setCooldown(60);
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    if (proof === "password" && !currentPw)
      return setErr("Enter your current password, or verify with an email code.");
    if (proof === "email" && (!challenge || !/^\d{6}$/.test(code)))
      return setErr("Request an email code and enter its six digits.");
    const verdict = checkPassword(pw);
    if (!verdict.ok) return setErr(verdict.problem || "Choose a stronger password.");
    if (pw !== pw2) return setErr("Passwords do not match.");
    if (!supabase) return setErr("Auth not configured.");
    setBusy(true);
    setErr("");
    try {
      const current = await supabase.auth.getUser();
      if (current.error || !current.data.user?.email)
        throw new Error("Sign in again before changing your password.");
      if (proof === "email") {
        if (challenge!.id !== current.data.user.id)
          throw new Error("Your account changed. Request a new code.");
        const verified = await supabase.auth.verifyOtp({
          email: challenge!.email,
          token: code,
          type: "email",
        });
        if (verified.error) throw verified.error;
        if (verified.data.user?.id !== challenge!.id)
          throw new Error("Could not verify this account.");
      } else {
        const verified = await supabase.auth.signInWithPassword({
          email: current.data.user.email,
          password: currentPw,
        });
        if (verified.error) throw verified.error;
      }
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      // The cloud password already changed; a device cache failure is a separate issue.
      await rememberLocalCredential(
        current.data.user.email,
        current.data.user.id,
        pw
      ).catch(() =>
        setErr(
          "Password saved online. Sign in online once before using the new password offline."
        )
      );
      setOk(true);
      await refreshMfaPending();
      timeoutRef.current = setTimeout(close, 1200);
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Change Password">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            className={proof === "password" ? "btn-secondary" : "btn-ghost"}
            disabled={busy}
            onClick={() => {
              setProof("password");
              setErr("");
            }}
          >
            Current password
          </button>
          <button
            className={proof === "email" ? "btn-secondary" : "btn-ghost"}
            disabled={busy}
            onClick={() => {
              setProof("email");
              setErr("");
            }}
          >
            Verify by email
          </button>
        </div>
        {proof === "email" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Verify your account with a fresh email code to set or recover your password.
            </p>
            <button
              className="btn-secondary"
              onClick={() => void sendCode()}
              disabled={busy || cooldown > 0}
            >
              {cooldown > 0
                ? `Resend in ${cooldown}s`
                : challenge
                  ? "Resend code"
                  : "Send verification code"}
            </button>
            {challenge && (
              <label className="block">
                <span className="label">Email verification code</span>
                <input
                  className="input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </label>
            )}
          </div>
        ) : (
          <Field label="Current Password">
            <input
              type="password"
              className="input"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
        )}
        <Field label="New Password">
          <input
            type="password"
            className="input"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm New Password">
          <input
            type="password"
            className="input"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <div className="flex items-start gap-1.5 rounded-lg bg-info/5 px-2.5 py-1.5">
          <ShieldAlert size={13} className="text-info shrink-0 mt-px" />
          <p className="text-[11px] text-muted-foreground">
            Verify with your current password or a fresh email code to confirm this
            change.
          </p>
        </div>
        {err && (
          <p className="text-xs font-medium text-danger bg-danger/10 rounded-xl px-3 py-2">
            {err}
          </p>
        )}
        {ok && (
          <p className="text-xs font-medium text-success bg-success/10 rounded-xl px-3 py-2">
            Password updated.
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={close}>
          Cancel
        </button>
        <button className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? "Updating…" : "Update Password"}
        </button>
      </div>
    </Modal>
  );
}
