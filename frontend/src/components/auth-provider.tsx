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
  endSession: () => void;
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

  useEffect(() => {
    if (!snapshot.identity) return;
    const expiresAt = Date.parse(snapshot.identity.expiresAt);
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) session.endSession();
      else timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    };
    check();
    // A background tab's timers can be throttled: recheck on return as well.
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [session, snapshot.identity]);

  return (
    <AuthContext.Provider
      value={{
        ...snapshot,
        login: session.login,
        logout: session.logout,
        restore: session.restore,
        endSession: session.endSession,
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
