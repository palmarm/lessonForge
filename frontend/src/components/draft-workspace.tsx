"use client";

import { createContext, useContext, useLayoutEffect, useState } from "react";
import { useAuth } from "./auth-provider";
import { createLessonsApi } from "@/lib/lessons-api";
import { createLessonsState } from "@/lib/lessons-state";
import { createResourcesApi } from "@/lib/resources-api";

const Context = createContext<ReturnType<typeof createLessonsState> | null>(
  null,
);

// The authenticated shell keys this provider by identity, role and session.
export function DraftWorkspace({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const [store] = useState(() =>
    createLessonsState(
      createLessonsApi(process.env.NEXT_PUBLIC_API_BASE_URL),
      auth.endSession,
      createResourcesApi(process.env.NEXT_PUBLIC_API_BASE_URL),
    ),
  );
  useLayoutEffect(() => {
    store.activate();
    return store.dispose;
  }, [store]);
  useLayoutEffect(() => {
    store.pause(auth.status !== "authenticated" || auth.pending !== null);
  }, [store, auth.status, auth.pending]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useDraftWorkspace() {
  const store = useContext(Context);
  if (!store) throw new Error("DraftWorkspace is required.");
  return store;
}
