import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { tools } from "./api";
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
  const [disabled, setDisabled] = useState<string[]>([]);
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

  const isEnabled = (id: string) => {
    const m = MODULES.find((x) => x.id === id);
    if (m?.core) return true;
    return !disabled.includes(id);
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
