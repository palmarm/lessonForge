"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { createAuthApi } from "@/lib/auth-api";
import { createAuthSession, initialAuthSnapshot } from "@/lib/auth-session";
import type { AuthSnapshot } from "@/lib/auth-session";

type AuthContextValue = AuthSnapshot & {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session] = useState(() =>
    createAuthSession(createAuthApi(process.env.NEXT_PUBLIC_API_BASE_URL)),
  );
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    () => initialAuthSnapshot,
  );

  useEffect(() => {
    void session.restore();
    return session.invalidate;
  }, [session]);

  return (
    <AuthContext.Provider
      value={{
        ...snapshot,
        login: session.login,
        logout: session.logout,
        restore: session.restore,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth requires AuthProvider.");
  return context;
}
