import { useState } from "react";
import { UserRound } from "lucide-react";
import { useAuth } from "../lib/auth";

export default function ProfileSetup() {
  const { createProfile, signOut, user } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await createProfile(firstName, lastName, company);
    } catch (e2: any) {
      setErr(e2?.message ?? String(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full grid place-items-center bg-brand-50 p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="rounded-2xl bg-ink p-3 text-white">
            <UserRound size={26} />
          </div>
          <h1 className="text-2xl font-extrabold text-ink mt-4">
            Set up your profile
          </h1>
          <p className="text-sm text-brand-400">{user?.email}</p>
        </div>

        <form onSubmit={submit} className="bento-card space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="firstName">
                First name
              </label>
              <input
                id="firstName"
                className="input"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="lastName">
                Last name
              </label>
              <input
                id="lastName"
                className="input"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="company">
              Company
            </label>
            <input
              id="company"
              className="input"
              autoComplete="organization"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              required
            />
          </div>

          {err && (
            <p className="text-xs font-semibold text-ink bg-brand-200 rounded-lg px-3 py-2">
              {err}
            </p>
          )}

          <button
            className="btn-primary w-full justify-center"
            disabled={busy}
          >
            {busy ? "Saving…" : "Continue"}
          </button>
          <button
            type="button"
            className="text-xs font-semibold text-brand-500 hover:text-ink w-full text-center cursor-pointer"
            onClick={signOut}
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
