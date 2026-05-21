import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { tools, org } from "./api";
import { useAuth } from "./auth";
import { MODULES, type AppModule } from "../modules/registry";

const KEY = "modules.disabled";

interface ModulesValue {
  loading: boolean;
  modules: AppModule[];
  isEnabled: (id: string) => boolean;
  enabledModules: () => AppModule[];
  toggle: (id: string) => void;
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
          } catch {
            /* ignore bad value */
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setAllowed(null);
      return;
    }
    org
      .members()
      .then((ms) => {
        const me = ms.find((m) => m.user_id === user.id);
        if (
          me &&
          !["owner", "admin"].includes(me.role) &&
          Array.isArray(me.modules)
        ) {
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
    tools.setSetting(KEY, JSON.stringify(next)).catch(() => {});
  };

  const toggle = (id: string) => {
    const m = MODULES.find((x) => x.id === id);
    if (m?.core) return;
    persist(
      disabled.includes(id)
        ? disabled.filter((x) => x !== id)
        : [...disabled, id]
    );
  };

  const value: ModulesValue = {
    loading,
    modules: MODULES,
    isEnabled,
    enabledModules: () => MODULES.filter((m) => isEnabled(m.id)),
    toggle,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useModules(): ModulesValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("useModules must be used within ModulesProvider");
  return c;
}
