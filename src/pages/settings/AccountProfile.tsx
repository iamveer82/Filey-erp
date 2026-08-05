import { supabase, cloudConfigured } from "../../lib/supabase";
import { cloudSessionEmail } from "../../lib/sync";
import { useAuth } from "../../lib/auth";
import { useUI } from "../../lib/ui";
import { useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff, Pencil } from "lucide-react";
import { Badge, FormField } from "../../components/ui";

/* ---------------- Account & Profile ---------------- */

const PW_RULES = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  {
    label: "Contains uppercase and lowercase letters",
    test: (p: string) => /[a-z]/.test(p) && /[A-Z]/.test(p),
  },
  {
    label: "Contains a number or special character",
    test: (p: string) => /[0-9!@#$%^&*]/.test(p),
  },
];

function PwInput({
  val,
  onChange,
  shown,
  toggle,
}: {
  val: string;
  onChange: (v: string) => void;
  shown: boolean;
  toggle: () => void;
}) {
  return (
    <div className="relative">
      <input
        type={shown ? "text" : "password"}
        className="input pr-10"
        value={val}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label="Toggle visibility"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 cursor-pointer"
      >
        {shown ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

export default function AccountProfile() {
  const { profile, user, updateProfile, signInWithPassword } = useAuth();
  const { toast, prompt } = useUI();
  const [p, setP] = useState({
    name: profile?.name ?? "",
    phone: profile?.phone ?? "",
    role: profile?.role ?? "Administrator",
    username: profile?.username ?? "",
    avatar: profile?.avatar ?? "",
    language: profile?.language ?? "English (US)",
    timezone: profile?.timezone ?? "(GMT+04:00) Dubai, UAE",
    date_format: profile?.date_format ?? "DD MMM, YYYY",
    time_format: profile?.time_format ?? "12 Hour (02:30 PM)",
  });
  const set = (k: keyof typeof p, v: string) => setP({ ...p, [k]: v });
  const avatarRef = useRef<HTMLInputElement>(null);
  const [savedProfile, setSavedProfile] = useState(false);
  const [savedPrefs, setSavedPrefs] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const setFieldError = (f: string, e: string) =>
    setFieldErrors((p) => (e ? { ...p, [f]: e } : { ...p, [f]: "" }));
  const clearFieldErrors = () => setFieldErrors({});

  const initials = (p.name || profile?.email || "U")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const verified = !!(user as any)?.email_confirmed_at;

  const onAvatar = (file?: File) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => set("avatar", String(r.result));
    r.readAsDataURL(file);
  };

  // ---- password ----
  const [cur, setCur] = useState("");
  const [npw, setNpw] = useState("");
  const [cpw, setCpw] = useState("");
  const [show, setShow] = useState({ c: false, n: false, k: false });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const pwValid = PW_RULES.every((r) => r.test(npw));
  // cloudConfigured is true in every build (Supabase is baked in), so it says
  // nothing about whether this install has an account — and offline mode is
  // NOT the answer either: an offline install still signs in to the cloud for
  // sync, sharing and licensing. What actually decides whether these controls
  // can work is a live Supabase session, so ask for one. In offline mode the
  // AuthProvider runs a synthetic on-device user, so profile.email is not the
  // account address; the session's email is.
  const [cloudEmail, setCloudEmail] = useState<string | null>(null);
  const [cloudChecked, setCloudChecked] = useState(false);
  useEffect(() => {
    let alive = true;
    cloudSessionEmail()
      .then((e) => alive && setCloudEmail(e))
      .catch(() => {})
      .finally(() => alive && setCloudChecked(true));
    return () => {
      alive = false;
    };
  }, []);
  const cloudAccount = cloudConfigured && !!cloudEmail;
  /** The address the cloud account actually uses. */
  const accountEmail = cloudEmail ?? profile?.email ?? "";
  // An email change in flight: the new address plus the code sent to it.
  const [pending, setPending] = useState<{ next: string; nw: string } | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);

  const changeEmail = async () => {
    const next = await prompt({
      title: "Change email",
      label: "New email address",
      defaultValue: accountEmail,
      placeholder: "you@company.com",
    });
    if (!next || !supabase) return;
    const email = next.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return toast.error("Enter a valid email address.");
    if (email === accountEmail.trim().toLowerCase())
      return toast.error("That is already your email address.");
    const { error } = await supabase.auth.updateUser({ email });
    if (error) return toast.error(`Could not change email: ${error.message}`);
    // Secure email change is off — Supabase mails one code to the NEW address
    // and the change lands once it's verified.
    setPending({ next: email, nw: "" });
    toast.success(`We sent a 6-digit code to ${email}.`);
  };

  const confirmEmailChange = async () => {
    if (!supabase || !pending || !accountEmail) return;
    if (pending.nw.length !== 6)
      return toast.error("Enter the 6-digit code.");
    setEmailBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: pending.next,
        token: pending.nw,
        type: "email_change",
      });
      if (error) throw error;
      // auth.users is updated by Supabase; profiles.email is ours to keep in step.
      await updateProfile({ email: pending.next });
      setCloudEmail(pending.next);
      setPending(null);
      toast.success("Email updated.");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not confirm the change.");
    } finally {
      setEmailBusy(false);
    }
  };

  const updatePassword = async () => {
    setPwMsg(null);
    if (!pwValid) return setPwMsg({ ok: false, t: "New password too weak." });
    if (npw !== cpw) return setPwMsg({ ok: false, t: "Passwords do not match." });
    if (!supabase || !accountEmail) return;
    setPwBusy(true);
    try {
      // Re-auth against the cloud account, which in offline mode is not the
      // on-device profile.
      await signInWithPassword({ channel: "email", value: accountEmail }, cur);
      const { error } = await supabase.auth.updateUser({ password: npw });
      if (error) throw error;
      setPwMsg({ ok: true, t: "Password updated." });
      setCur("");
      setNpw("");
      setCpw("");
    } catch (e: any) {
      setPwMsg({
        ok: false,
        t: e?.message ?? "Current password is incorrect.",
      });
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 items-start">
      {/* left column */}
      <div className="space-y-4 min-w-0">
        {/* Profile Information */}
        <div className="card">
          <div className="flex items-start justify-between mb-1 gap-3">
            <div>
              <p className="font-medium text-ink">Profile Information</p>
              <p className="text-sm text-brand-500 mt-0.5">
                Update your personal details and profile information
              </p>
            </div>
            <button
              className="btn-primary text-xs"
              onClick={async () => {
                clearFieldErrors();
                let hasErr = false;
                if (!p.name?.trim()) {
                  setFieldError("name", "Full name is required");
                  hasErr = true;
                }
                if (hasErr) return;
                try {
                  await updateProfile({
                    name: p.name,
                    phone: p.phone,
                    role: p.role,
                    avatar: p.avatar,
                    username: p.username,
                  });
                  setSavedProfile(true);
                  setTimeout(() => setSavedProfile(false), 2500);
                  toast.success("Profile saved.");
                } catch (e) {
                  toast.error(`Could not save: ${e instanceof Error ? e.message : e}`);
                }
              }}
            >
              {savedProfile ? "Saved" : "Save Changes"}
            </button>
          </div>
          <div className="flex items-start gap-5 mt-4">
            <div className="relative shrink-0">
              <div className="w-20 h-20 rounded-full bg-ink text-white grid place-items-center text-xl font-medium overflow-hidden">
                {p.avatar ? (
                  <img
                    src={p.avatar}
                    alt="avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  initials
                )}
              </div>
              <button
                onClick={() => avatarRef.current?.click()}
                aria-label="Change photo"
                className="absolute -bottom-1 -right-1 rounded-full bg-primary-400 text-ink p-1.5 cursor-pointer"
              >
                <Pencil size={12} />
              </button>
              <input
                ref={avatarRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onAvatar(e.target.files?.[0])}
              />
            </div>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Full Name" error={fieldErrors.name} required>
                <input
                  className="input"
                  value={p.name}
                  onChange={(e) => {
                    set("name", e.target.value);
                    if (fieldErrors.name) setFieldError("name", "");
                  }}
                />
              </FormField>
              <FormField label="Email Address" hint="Contact admin to change">
                <input
                  className="input bg-brand-50"
                  value={profile?.email ?? ""}
                  disabled
                />
              </FormField>
              <FormField label="Phone Number" hint="+971 50 123 4567">
                <input
                  className="input"
                  placeholder="+971 50 123 4567"
                  value={p.phone}
                  onChange={(e) => set("phone", e.target.value)}
                />
              </FormField>
              <FormField label="Role">
                <select
                  className="select"
                  value={p.role}
                  onChange={(e) => set("role", e.target.value)}
                >
                  {["Administrator", "Manager", "Accountant", "Staff"].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          </div>
        </div>

        {/* Login Credentials */}
        <div className="card">
          <p className="font-medium text-ink">Login Credentials</p>
          <p className="text-sm text-brand-500 mt-0.5 mb-4">
            Manage your login email and connected methods
          </p>
          {cloudChecked && !cloudAccount && (
            <p className="text-sm text-brand-500 rounded-lg bg-muted px-3 py-2.5">
              This device isn't signed in to a Filey account yet, so there's no
              login email to manage. Sign in under Data &amp; Sync — it works in
              offline mode too, and is what enables sync, sharing and licensing.
            </p>
          )}
          {cloudAccount && (
            <>
              <label className="label">Login Email</label>
              <div className="flex gap-2 mb-3">
                <div className="input flex items-center justify-between">
                  <span className="truncate">{accountEmail}</span>
                  <Badge tone={verified ? "success" : "warn"}>
                    {verified ? "Verified" : "Unverified"}
                  </Badge>
                </div>
                <button
                  className="btn-ghost shrink-0"
                  onClick={changeEmail}
                  disabled={!!pending}
                >
                  Change Email
                </button>
              </div>

              {pending && (
                <div className="mb-4 rounded-lg border border-brand-200 dark:border-white/10 p-3">
                  <p className="text-sm font-medium text-ink">
                    Confirm the change to {pending.next}
                  </p>
                  <p className="text-xs text-brand-500 mt-0.5 mb-3">
                    We emailed a 6-digit code to your new address.
                  </p>
                  <div>
                    <FormField label={`Code sent to ${pending.next}`}>
                      <input
                        className="input"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="000000"
                        value={pending.nw}
                        onChange={(e) =>
                          setPending({
                            ...pending,
                            nw: e.target.value.replace(/\D/g, "").slice(0, 6),
                          })
                        }
                      />
                    </FormField>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      className="btn-primary"
                      onClick={confirmEmailChange}
                      disabled={emailBusy || pending.nw.length < 6}
                    >
                      {emailBusy ? "Confirming…" : "Confirm change"}
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => setPending(null)}
                      disabled={emailBusy}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          <label className="label">Username</label>
          <div className="flex gap-2 mb-4">
            <input
              className="input"
              placeholder="username"
              value={p.username}
              onChange={(e) => set("username", e.target.value)}
            />
            <button
              className="btn-ghost shrink-0"
              onClick={async () => {
                await updateProfile({ username: p.username });
                toast.success("Username saved.");
              }}
            >
              Change Username
            </button>
          </div>
          <p className="label">Connected Accounts</p>
          <p className="text-xs text-brand-400 mb-2">
            Connect your account with other services
          </p>
          {[
            { n: "Google", s: "OAuth not configured" },
            { n: "Apple", s: "OAuth not configured" },
          ].map((a) => (
            <div
              key={a.n}
              className="flex items-center justify-between rounded-xl border border-brand-200 px-3 py-2.5 mb-2"
            >
              <div>
                <p className="text-sm font-medium text-ink">{a.n}</p>
                <p className="text-[11px] text-brand-400">{a.s}</p>
              </div>
              <button
                className="btn-ghost text-xs"
                disabled
                title="Configure the provider in Supabase Auth to enable"
              >
                Connect
              </button>
            </div>
          ))}
        </div>

        {/* Preferences */}
        <div className="card">
          <p className="font-medium text-ink">Preferences</p>
          <p className="text-sm text-brand-500 mt-0.5 mb-4">
            Manage your language, timezone and other preferences
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Language">
              <select
                className="select"
                value={p.language}
                onChange={(e) => set("language", e.target.value)}
              >
                {["English (US)", "English (UK)", "Arabic", "Hindi"].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Timezone">
              <select
                className="select"
                value={p.timezone}
                onChange={(e) => set("timezone", e.target.value)}
              >
                {[
                  "(GMT+04:00) Dubai, UAE",
                  "(GMT+00:00) UTC",
                  "(GMT+05:30) India",
                  "(GMT+01:00) Central Europe",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Date Format">
              <select
                className="select"
                value={p.date_format}
                onChange={(e) => set("date_format", e.target.value)}
              >
                {["DD MMM, YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Time Format">
              <select
                className="select"
                value={p.time_format}
                onChange={(e) => set("time_format", e.target.value)}
              >
                {["12 Hour (02:30 PM)", "24 Hour (14:30)"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="flex items-center justify-end gap-3 mt-4">
            {savedPrefs && (
              <span className="text-sm font-medium text-success">Saved</span>
            )}
            <button
              className="btn-primary"
              onClick={async () => {
                try {
                  await updateProfile({
                    language: p.language,
                    timezone: p.timezone,
                    date_format: p.date_format,
                    time_format: p.time_format,
                  });
                  setSavedPrefs(true);
                  setTimeout(() => setSavedPrefs(false), 2500);
                  toast.success("Preferences saved.");
                } catch (e) {
                  toast.error(`Could not save: ${e instanceof Error ? e.message : e}`);
                }
              }}
            >
              Save Preferences
            </button>
          </div>
        </div>
      </div>

      {/* right column: Change Password (cloud auth only) */}
      {cloudAccount && (
      <div className="card xl:sticky xl:top-2">
        <p className="font-medium text-ink">Change Password</p>
        <p className="text-sm text-brand-500 mt-0.5 mb-4">
          Update your password to keep your account secure
        </p>
        <div className="space-y-3">
          <FormField label="Current Password">
            <PwInput
              val={cur}
              onChange={setCur}
              shown={show.c}
              toggle={() => setShow({ ...show, c: !show.c })}
            />
          </FormField>
          <FormField label="New Password">
            <PwInput
              val={npw}
              onChange={setNpw}
              shown={show.n}
              toggle={() => setShow({ ...show, n: !show.n })}
            />
          </FormField>
          <ul className="space-y-1.5">
            {PW_RULES.map((r) => {
              const ok = r.test(npw);
              return (
                <li
                  key={r.label}
                  className={`flex items-center gap-2 text-xs ${
                    ok ? "text-success" : "text-brand-400"
                  }`}
                >
                  <span
                    className={`grid place-items-center w-4 h-4 rounded-full ${
                      ok ? "bg-success text-white" : "bg-brand-200 text-white"
                    }`}
                  >
                    <Check size={10} strokeWidth={3} />
                  </span>
                  {r.label}
                </li>
              );
            })}
          </ul>
          <FormField label="Confirm New Password">
            <PwInput
              val={cpw}
              onChange={setCpw}
              shown={show.k}
              toggle={() => setShow({ ...show, k: !show.k })}
            />
          </FormField>
          {pwMsg && (
            <p
              className={`text-xs font-semibold rounded-lg px-3 py-2 ${
                pwMsg.ok ? "text-success bg-success/10" : "text-danger bg-danger/10"
              }`}
            >
              {pwMsg.t}
            </p>
          )}
          <button
            className="btn-primary w-full justify-center"
            disabled={pwBusy || !cur || !pwValid || npw !== cpw}
            onClick={updatePassword}
          >
            {pwBusy ? "Updating…" : "Update Password"}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
