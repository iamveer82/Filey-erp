import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, isConfigured } from "./supabase";

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

  const loadProfile = async (u: User) => {
    if (!supabase) return;
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", u.id)
      .maybeSingle();
    setProfile((data as Profile) ?? null);
  };

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) await loadProfile(data.session.user);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) await loadProfile(s.user);
      else setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

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
    setProfile(null);
  };

  const createProfile = async (
    firstName: string,
    lastName: string,
    company: string
  ) => {
    if (!supabase || !user) throw new Error("Not signed in");
    const name = `${firstName.trim()} ${lastName.trim()}`.trim();
    const row = {
      id: user.id,
      email: user.email ?? "",
      name,
      company: company.trim(),
      org_id: "default",
    };
    const { data, error } = await supabase
      .from("profiles")
      .upsert(row)
      .select()
      .single();
    if (error) throw error;
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
    setProfile(data as Profile);
  };

  const value: AuthValue = {
    loading,
    configured: isConfigured,
    user,
    session,
    profile,
    needsProfile: !!user && !profile,
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
