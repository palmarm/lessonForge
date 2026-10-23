import { AuthApiError } from "./auth-api.ts";
import type { AuthApi, AuthIdentity } from "./auth-api.ts";

export type AuthSnapshot = {
  status: "loading" | "authenticated" | "unauthenticated" | "error";
  identity: AuthIdentity | null;
  pending: "login" | "logout" | null;
  error: string | null;
  notice: string | null;
};

export const initialAuthSnapshot: AuthSnapshot = {
  status: "loading",
  identity: null,
  pending: null,
  error: null,
  notice: null,
};

export function createAuthSession(api: AuthApi) {
  let snapshot = initialAuthSnapshot;
  let generation = 0;
  const listeners = new Set<() => void>();
  const update = (next: AuthSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  async function run(
    action: "restore" | "login" | "logout",
    request: () => Promise<AuthIdentity | void>,
  ) {
    // Never overlap cookie-changing requests: ignoring a stale response cannot undo Set-Cookie.
    if (snapshot.pending) return;
    const current = ++generation;
    update({
      ...snapshot,
      status:
        action === "restore"
          ? "loading"
          : snapshot.identity
            ? "authenticated"
            : "unauthenticated",
      pending: action === "restore" ? null : action,
      error: null,
      notice: null,
    });
    try {
      const identity = await request();
      if (current !== generation) {
        if (action !== "restore") update({ ...snapshot, pending: null });
        return;
      }
      update({
        status: identity ? "authenticated" : "unauthenticated",
        identity: identity ?? null,
        pending: null,
        error: null,
        notice: action === "logout" ? "You are signed out." : null,
      });
    } catch (error) {
      if (current !== generation) {
        if (action !== "restore") update({ ...snapshot, pending: null });
        return;
      }
      if (error instanceof AuthApiError && error.reason === "unauthenticated") {
        update({
          status: "unauthenticated",
          identity: null,
          pending: null,
          error: action === "login" ? error.message : null,
          notice: null,
        });
      } else {
        const message =
          error instanceof AuthApiError
            ? error.message
            : "The request could not be completed. Please try again.";
        update({
          ...snapshot,
          status: "error",
          pending: null,
          error:
            action === "logout"
              ? `Sign out could not be confirmed. ${message}`
              : message,
        });
      }
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    restore: () => run("restore", api.me),
    endSession: () => {
      generation++;
      update({
        status: "unauthenticated",
        identity: null,
        // A cookie-changing request must still settle before another can start.
        pending: snapshot.pending,
        error:
          "Your session has ended. Please sign in again. Unsaved work from the previous session has been cleared.",
        notice: null,
      });
    },
    login: (email: string, password: string) =>
      run("login", () => api.login(email, password)),
    logout: () => run("logout", api.logout),
    // Invalidate old reads on effect cleanup. Let accepted cookie changes settle:
    // a repeated effect must not leave pending stuck or permit overlapping writes.
    invalidate: () => {
      if (!snapshot.pending) generation++;
    },
  };
}
