export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: "TEACHER" | "ADMIN";
};

export type AuthIdentity = { user: AuthUser; expiresAt: string };
export type AuthRequestOptions = { signal?: AbortSignal };
export type AuthApi = {
  me: (options?: AuthRequestOptions) => Promise<AuthIdentity>;
  login: (
    email: string,
    password: string,
    options?: AuthRequestOptions,
  ) => Promise<AuthIdentity>;
  logout: (options?: AuthRequestOptions) => Promise<void>;
};

type Failure =
  | "unauthenticated"
  | "unavailable"
  | "cancelled"
  | "invalid-response"
  | "configuration"
  | "rejected";

export class AuthApiError extends Error {
  readonly reason: Failure;
  constructor(reason: Failure, message: string) {
    super(message);
    this.reason = reason;
    this.name = "AuthApiError";
  }
}

// Only a configured origin is accepted. Routes below are fixed, never user input.
export function validateApiBaseUrl(value: string | undefined): string {
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    if (
      url.origin !== value ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new AuthApiError(
      "configuration",
      "Sign-in is unavailable because the API address is not configured correctly.",
    );
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

export function validateAuthIdentity(value: unknown): AuthIdentity {
  const invalid = () =>
    new AuthApiError(
      "invalid-response",
      "The API returned an unexpected sign-in response. Check your session and try again.",
    );
  if (
    !record(value) ||
    !keys(value, ["user", "expiresAt"]) ||
    !record(value.user)
  )
    throw invalid();
  const user = value.user;
  if (
    !keys(user, ["id", "email", "displayName", "role"]) ||
    typeof user.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      user.id,
    ) ||
    typeof user.email !== "string" ||
    !user.email.trim() ||
    typeof user.displayName !== "string" ||
    !user.displayName.trim() ||
    (user.role !== "TEACHER" && user.role !== "ADMIN") ||
    typeof value.expiresAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.expiresAt) ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    new Date(value.expiresAt).toISOString() !== value.expiresAt
  )
    throw invalid();
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    },
    expiresAt: value.expiresAt,
  };
}

export function createAuthApi(
  configuredBaseUrl: string | undefined,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15_000,
): AuthApi {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 2_147_483_647
  ) {
    throw new AuthApiError(
      "configuration",
      "Invalid authentication request deadline.",
    );
  }
  let baseUrl: string | undefined;
  async function request<T>(
    route: "me" | "login" | "logout",
    body:
      { email: string; password: string } | Record<string, never> | undefined,
    consume: (response: Response) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    // Lazy validation keeps the server-rendered public shell independent of API configuration.
    baseUrl ??= validateApiBaseUrl(configuredBaseUrl);
    const controller = new AbortController();
    let rejectInterruption!: (reason: unknown) => void;
    const interrupted = new Promise<never>((_, reject) => {
      rejectInterruption = reject;
    });
    const interrupt = (error: AuthApiError) => {
      controller.abort(error);
      rejectInterruption(error);
    };
    const cancel = () =>
      interrupt(
        new AuthApiError(
          "cancelled",
          "The request was cancelled. Check your session before trying again.",
        ),
      );
    let timer: ReturnType<typeof setTimeout> | undefined;
    let completed = false;
    try {
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      timer = setTimeout(
        () =>
          interrupt(
            new AuthApiError(
              "unavailable",
              route === "login"
                ? "Sign-in timed out and may have completed. Check your session before trying again."
                : "The request timed out. Check your connection and try again.",
            ),
          ),
        timeoutMs,
      );

      // Race as well as abort: even a transport/body reader ignoring cancellation
      // must not hold the UI pending or deliver a late result to the session store.
      const operation = async () => {
        if (controller.signal.aborted) throw controller.signal.reason;
        let response: Response;
        try {
          response = await fetcher(`${baseUrl}/auth/${route}`, {
            signal: controller.signal,
            method: body === undefined ? "GET" : "POST",
            credentials: "include",
            cache: "no-store",
            redirect: "error",
            headers:
              body === undefined
                ? { Accept: "application/json" }
                : {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "X-LessonForge-CSRF": "1",
                  },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        } catch {
          if (controller.signal.aborted) throw controller.signal.reason;
          throw new AuthApiError(
            "unavailable",
            "Unable to reach LessonForge. Check your connection and try again.",
          );
        }
        if (controller.signal.aborted) throw controller.signal.reason;
        if (response.status === 401)
          throw new AuthApiError(
            "unauthenticated",
            route === "login"
              ? "Invalid email or password."
              : "Your session has ended. Please sign in again.",
          );
        if (response.status === 503)
          throw new AuthApiError(
            "unavailable",
            "LessonForge is temporarily unavailable. Please try again.",
          );
        if (!response.ok) {
          const messages: Record<number, string> = {
            400: "Check your email and password and try again.",
            403: "This request was blocked. Reload the page and try again.",
            429: "Too many requests. Wait a moment before trying again.",
          };
          throw new AuthApiError(
            "rejected",
            messages[response.status] ??
              "The request could not be completed. Please try again.",
          );
        }
        try {
          const result = await consume(response);
          if (controller.signal.aborted) throw controller.signal.reason;
          return result;
        } catch (error) {
          if (controller.signal.aborted) throw controller.signal.reason;
          throw error;
        }
      };
      const result = await Promise.race([operation(), interrupted]);
      completed = true;
      return result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      // Dispose of unread error bodies; confirmed status errors stay unchanged.
      if (!completed && !controller.signal.aborted) controller.abort();
    }
  }

  async function identity(response: Response): Promise<AuthIdentity> {
    if (
      response.status !== 200 ||
      response.headers
        .get("Content-Type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    ) {
      throw new AuthApiError(
        "invalid-response",
        "The API returned an unexpected sign-in response. Check your session and try again.",
      );
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new AuthApiError(
        "invalid-response",
        "The API returned an unreadable sign-in response. Check your session and try again.",
      );
    }
    return validateAuthIdentity(value);
  }

  return {
    me: (options) => request("me", undefined, identity, options?.signal),
    login: (email, password, options) =>
      request("login", { email, password }, identity, options?.signal),
    logout: (options) =>
      request(
        "logout",
        {},
        async (response) => {
          if (response.status !== 204)
            throw new AuthApiError(
              "invalid-response",
              "The API did not confirm sign out. Please try again.",
            );
        },
        options?.signal,
      ),
  };
}
