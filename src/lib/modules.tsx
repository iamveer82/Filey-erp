import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { tools, org } from "./api";
import { useAuth } from "./auth";
import { isLocalMode } from "./dataMode";
import { MODULES, type AppModule } from "../modules/registry";

const KEY = "modules.disabled";

interface ModulesValue {
  loading: boolean;
  modules: AppModule[];
  isEnabled: (id: string) => boolean;
  enabledModules: () => AppModule[];
  toggle: (id: string) => void;
  /** Re-enable every non-core module at once (clears the disabled list). */
  enableAll: () => void;
}

const Ctx = createContext<ModulesValue | null>(null);

export function ModulesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [disabled, setDisabled] = useState<string[]>([]);
  // Allowed module ids for the current member (null = no restriction).
  // Owners/admins are never restricted.
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    tools
      .settings()
      .then((rows) => {
        const row = rows.find((r) => r.key === KEY);
        if (row?.value) {
          try {
            const arr = JSON.parse(row.value);
            if (Array.isArray(arr)) setDisabled(arr.map(String));
          } catch (e) {
            console.warn("Failed to parse disabled modules setting", e);
            /* ignore bad value */
          }
        }
      })
      .catch((e) => {
        console.error("Failed to load module settings:", e);
        return [];
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Local mode is single-user and on-device only: there is no org
    // membership to resolve, and the privacy promise is that nothing leaves
    // the machine — so never fire the cloud org_members/profiles queries
    // (they 401 without a cloud session anyway).
    if (!user?.id || isLocalMode()) {
      setAllowed(null);
      return;
    }
    org
      .members()
      .then((ms) => {
        const me = ms.find((m) => m.user_id === user.id);
        if (me && !["owner", "admin"].includes(me.role) && Array.isArray(me.modules)) {
          setAllowed(me.modules);
        } else {
          setAllowed(null);
        }
      })
      .catch(() => setAllowed(null));
  }, [user?.id]);

  const isEnabled = (id: string) => {
    const m = MODULES.find((x) => x.id === id);
    if (m?.core) return true;
    if (disabled.includes(id)) return false;
    // Member-level access restriction set by the org owner.
    if (allowed && !allowed.includes(id)) return false;
    return true;
  };

  const persist = (next: string[]) => {
    setDisabled(next);
    tools
      .setSetting(KEY, JSON.stringify(next))
      .catch((e) => console.error("Failed to persist module settings:", e));
  };

  const toggle = (id: string) => {
    const m = MODULES.find((x) => x.id === id);
    if (m?.core) return;
    persist(disabled.includes(id) ? disabled.filter((x) => x !== id) : [...disabled, id]);
  };

  const enableAll = () => persist([]);

  const value: ModulesValue = {
    loading,
    modules: MODULES,
    isEnabled,
    enabledModules: () => MODULES.filter((m) => isEnabled(m.id)),
    toggle,
    enableAll,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const defaultValue: ModulesValue = {
  loading: false,
  modules: MODULES,
  isEnabled: () => true,
  enabledModules: () => MODULES,
  toggle: () => {},
  enableAll: () => {},
};

export function useModules(): ModulesValue {
  return useContext(Ctx) ?? defaultValue;
}
