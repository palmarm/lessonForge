"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  createWorkspaceNavigation,
  type LeaveState,
} from "@/lib/workspace-navigation";
import { protectBrowserNavigation } from "@/lib/browser-navigation";

type Navigation = ReturnType<typeof createWorkspaceNavigation> & {
  requestLeave: (purpose?: boolean | "discard") => boolean;
};
const Context = createContext<Navigation | null>(null);

export function WorkspaceNavigation({
  children,
}: {
  children: React.ReactNode;
}) {
  const [registry] = useState(createWorkspaceNavigation);
  const [message, setMessage] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const committedPath = useRef(pathname);
  const protection = useRef<ReturnType<typeof protectBrowserNavigation> | null>(
    null,
  );
  useLayoutEffect(() => {
    committedPath.current = pathname;
    protection.current?.synchronize();
  });
  const requestLeave = useCallback(
    (purpose: boolean | "discard" = false) => {
      const allowed = registry.allow((text) => window.confirm(text), purpose);
      setMessage(
        allowed
          ? null
          : registry.snapshot().blocked
            ? "Stay in this workspace until the pending or uncertain write is resolved. Use its explicit reconciliation controls; nothing was retried."
            : registry.snapshot().paused
              ? "Navigation is paused while your session is unconfirmed. Check session again."
              : "Stayed in the workspace. Your entered text is retained.",
      );
      return allowed;
    },
    [registry],
  );
  useEffect(() => {
    const browser = protectBrowserNavigation(
      () => requestLeave(),
      () => {
        const state = registry.snapshot();
        return state.dirty || state.blocked;
      },
      {
        pathname: () => committedPath.current,
        replace: (href) => router.replace(href, { scroll: false }),
      },
    );
    protection.current = browser;
    return () => {
      browser.dispose();
      protection.current = null;
    };
  }, [registry, requestLeave, router]);
  return (
    <Context.Provider value={{ ...registry, requestLeave }}>
      {message && (
        <p role="alert" className="feedback mx-5" data-navigation-notice>
          {message}
        </p>
      )}
      {children}
    </Context.Provider>
  );
}

export function useWorkspaceNavigation() {
  const value = useContext(Context);
  if (!value) throw new Error("WorkspaceNavigation is required.");
  return value;
}

export function useWorkspaceProtection(read: () => LeaveState) {
  const { register } = useWorkspaceNavigation();
  useLayoutEffect(() => register(read), [register, read]);
}
