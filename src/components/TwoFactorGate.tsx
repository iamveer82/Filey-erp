// The second step of sign-in. Shown when a password (or an emailed code) has
// produced a real session that still sits at assurance level aal1 because the
// account has an authenticator app enrolled.
//
// Backing out signs the session OUT rather than returning to the app: an
// unsatisfied session is exactly what 2FA exists to refuse, and leaving it
// alive on the device would make the whole step decorative.
import { useEffect, useState } from "react";
import { Loader2, AlertCircle, ShieldCheck } from "lucide-react";
import Logo from "./Logo";
import { FormField } from "./ui";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "./InputOTP";
import { useAuth } from "../lib/auth";
import { mfaFactor, mfaVerify } from "../lib/mfa";

const CTA =
  "flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500 text-sm font-semibold text-[#1A1206] transition-all duration-200 hover:brightness-105 active:scale-[0.98] disabled:opacity-60 disabled:hover:brightness-100";

export default function TwoFactorGate() {
  const { signOut, refreshMfaPending } = useAuth();
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const f = await mfaFactor();
        // No readable factor but the session says a code is owed: the account
        // is in a state this screen can't resolve. Sign out rather than
        // stranding the user on a prompt nothing can satisfy.
        if (!f) return void signOut();
        setFactorId(f.id);
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await mfaVerify(factorId, code);
      await refreshMfaPending();
    } catch (e2: any) {
      setErr(
        /invalid|incorrect/i.test(e2?.message ?? "")
          ? "That code didn't match. Try the next one your app shows."
          : (e2?.message ?? String(e2))
      );
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full bg-canvas grid place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-6">
          <Logo size={44} />
          <h1 className="mt-4 text-xl font-semibold text-ink">Two-step verification</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter the 6-digit code from your authenticator app.
          </p>
        </div>

        <div className="card">
          <form onSubmit={submit} className="space-y-4">
            <FormField label="6-digit code" required>
              <InputOTP
                maxLength={6}
                value={code}
                onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </FormField>

            {err && (
              <p className="flex items-start gap-1.5 text-xs font-medium text-danger bg-danger/10 rounded-xl px-3 py-2">
                <AlertCircle size={13} className="shrink-0 mt-px" />
                <span>{err}</span>
              </p>
            )}

            <button className={CTA} disabled={busy || code.length < 6 || !factorId}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {busy ? "Verifying…" : "Verify"}
            </button>
          </form>
        </div>

        <button
          type="button"
          className="mt-4 w-full text-center text-xs text-brand-500 cursor-pointer"
          onClick={() => void signOut()}
        >
          Sign in as someone else
        </button>
      </div>
    </div>
  );
}
