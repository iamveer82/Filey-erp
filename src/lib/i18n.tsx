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
    try {
      localStorage.setItem("lang", l);
    } catch {
      /* ignore */
    }
    // Reload so the auto-translate pass runs cleanly from a fresh English DOM
    // (and switching back to English simply doesn't translate).
    if (l !== lang) {
      window.location.reload();
      return;
    }
    setLangState(l);
  };

  const t = (s: string) => CATALOGS[lang]?.[s] ?? s;

  // Auto-apply the catalog across the whole app: translate any text node whose
  // trimmed content exactly matches a catalog key. Exact-match only, so dynamic
  // data (names, numbers, codes) is never touched. Skips inputs/code/editable
  // and anything marked [data-no-i18n]. Covers every page without wrapping each
  // string by hand; explicit t() (PageHeader etc.) still works alongside it.
  useEffect(() => {
    const cat = CATALOGS[lang];
    if (!cat) return;

    const SKIP = "input,textarea,select,code,pre,script,style,svg,[contenteditable=true],[data-no-i18n]";
    const apply = (root: Node) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          const p = (n as Text).parentElement;
          if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
          const key = n.nodeValue?.trim();
          return key && cat[key] ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      for (const n of nodes) {
        const raw = n.nodeValue!;
        const key = raw.trim();
        n.nodeValue = raw.replace(key, cat[key]);
      }
    };

    apply(document.body);
    // Re-translate content React (re)renders — modals, route changes, lists.
    let queued = false;
    const obs = new MutationObserver((muts) => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        for (const m of muts) m.addedNodes.forEach((n) => apply(n));
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [lang]);

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
