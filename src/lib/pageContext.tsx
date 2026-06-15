import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface PageContextValue {
  leafLabel: string | undefined;
  setLeafLabel: (label: string | undefined) => void;
}

const Ctx = createContext<PageContextValue>({
  leafLabel: undefined,
  setLeafLabel: () => {},
});

export function PageContextProvider({
  children,
  value,
}: {
  children: ReactNode;
  value?: PageContextValue;
}) {
  const [leafLabel, setLeafLabel] = useState<string | undefined>(value?.leafLabel);
  const set = useCallback((label: string | undefined) => setLeafLabel(label), []);
  return <Ctx.Provider value={{ leafLabel, setLeafLabel: set }}>{children}</Ctx.Provider>;
}

export function usePageLeaf() {
  return useContext(Ctx).setLeafLabel;
}

export function usePageLeafValue() {
  return useContext(Ctx).leafLabel;
}
