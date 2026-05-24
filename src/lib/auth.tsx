import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, isConfigured } from "./supabase";
import { setCacheOrg } from "./api";
import { startRealtime, stopRealtime } from "./realtime";

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
  signInWithPassword: (c: Credential, password: string) => Promise<void>;
  /** Returns needsOtp=false when Supabase confirmation is disabled (instant session). */
  signUpWithPassword: (
    c: Credential,
    password: string
  ) => Promise<{ needsOtp: boolean }>;
  /** Passwordless: sends a login code to an existing account. */
  sendLoginOtp: (c: Credential) => Promise<void>;
  verifyOtp: (
    c: Credential,
    token: string,
    purpose: "signup" | "login"
  ) => Promise<void>;
  resendOtp: (c: Credential, purpose: "signup" | "login") => Promise<void>;
  signOut: () => Promise<void>;
  createProfile: (
    firstName: string,
    lastName: string,
    company: string
  ) => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

const norm = (c: Credential) =>
  c.channel === "email"
    ? { email: c.value.trim().toLowerCase() }
    : { phone: c.value.trim() };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // Whether we've actually finished checking for a profile for the current
  // user. Until then we must NOT treat a missing profile as "needs setup"
  // (that briefly flashes the profile form right after sign-in).
  const [profileLoaded, setProfileLoaded] = useState(false);

  const loadProfile = async (u: User) => {
    if (!supabase) return;
    try {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", u.id)
        .maybeSingle();
      const prof = (data as Profile) ?? null;
      setCacheOrg(prof?.org_id);
      setProfile(prof);
    } finally {
      setProfileLoaded(true);
    }
  };

  useEffect(() => {
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
        if (data.session?.user) void loadProfile(data.session.user);
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
        const u = s.user;
        setProfileLoaded(false);
        setTimeout(() => {
          if (active) void loadProfile(u);
        }, 0);
      } else {
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
    if (session?.user) void startRealtime();
    else stopRealtime();
  }, [session]);

  const signInWithPassword = async (c: Credential, password: string) => {
    if (!supabase) throw new Error("Supabase not configured");
    const { error } = await supabase.auth.signInWithPassword({
      ...norm(c),
      password,
    } as any);
    if (error) throw error;
  };

  const signUpWithPassword = async (c: Credential, password: string) => {
    if (!supabase) throw new Error("Supabase not configured");
    if (password.length < 6)
      throw new Error("Password must be at least 6 characters.");
    const { data, error } = await supabase.auth.signUp({
      ...norm(c),
      password,
    } as any);
    if (error) throw error;
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

  const verifyOtp = async (
    c: Credential,
    token: string,
    purpose: "signup" | "login"
  ) => {
    if (!supabase) throw new Error("Supabase not configured");
    const type =
      c.channel === "phone"
        ? "sms"
        : purpose === "signup"
        ? "signup"
        : "email";
    const { error } = await supabase.auth.verifyOtp({
      ...norm(c),
      token: token.trim(),
      type,
    } as any);
    if (error) throw error;
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
    if (!supabase) return;
    await supabase.auth.signOut();
    setCacheOrg(null);
    setProfile(null);
  };

  const createProfile = async (
    firstName: string,
    lastName: string,
    company: string
  ) => {
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
    const { data, error } = await supabase
      .from("profiles")
      .upsert(row)
      .select()
      .single();
    if (error) throw error;
    setCacheOrg((data as Profile).org_id);
    setProfile(data as Profile);
  };

  const updateProfile = async (patch: Partial<Profile>) => {
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
    needsProfile: !!user && profileLoaded && !profile,
    profileLoading: !!user && !profileLoaded,
    signInWithPassword,
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
