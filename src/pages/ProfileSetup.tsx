import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, Building2, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "../components/Button";
import { useAuth } from "../lib/auth";

// ProfileSetup is the first-run screen users see after sign-up.
// The base form takes first / last / company. SMS verification is
// disabled until a real SMS provider is configured, so we skip the
// phone step and mark setup as complete.

export default function ProfileSetup() {
  const { createProfile } = useAuth();
  const nav = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submitBase = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!firstName.trim() || !lastName.trim()) {
      setErr("First and last name are required.");
      return;
    }
    setBusy(true);
    try {
      await createProfile(firstName, lastName, company);
      setDone(true);
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen grid place-items-center p-6 bg-canvas">
        <div className="card max-w-sm w-full text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 grid place-items-center">
            <ShieldCheck size={26} />
          </div>
          <h1 className="text-xl font-display">You're all set</h1>
          <p className="text-sm text-brand-400">{company || "Your workspace"} is ready.</p>
          <Button onClick={() => nav("/overview-modern")}>
            Go to dashboard <ArrowRight size={16} />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-canvas">
      <div className="card max-w-sm w-full space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 grid place-items-center">
            <Building2 size={20} />
          </div>
          <div>
            <h1 className="text-lg font-display">Set up your workspace</h1>
            <p className="text-sm text-brand-400">Tell us a little about your business.</p>
          </div>
        </div>

        <form onSubmit={submitBase} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">First name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                className="input"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Last name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                className="input"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Company name</label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="input"
            />
          </div>
          {err && <p className="text-sm text-danger">{err}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? <Loader2 size={16} className="animate-spin" /> : "Continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}
