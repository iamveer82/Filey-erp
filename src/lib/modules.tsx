import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { tools, getCacheScope } from "./api";
import { useAuth } from "./auth";
import { getDataMode } from "./dataMode";
import { MODULES, type AppModule } from "../modules/registry";

import { canUseModule, loadModuleAccess, type ModuleAccess } from "./moduleAccess";

const KEY = "modules.disabled";

interface ModulesValue {
  loading: boolean;
  error: string;
  retry: () => void;
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
  const [access, setAccess] = useState<ModuleAccess | null>(null);
  const [accessWorkspace, setAccessWorkspace] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [generation, retry] = useState(0);
  const workspaceKey = () => String(getDataMode()) + ":" + String(getCacheScope());
  const [workspace, setWorkspace] = useState(workspaceKey);
  useEffect(() => {
    const changed = () => setWorkspace(workspaceKey());
    const refresh = () => retry(n => n+1);
    window.addEventListener("filey:agent-storage", changed);
    window.addEventListener("filey:workspace-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("filey:agent-storage", changed);
      window.removeEventListener("filey:workspace-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => {
    let active = true;
    // Keep the current screen/form mounted during a same-workspace recheck.
    // Server reads and writes still enforce permissions; failure clears access.
    setError("");
    void (async () => {
      const [permissions, rows] = await Promise.all([loadModuleAccess(), tools.settings()]);
      const raw = rows.find(row => row.key === KEY)?.value;
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) throw new Error("Module settings could not be read.");
      if (active && workspace === workspaceKey()) {
        setAccess(permissions); setAccessWorkspace(workspace); setDisabled(parsed.map(String));
      }
    })().catch(error => {
      if (active) {
        setAccess(null); setDisabled([]);
        setError(error instanceof Error ? error.message : "Workspace permissions could not be loaded.");
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, workspace, generation]);

  const isEnabled = (id: string) => {
    if (accessWorkspace !== workspaceKey() || !access || !canUseModule(access,id)) return false;
    return !!MODULES.find(module => module.id === id)?.core || !disabled.includes(id);
  };

  const persist = (prev: string[], next: string[]) => {
    if (!access?.admin) { setError("Only an administrator can change workspace modules."); return; }
    setDisabled(next);
    tools
      .setSetting(KEY, JSON.stringify(next))
      .catch((e) => {
        // Rollback on failure so the toggle doesn't lie about what was saved.
        console.error("Failed to persist module settings:", e);
        setDisabled(prev);
      });
  };

  const toggle = (id: string) => {
    const m = MODULES.find((x) => x.id === id);
    if (m?.core) return;
    const next = disabled.includes(id)
      ? disabled.filter((x) => x !== id)
      : [...disabled, id];
    persist(disabled, next);
  };

  const enableAll = () => persist(disabled, []);

  const value: ModulesValue = {
    loading,
    error,
    retry: () => retry(n => n+1),
    modules: MODULES,
    isEnabled,
    enabledModules: () => MODULES.filter((m) => isEnabled(m.id)),
    toggle,
    enableAll,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const defaultValue: ModulesValue = {
  loading: true,
  error: "",
  retry: () => {},
  modules: MODULES,
  isEnabled: () => false,
  enabledModules: () => [],
  toggle: () => {},
  enableAll: () => {},
};

export function useModules(): ModulesValue {
  return useContext(Ctx) ?? defaultValue;
}
