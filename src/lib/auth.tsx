import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, isConfigured } from "./supabase";
import { isLocalMode } from "./dataMode";
import { setCacheOrg } from "./api";
import { startRealtime, stopRealtime } from "./realtime";
import { registerCloudDevice, entitlement } from "./license";
import {
  getLocalCredential,
  hasLocalCredential,
  isLocalSignedIn,
  rememberLocalCredential,
  setLocalSignedIn,
  updateLocalCredentialEmail,
  verifyLocalPassword,
} from "./localAuth";

// ---- Local mode: a single on-device user, no real authentication ----------
const LOCAL_PROFILE_KEY = "filey_local_profile";
const LOCAL_USER = {
  id: "local-user",
  email: "local@device",
  app_metadata: {},
  user_metadata: {},
  aud: "local",
  created_at: new Date().toISOString(),
} as unknown as User;

function loadLocalProfile(): Profile {
  try {
    const v = localStorage.getItem(LOCAL_PROFILE_KEY);
    if (v) return JSON.parse(v) as Profile;
  } catch {
    /* ignore */
  }
  return { id: LOCAL_USER.id, email: "", name: "You", company: "" };
}

/** The on-device user for an offline install, carrying the email of the account
 *  that claimed this device. Offline data is NOT keyed by user id — localdb is a
 *  flat per-device store — so attaching an account never moves or hides a row
 *  that was created before the device had one. */
function localUserFrom(cred: { email: string; userId: string } | null): User {
  if (!cred) return LOCAL_USER;
  return { ...LOCAL_USER, id: cred.userId || LOCAL_USER.id, email: cred.email } as User;
}
function saveLocalProfile(p: Profile): void {
  try {
    localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export type Channel = "email" | "phone";

export interface Credential {
  channel: Channel;
  /** Email address, or phone number in E.164 form (e.g. +9715XXXXXXXX). */
  value: string;
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  company: string;
  org_id?: string;
  phone?: string;
  role?: string;
  username?: string;
  avatar?: string;
  language?: string;
  timezone?: string;
  date_format?: string;
  time_format?: string;
  created_at?: string;
  updated_at?: string;
}

interface AuthValue {
  loading: boolean;
  configured: boolean;
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  needsProfile: boolean;
  /** True while we're still fetching the signed-in user's profile. */
  profileLoading: boolean;
  /** Message when the profile READ failed. Never means "no profile". */
  profileError: string | null;
  /** Retry a failed profile read. */
  reloadProfile: () => Promise<void>;
  signInWithPassword: (c: Credential, password: string) => Promise<void>;
  /** Google OAuth (web only — embedded webviews are blocked by Google). */
  signInWithGoogle: () => Promise<void>;
  /** True when the org is at its cloud device limit and THIS device was
   *  refused a slot. UI gates on this only when licensing is enforced. */
  deviceLimitBlocked: boolean;
  /** Re-attempt device registration (after the user released a slot). */
  retryDeviceRegistration: () => Promise<void>;
  /** Returns needsOtp=false when Supabase confirmation is disabled (instant session). */
  signUpWithPassword: (c: Credential, password: string) => Promise<{ needsOtp: boolean }>;
  /** Passwordless: sends a login code to an existing account. */
  sendLoginOtp: (c: Credential) => Promise<void>;
  verifyOtp: (c: Credential, token: string, purpose: "signup" | "login") => Promise<void>;
  resendOtp: (c: Credential, purpose: "signup" | "login") => Promise<void>;
  signOut: () => Promise<void>;
  createProfile: (firstName: string, lastName: string, company: string) => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

/** Supabase's email-enumeration guard: signing up an address that already
 *  exists returns a decoy user with no identities instead of an error. */
// eslint-disable-next-line react-refresh/only-export-components
export const isExistingAccount = (u: { identities?: unknown[] | null } | null) =>
  !!u && u.identities?.length === 0;

/** The signup trigger pre-creates a profile row named 'User' with no company,
 *  so a plain `!profile` check never fires and first-run setup never showed —
 *  every cloud signup landed in the app as "User". Treat that untouched stub
 *  as "still needs setup"; anything the user actually filled in counts as real. */
// eslint-disable-next-line react-refresh/only-export-components
export const isProfileStub = (p: Pick<Profile, "name" | "company"> | null) =>
  !!p && !p.company?.trim() && (!p.name?.trim() || p.name === "User");

const norm = (c: Credential) =>
  c.channel === "email"
    ? { email: c.value.trim().toLowerCase() }
    : { phone: c.value.trim() };

export function AuthProvider({ children }: { children: ReactNode }) {
  const local = isLocalMode();
  const [loading, setLoading] = useState(!local);
  // Offline installs require a real email account too. The device is only
  // "signed in" once an account has claimed it AND the session flag is set, so
  // signing out offline returns to the login screens like anywhere else.
  const [user, setUser] = useState<User | null>(
    local && hasLocalCredential() && isLocalSignedIn()
      ? localUserFrom(getLocalCredential())
      : null
  );
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(
    local ? loadLocalProfile() : null
  );
  // Whether we've actually finished checking for a profile for the current
  // user. Until then we must NOT treat a missing profile as "needs setup"
  // (that briefly flashes the profile form right after sign-in).
  const [profileLoaded, setProfileLoaded] = useState(local);
  /** Set when the profile READ failed. Distinct from "no profile exists" —
   *  the first must never be mistaken for the second (see loadProfile). */
  const [profileError, setProfileError] = useState<string | null>(null);
  // The user id whose profile is currently loaded — lets us ignore token
  // refreshes (tab focus) that would otherwise re-trigger the loading screen.
  const loadedFor = useRef<string | null>(null);

  const loadProfile = async (u: User) => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", u.id)
      .maybeSingle();
    // A read that FAILED is not evidence the profile is missing. This used to
    // ignore `error` and set profileLoaded in a finally, so one network blip or
    // RLS hiccup on sign-in made needsProfile true and dropped an existing user
    // into first-run setup — where finishing the form upserts over the real
    // name and company. Surface the failure and let the user retry instead.
    if (error) throw error;
    const prof = (data as Profile) ?? null;
    setCacheOrg(prof?.org_id);
    setProfile(prof);
    setProfileError(null);
    setProfileLoaded(true);
  };

  useEffect(() => {
    if (local) return; // no Supabase auth in local mode — synthetic user
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setUser(data.session?.user ?? null);
        // Defer DB read: never block while the auth lock may be held.
        if (data.session?.user) {
          loadedFor.current = data.session.user.id;
          void loadProfile(data.session.user).catch((err) => {
            console.error("[auth] loadProfile failed:", err);
            setProfileError(err?.message ?? String(err));
          });
        }
      })
      .catch((err) => {
        console.error("[auth] getSession failed:", err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    // IMPORTANT: callback is sync and does NO awaited Supabase calls here.
    // Calling supabase.* inside onAuthStateChange while it holds the auth
    // lock deadlocks getSession(). Defer profile load off the lock.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        // Only (re)load the profile on a real sign-in / user switch. Token
        // refreshes fire when the tab regains focus but keep the same user id
        // — skip them, otherwise the loading screen flashes on every tab change.
        if (loadedFor.current === s.user.id) return;
        loadedFor.current = s.user.id;
        const u = s.user;
        setProfileLoaded(false);
        setTimeout(() => {
          if (active)
            void loadProfile(u).catch((err) => {
              console.error("[auth] loadProfile failed:", err);
              setProfileError(err?.message ?? String(err));
            });
        }, 0);
      } else {
        loadedFor.current = null;
        setCacheOrg(null);
        setProfile(null);
        setProfileLoaded(false);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Live multi-client sync follows the session: open the channel once
  // signed in, close it on sign-out so the next user starts clean.
  useEffect(() => {
    if (local) return; // local mode is single-user, no live sync
    if (session?.user) void startRealtime();
    else stopRealtime();
  }, [session]);

  // Cloud device registry (5 per org): claim/refresh this device's slot on
  // session start. Best-effort — a network blip must not lock the app.
  const [deviceLimitBlocked, setDeviceLimitBlocked] = useState(false);
  const retryDeviceRegistration = async () => {
    try {
      const r = await registerCloudDevice();
      setDeviceLimitBlocked(!r.ok && r.reason === "limit");
    } catch {
      /* keep previous state */
    }
  };
  useEffect(() => {
    if (!session?.user || local) return;
    void retryDeviceRegistration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // Warm the tier cache (free/lite/pro) so render paths can read it
  // synchronously via currentTier(). Local mode resolves immediately.
  useEffect(() => {
    void entitlement(true).catch(() => {});
  }, [session?.user?.id, local]);

  const signInWithPassword = async (c: Credential, password: string) => {
    const email = c.value.trim().toLowerCase();
    if (local) {
      // Prefer the server so the password stays authoritative and the cached
      // hash is refreshed. Fall back to the device only when the server can't
      // be reached — an offline install must not be locked out of its own data
      // just because there's no connection right now.
      const online = typeof navigator === "undefined" || navigator.onLine;
      if (online && supabase) {
        try {
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          } as any);
          if (error) throw error;
          const uid = data.user?.id;
          if (uid) await rememberLocalCredential(email, uid, password);
          setLocalSignedIn(true);
          setUser(localUserFrom({ email, userId: uid ?? "" }));
          setProfile(loadLocalProfile());
          return;
        } catch (e: any) {
          // In local mode the device's own credential is authoritative.
          // If Supabase rejects (expired session, changed password, etc.),
          // fall through to the local hash instead of locking the user out.
          const msg = e?.message ?? String(e);
          if (/invalid login credentials|invalid email or password/i.test(msg)) {
            if (!hasLocalCredential()) throw e;
            // Fall through to local verification below
          } else if (!hasLocalCredential()) {
            throw e;
          }
          // Otherwise the server was unreachable: fall through to the device.
        }
      }
      if (!hasLocalCredential())
        throw new Error(
          "This device isn't linked to a Filey account yet. Connect to the internet once to sign in or create one."
        );
      if (!(await verifyLocalPassword(email, password)))
        throw new Error("That email and password don't match this device's account.");
      setLocalSignedIn(true);
      setUser(localUserFrom(getLocalCredential()));
      setProfile(loadLocalProfile());
      return;
    }
    if (!supabase) throw new Error("Supabase not configured");
    const { data, error } = await supabase.auth.signInWithPassword({
      ...norm(c),
      password,
    } as any);
    if (error) throw error;
    // Remember the identity even in cloud mode: the user may switch this
    // device to offline later, and it must already know whose device it is.
    if (data.user?.id && c.channel === "email")
      await rememberLocalCredential(email, data.user.id, password);
  };

  const signInWithGoogle = async () => {
    if (!supabase) throw new Error("Supabase not configured");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  };

  const signUpWithPassword = async (c: Credential, password: string) => {
    if (!supabase) throw new Error("Supabase not configured");
    // Must match Supabase's password_min_length, or the server rejects with a
    // raw "weak_password" error after the form has already accepted it.
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");
    const { data, error } = await supabase.auth.signUp({
      ...norm(c),
      password,
    } as any);
    if (error) throw error;
    // Signing up an address that already exists returns a decoy user with an
    // empty identities array (Supabase's enumeration guard) and no session.
    // Without this check the UI parks the user on the OTP screen forever.
    if (isExistingAccount(data.user))
      throw new Error("An account with this email already exists. Sign in instead.");
    // Claim this device for the new account so an offline install can sign in
    // again without a connection.
    if (data.user?.id && c.channel === "email")
      await rememberLocalCredential(c.value, data.user.id, password);
    if (local && data.session) {
      setLocalSignedIn(true);
      setUser(localUserFrom({ email: c.value.trim().toLowerCase(), userId: data.user!.id }));
      setProfile(loadLocalProfile());
    }
    // A session here means email confirmation is disabled → straight in.
    // Otherwise an OTP (email code / SMS) was sent and must be verified.
    return { needsOtp: !data.session };
  };

  const sendLoginOtp = async (c: Credential) => {
    if (!supabase) throw new Error("Supabase not configured");
    const { error } = await supabase.auth.signInWithOtp({
      ...norm(c),
      options: { shouldCreateUser: false },
    } as any);
    if (error) throw error;
  };

  const verifyOtp = async (c: Credential, token: string, purpose: "signup" | "login") => {
    if (!supabase) throw new Error("Supabase not configured");
    // For email login: verify the 6-digit numeric OTP with type "email".
    // "magiclink" is for full magic-link tokens, not numeric codes.
    const type =
      c.channel === "phone" ? "sms" : purpose === "signup" ? "signup" : "email";
    const { data, error } = await supabase.auth.verifyOtp({
      ...norm(c),
      token: token.trim(),
      type,
    } as any);
    if (error) throw error;
    if (local) {
      // Local mode doesn't follow the cloud session — the verified code IS
      // the sign-in. Mark the device signed in for the account behind it.
      const uid =
        data?.user?.id ??
        data?.session?.user?.id ??
        getLocalCredential()?.userId ??
        "";
      updateLocalCredentialEmail(c.value);
      setLocalSignedIn(true);
      setUser(localUserFrom({ email: c.value.trim().toLowerCase(), userId: uid }));
      setProfile(loadLocalProfile());
    }
  };

  const resendOtp = async (c: Credential, purpose: "signup" | "login") => {
    if (!supabase) throw new Error("Supabase not configured");
    if (purpose === "login") {
      await sendLoginOtp(c);
      return;
    }
    const { error } = await supabase.auth.resend({
      ...norm(c),
      type: c.channel === "phone" ? "sms" : "signup",
    } as any);
    if (error) throw error;
  };

  const signOut = async () => {
    if (local) {
      // End the on-device session and return to the login screens, same as
      // cloud. The remembered credential SURVIVES so they can sign back in
      // without a connection, and the on-device profile and data are untouched
      // — signing out is not a request to erase the company's books.
      setLocalSignedIn(false);
      setUser(null);
      setSession(null);
      setCacheOrg(null);
      return;
    }
    if (!supabase) return;
    await supabase.auth.signOut();
    setCacheOrg(null);
    // In offline mode the profile is the ON-DEVICE one and has nothing to do
    // with the cloud session being ended. Clearing it left a truthy synthetic
    // user with a null profile, so needsProfile flipped true and dumped the
    // user back into first-run setup — and createProfile() there overwrites
    // the stored local profile, wiping the name and company they had. Signing
    // out of the cloud must not touch on-device data.
    if (!local) setProfile(null);
  };

  const createProfile = async (firstName: string, lastName: string, company: string) => {
    if (local) {
      const np: Profile = {
        // Merge onto what is actually STORED, not onto possibly-empty state:
        // falling back to a bare object here discarded every other saved field.
        ...loadLocalProfile(),
        ...(profile ?? {}),
        name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        company: company.trim(),
      };
      saveLocalProfile(np);
      setProfile(np);
      return;
    }
    if (!supabase || !user) throw new Error("Not signed in");
    const name = `${firstName.trim()} ${lastName.trim()}`.trim();
    // org_id is provisioned by the signup trigger — do NOT set it here,
    // or the upsert would clobber the user's organization.
    const row = {
      id: user.id,
      email: user.email ?? "",
      name,
      company: company.trim(),
    };
    const { data, error } = await supabase.from("profiles").upsert(row).select().single();
    if (error) throw error;
    setCacheOrg((data as Profile).org_id);
    setProfile(data as Profile);
  };

  const updateProfile = async (patch: Partial<Profile>) => {
    if (local) {
      const np = { ...(profile ?? { id: LOCAL_USER.id, email: "", name: "", company: "" }), ...patch } as Profile;
      saveLocalProfile(np);
      setProfile(np);
      return;
    }
    if (!supabase || !user) return;
    const { data, error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", user.id)
      .select()
      .single();
    if (error) throw error;
    setCacheOrg((data as Profile).org_id);
    setProfile(data as Profile);
  };

  const value: AuthValue = {
    loading,
    configured: isConfigured,
    user,
    session,
    profile,
    // Only ever true once the profile was actually READ. A failed read leaves
    // profileLoaded false, so this stays false and the user is not offered
    // first-run setup on the strength of a network error.
    needsProfile: !!user && profileLoaded && (!profile || isProfileStub(profile)),
    profileLoading: !!user && !profileLoaded && !profileError,
    profileError,
    reloadProfile: async () => {
      if (!user) return;
      setProfileError(null);
      try {
        await loadProfile(user);
      } catch (err: any) {
        setProfileError(err?.message ?? String(err));
      }
    },
    signInWithPassword,
    signInWithGoogle,
    deviceLimitBlocked,
    retryDeviceRegistration,
    signUpWithPassword,
    sendLoginOtp,
    verifyOtp,
    resendOtp,
    signOut,
    createProfile,
    updateProfile,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
