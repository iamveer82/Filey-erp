import { supabase } from "../../lib/supabase";
import { rememberLocalCredential } from "../../lib/localAuth";
import { checkPassword } from "../../lib/password";
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
          desc="Not available yet — planned for a future release"
        />
        <ManageRow
          icon={<Monitor size={16} />}
          title="Active Sessions"
          desc="Not available yet — planned for a future release"
        />
      </div>
    </div>
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
