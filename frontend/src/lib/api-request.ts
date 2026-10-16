export type Failure =
  | "unauthenticated"
  | "unavailable"
  | "cancelled"
  | "invalid-response"
  | "configuration"
  | "rejected"
  | "conflict";

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

export function createCredentialedRequest(
  configuredBaseUrl: string | undefined,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15_000,
) {
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
  return async function request<T>(
    route: string,
    body: object | undefined,
    consume: (response: Response) => Promise<T>,
    signal?: AbortSignal,
    options: {
      method?: "POST" | "PUT";
      messages?: Record<number, string>;
    } = {},
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
              route === "/auth/login"
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
          response = await fetcher(`${baseUrl}${route}`, {
            signal: controller.signal,
            method: body === undefined ? "GET" : (options.method ?? "POST"),
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
            route === "/auth/login"
              ? "Invalid email or password."
              : "Your session has ended. Please sign in again.",
          );
        if (
          response.status === 503 ||
          (body !== undefined && [500, 502, 504].includes(response.status))
        )
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
            response.status === 409 ? "conflict" : "rejected",
            options.messages?.[response.status] ??
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
  };
}
