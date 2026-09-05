import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { rememberLocalCredential } from "../../lib/localAuth";
import { checkPassword } from "../../lib/password";
import { isLocalMode } from "../../lib/dataMode";
import { mfaFactor, mfaEnroll, mfaVerify, mfaDisable, type MfaFactor } from "../../lib/mfa";
import { Modal, Field } from "../../components/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Lock, KeyRound, Monitor, ShieldAlert } from "lucide-react";

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
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-xl border border-border px-3 py-3 text-left hover:bg-hover transition-colors cursor-pointer"
    >
      <span
        className={`rounded-md p-2 ${
          danger ? "bg-danger/10 text-danger" : "bg-primary-100 text-ink"
        }`}
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span
          className={`block text-sm font-medium ${danger ? "text-danger" : "text-ink"}`}
        >
          {title}
        </span>
        <span className="block text-[11px] text-muted-foreground">{desc}</span>
      </span>
      {right}
      {!danger && <ChevronRightIcon />}
    </button>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="text-muted-foreground shrink-0">
      <path d="m9 18 6-6-6-6" />
    </svg>
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
  const [twoFaOpen, setTwoFaOpen] = useState(false);

  const refreshFactor = async () => {
    if (!cloud) return setLoaded(true);
    try {
      setFactor(await mfaFactor());
    } catch {
      // A failed read must not claim 2FA is off — leave the row unresolved.
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
      : factor
        ? "On — a code from your authenticator app is required to sign in"
        : "Off — add an authenticator app for a second step at sign-in";

  return (
    <div className="card">
      <p className="font-medium text-ink">Security</p>
      <p className="text-sm text-muted-foreground mt-0.5 mb-4">Protect your account</p>
      <div className="space-y-2">
        <ManageRow
          icon={<Lock size={16} />}
          title="Change Password"
          desc="Requires your current password to confirm"
          onClick={onChangePassword}
        />
        <ManageRow
          icon={<KeyRound size={16} />}
          title="Two-Factor Authentication"
          desc={twoFaDesc}
          right={
            cloud && loaded && factor ? (
              <span className="rounded-md bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                ON
              </span>
            ) : undefined
          }
          onClick={cloud ? () => setTwoFaOpen(true) : undefined}
        />
        <ManageRow
          icon={<Monitor size={16} />}
          title="Active Sessions"
          desc="Not available yet — planned for a future release"
        />
      </div>
      <TwoFactorModal
        open={twoFaOpen}
        factor={factor}
        onClose={() => setTwoFaOpen(false)}
        onChanged={refreshFactor}
      />
    </div>
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
      setErr(/invalid|incorrect/i.test(e?.message ?? "") ? "That code didn't match. Try the next one." : (e?.message ?? String(e)));
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
          <p className="text-sm text-muted-foreground">
            {factor.friendlyName} is set up. Signing in on a new device asks for a
            6-digit code from it.
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
            Scan this with Google Authenticator, 1Password, Authy or similar, then
            enter the code it shows.
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
            <button className="btn-primary" disabled={busy || code.length < 6} onClick={confirm}>
              {busy ? "Verifying…" : "Turn on"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add a second step at sign-in: your password, then a 6-digit code from
            an authenticator app on your phone.
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

  const submit = async () => {
    if (currentPw.length < 1) return setErr("Enter your current password first.");
    // The same policy signup uses — this screen asked only for 8 characters, so
    // a password rejected at the front door could be set from inside.
    const verdict = checkPassword(pw);
    if (!verdict.ok) return setErr(`${verdict.problem}.`);
    if (pw !== pw2) return setErr("Passwords do not match.");
    if (!supabase) return setErr("Auth not configured.");
    setBusy(true);
    setErr("");

    // Re-authenticate with the current password before rotating. Without this
    // challenge, anyone at an unlocked keyboard silently takes over the account.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: (await supabase.auth.getUser()).data.user?.email ?? "",
      password: currentPw,
    });
    if (reauthError) {
      setBusy(false);
      return setErr(
        reauthError.message.includes("Invalid login credentials")
          ? "Current password is incorrect."
          : `Could not verify your identity: ${reauthError.message}`
      );
    }

    const { error } = await supabase.auth.updateUser({ password: pw });
    if (!error) {
      const { data } = await supabase.auth.getUser();
      if (data.user?.email)
        await rememberLocalCredential(data.user.email, data.user.id, pw);
    }
    setBusy(false);
    if (error) setErr(error.message);
    else {
      setOk(true);
      // The re-auth above started a FRESH session, and a fresh session on a 2FA
      // account comes back at aal1 — assurance the app was already holding is
      // silently gone. Re-check now the change is done, not mid-flow: the gate
      // asks for a code instead of yanking the user out before they see this
      // succeeded, and anything needing aal2 (turning 2FA off, notably) keeps
      // working. No-op when 2FA is off.
      await refreshMfaPending();
      timeoutRef.current = setTimeout(close, 1200);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Change Password">
      <div className="space-y-3">
        <Field label="Current Password">
          <input
            type="password"
            className="input"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
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
            Your current password is required to confirm this change.
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
