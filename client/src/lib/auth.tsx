import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type User } from "./api";

type Status = "loading" | "signed-in" | "signed-out";

interface AuthState {
  user: User | null;
  status: Status;
  login: (identifier: string, password: string) => Promise<{ user: User; firstSignIn: boolean }>;
  register: (name: string, email: string, username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUserState] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  const setUser = useCallback((u: User | null) => {
    setUserState(u);
    setStatus(u ? "signed-in" : "signed-out");
  }, []);

  useEffect(() => {
    let alive = true;
    api.auth
      .me()
      .then(({ user }) => alive && setUser(user))
      .catch(() => alive && setUser(null));
    const onUnauthorized = () => setUser(null);
    window.addEventListener("themis:unauthorized", onUnauthorized);
    return () => {
      alive = false;
      window.removeEventListener("themis:unauthorized", onUnauthorized);
    };
  }, [setUser]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await api.auth.login({ email: identifier, password });
      setUser(res.user);
      return res;
    },
    [setUser],
  );

  // creates the account only; the user signs in next
  const register = useCallback(
    async (name: string, email: string, username: string, password: string) => (await api.auth.register({ name, email, username, password })).user,
    [],
  );

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    setUser(null);
  }, [setUser]);

  const value = useMemo(() => ({ user, status, login, register, logout, setUser }), [user, status, login, register, logout, setUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};
