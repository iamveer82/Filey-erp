import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import ar from "./locales/ar";

export type Lang = "en" | "ar" | "hi";

const CATALOGS: Partial<Record<Lang, Record<string, string>>> = { ar };

export const LANGS: Record<
  Lang,
  { name: string; native: string; short: string; flag: string; rtl?: boolean }
> = {
  en: { name: "English", native: "English", short: "EN", flag: "gb" },
  ar: { name: "Arabic", native: "العربية", short: "AR", flag: "ae", rtl: true },
  hi: { name: "Hindi", native: "हिन्दी", short: "HI", flag: "in" },
};

interface LangValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Translate an English source string to the active language. Falls back to
   *  the source string when no translation exists yet. */
  t: (s: string) => string;
}

const Ctx = createContext<LangValue | null>(null);

/** App language. Persists the choice, sets <html lang> and switches the
 *  document to RTL for Arabic. Full string translation rolls out
 *  incrementally; the direction + locale flip applies immediately. */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const s = localStorage.getItem("lang");
    return s === "ar" || s === "hi" || s === "en" ? s : "en";
  });

  useEffect(() => {
    const meta = LANGS[lang];
    document.documentElement.lang = lang;
    document.documentElement.dir = meta.rtl ? "rtl" : "ltr";
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("lang", l);
    } catch {
      /* ignore */
    }
  };

  const t = (s: string) => CATALOGS[lang]?.[s] ?? s;

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useLang(): LangValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLang must be used within LanguageProvider");
  return c;
}

/** Convenience hook for components that only need the translate function. */
export function useT(): (s: string) => string {
  return useLang().t;
}
