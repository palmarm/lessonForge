import { AuthApiError, createCredentialedRequest } from "./api-request.ts";
export { AuthApiError, validateApiBaseUrl } from "./api-request.ts";

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
  const request = createCredentialedRequest(
    configuredBaseUrl,
    fetcher,
    timeoutMs,
  );
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
    me: (options) => request("/auth/me", undefined, identity, options?.signal),
    login: (email, password, options) =>
      request("/auth/login", { email, password }, identity, options?.signal),
    logout: (options) =>
      request(
        "/auth/logout",
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
