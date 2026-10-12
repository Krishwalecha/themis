import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { storage } from "./storage";
import type { Environment } from "./types";

interface EnvironmentState {
  environments: Environment[];
  active: Environment | null;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  refresh: () => Promise<void>;
  loaded: boolean;
}

const EnvironmentContext = createContext<EnvironmentState | null>(null);
const ACTIVE_KEY = "themis.activeEnvironment";

// Guests have no environments: the same editors work, with no variables to offer
const NO_ENVIRONMENTS: EnvironmentState = { environments: [], active: null, activeId: null, setActiveId: () => {}, refresh: async () => {}, loaded: true };
export const GuestEnvironments = ({ children }: { children: ReactNode }) => (
  <EnvironmentContext.Provider value={NO_ENVIRONMENTS}>{children}</EnvironmentContext.Provider>
);

export const EnvironmentProvider = ({ children }: { children: ReactNode }) => {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(() => storage.get(ACTIVE_KEY));
  const [loaded, setLoaded] = useState(false);

  const setActiveId = useCallback((id: string | null) => {
    setActiveIdState(id);
    if (id) storage.set(ACTIVE_KEY, id);
    else storage.remove(ACTIVE_KEY);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { items } = await api.environments.list();
      setEnvironments(items);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = environments.find((e) => e._id === activeId) ?? null;

  // Forget a remembered environment that no longer exists.
  useEffect(() => {
    if (loaded && activeId && !active) setActiveId(null);
  }, [loaded, activeId, active, setActiveId]);

  const value = useMemo(
    () => ({ environments, active, activeId: active?._id ?? null, setActiveId, refresh, loaded }),
    [environments, active, setActiveId, refresh, loaded],
  );
  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>;
};

export const useEnvironments = (): EnvironmentState => {
  const ctx = useContext(EnvironmentContext);
  if (!ctx) throw new Error("useEnvironments must be used inside EnvironmentProvider");
  return ctx;
};

const VARIABLE = /\{\{\s*([A-Za-z0-9_.\-]+)\s*\}\}/g;

// Variable names referenced in the given strings
export const referencedVariables = (...texts: string[]): string[] => {
  const names = new Set<string>();
  for (const text of texts) for (const m of text.matchAll(VARIABLE)) names.add(m[1]);
  return [...names];
};

// options for an environment picker, with "No environment" first
export const environmentOptions = (environments: { _id: string; name: string }[]) => [
  { value: "", label: "No environment" },
  ...environments.map((e) => ({ value: e._id, label: e.name })),
];
