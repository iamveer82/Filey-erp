import { supabase } from "../../lib/supabase";
import { Modal, Field } from "../../components/ui";
import { useEffect, useState, type ReactNode } from "react";
import { Lock, KeyRound, Monitor, ChevronRight } from "lucide-react";

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
      className="w-full flex items-center gap-3 rounded-xl border border-brand-200 px-3 py-3 text-left hover:bg-brand-50 transition-colors cursor-pointer"
    >
      <span
        className={`rounded-lg p-2 ${
          danger
            ? "bg-danger/10 text-danger"
            : "bg-primary-100 text-primary-700"
        }`}
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span
          className={`block text-sm font-semibold ${
            danger ? "text-danger" : "text-ink"
          }`}
        >
          {title}
        </span>
        <span className="block text-[11px] text-brand-400">{desc}</span>
      </span>
      {right}
      <ChevronRight size={15} className="text-brand-300 shrink-0" />
    </button>
  );
}

export default function SecurityPanel({
  onChangePassword,
}: {
  onChangePassword: () => void;
}) {
  return (
    <div className="card">
      <p className="font-bold text-ink">Security</p>
      <p className="text-sm text-brand-500 mt-0.5 mb-4">
        Protect your account
      </p>
      <div className="space-y-2">
        <ManageRow
          icon={<Lock size={16} />}
          title="Change Password"
          desc="Update your account password"
          onClick={onChangePassword}
        />
        <ManageRow
          icon={<KeyRound size={16} />}
          title="Two-Factor Authentication"
          desc="Enable TOTP from your Supabase account settings"
        />
        <ManageRow
          icon={<Monitor size={16} />}
          title="Active Sessions"
          desc="Sessions are managed by Supabase Auth"
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
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (open) {
      setPw("");
      setPw2("");
      setErr("");
      setOk(false);
    }
  }, [open]);

  const submit = async () => {
    if (pw.length < 6) return setErr("Password must be at least 6 characters.");
    if (pw !== pw2) return setErr("Passwords do not match.");
    if (!supabase) return setErr("Auth not configured.");
    setBusy(true);
    setErr("");
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setErr(error.message);
    else {
      setOk(true);
      setTimeout(onClose, 1200);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Change Password">
      <div className="space-y-3">
        <Field label="New Password">
          <input
            type="password"
            className="input"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </Field>
        <Field label="Confirm Password">
          <input
            type="password"
            className="input"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
          />
        </Field>
        {err && (
          <p className="text-xs font-semibold text-danger bg-danger/10 rounded-lg px-3 py-2">
            {err}
          </p>
        )}
        {ok && (
          <p className="text-xs font-semibold text-success bg-success/10 rounded-lg px-3 py-2">
            Password updated.
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? "Updating…" : "Update Password"}
        </button>
      </div>
    </Modal>
  );
}
