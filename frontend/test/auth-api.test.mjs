import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AuthApiError,
  createAuthApi,
  validateApiBaseUrl,
  validateAuthIdentity,
} from "../src/lib/auth-api.ts";

const identity = {
  user: {
    id: "b9a67aef-5002-4d2d-a208-a5aad144802c",
    email: "teacher@example.test",
    displayName: "Sample Teacher",
    role: "TEACHER",
  },
  expiresAt: "2030-01-01T08:00:00.000Z",
};
const json = (value, status = 200) => Response.json(value, { status });
const fails = (reason) => (error) =>
  error instanceof AuthApiError && error.reason === reason;

test("accepts canonical HTTPS and loopback HTTP origins", () => {
  for (const origin of [
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://[::1]:3001",
    "https://api.example.test",
  ])
    assert.equal(validateApiBaseUrl(origin), origin);
});

test("rejects missing or unsafe destinations before fetch, without exposing configuration", async () => {
  for (const value of [
    undefined,
    "",
    "http://api.example.test",
    "ftp://localhost",
    "//localhost:3001",
    "http://localhost:3001/",
    "http://localhost:3001/auth",
    "http://localhost:3001?next=https://other.test",
    "http://localhost:3001#fragment",
    "http://secret:secret@localhost:3001",
    " http://localhost:3001",
  ]) {
    let calls = 0;
    const api = createAuthApi(value, async () => {
      calls++;
      throw new Error("must not fetch");
    });
    await assert.rejects(
      api.me(),
      (error) =>
        fails("configuration")(error) && !error.message.includes("secret"),
    );
    assert.equal(calls, 0);
  }
});

test("requests fixed routes with included credentials, no cache/redirects, and CSRF on writes", async () => {
  const calls = [];
  const api = createAuthApi("http://localhost:3001", async (url, options) => {
    calls.push({ url, options });
    return url.endsWith("/logout")
      ? new Response(null, { status: 204 })
      : json(identity);
  });
  assert.deepEqual(await api.me(), identity);
  assert.deepEqual(
    await api.login(" Teacher@example.test ", "  fixture password é  "),
    identity,
  );
  await api.logout();
  assert.deepEqual(
    calls.map(({ url }) => url),
    [
      "http://localhost:3001/auth/me",
      "http://localhost:3001/auth/login",
      "http://localhost:3001/auth/logout",
    ],
  );
  for (const { options } of calls) {
    assert.equal(options.credentials, "include");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.equal(new Headers(options.headers).get("Authorization"), null);
  }
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.body, undefined);
  assert.equal(
    new Headers(calls[0].options.headers).get("X-LessonForge-CSRF"),
    null,
  );
  for (const { options } of calls.slice(1)) {
    assert.equal(options.method, "POST");
    assert.equal(
      new Headers(options.headers).get("Content-Type"),
      "application/json",
    );
    assert.equal(new Headers(options.headers).get("X-LessonForge-CSRF"), "1");
  }
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    email: " Teacher@example.test ",
    password: "  fixture password é  ",
  });
  assert.equal(calls[2].options.body, "{}");
});

test("validates both roles and constructs only the safe identity projection", () => {
  for (const role of ["TEACHER", "ADMIN"]) {
    const value = { ...identity, user: { ...identity.user, role } };
    const result = validateAuthIdentity(value);
    assert.deepEqual(result, value);
    assert.notEqual(result, value);
    assert.notEqual(result.user, value.user);
  }
});

test("rejects malformed identity, unknown roles, invalid dates, and extra credential fields", () => {
  for (const value of [
    null,
    [],
    {},
    { user: identity.user },
    { ...identity, token: "fixture-only" },
    { ...identity, expiresAt: "2030-02-30T08:00:00.000Z" },
    { ...identity, expiresAt: "not a date" },
    { ...identity, expiresAt: 123 },
    ...[
      { id: "not-a-uuid" },
      { email: "" },
      { displayName: " " },
      { role: "OWNER" },
      { role: null },
      { passwordHash: "fixture-only" },
    ].map((fields) => ({ ...identity, user: { ...identity.user, ...fields } })),
  ]) {
    assert.throws(() => validateAuthIdentity(value), fails("invalid-response"));
  }
});

test("login and me reject malformed successful responses", async () => {
  const responses = [
    () => json({ user: identity.user }),
    () => new Response("<html>unexpected</html>", { status: 200 }),
    () =>
      new Response("{bad", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    () => json(identity, 201),
    () => new Response(null, { status: 204 }),
  ];
  for (const response of responses) {
    const api = createAuthApi("http://localhost:3001", async () => response());
    await assert.rejects(api.me(), fails("invalid-response"));
    await assert.rejects(
      api.login("teacher@example.test", "fixture"),
      fails("invalid-response"),
    );
  }
});

test("401 is confirmed unauthenticated; 503 and network failures remain availability errors", async () => {
  for (const action of ["me", "login", "logout"]) {
    for (const [status, reason] of [
      [401, "unauthenticated"],
      [503, "unavailable"],
      [403, "rejected"],
      [429, "rejected"],
      [400, "rejected"],
      [500, "rejected"],
    ]) {
      const api = createAuthApi("http://localhost:3001", async () =>
        json({ message: "untrusted server detail" }, status),
      );
      await assert.rejects(
        api[action]("teacher@example.test", "fixture"),
        (error) => fails(reason)(error) && !error.message.includes("untrusted"),
      );
    }
    const api = createAuthApi("http://localhost:3001", async () => {
      throw new Error("private transport detail");
    });
    await assert.rejects(
      api[action]("teacher@example.test", "fixture"),
      (error) =>
        fails("unavailable")(error) && !error.message.includes("private"),
    );
  }
});

test("logout requires the contract's 204 rather than any successful HTTP status", async () => {
  const api = createAuthApi("http://localhost:3001", async () =>
    json({ ok: true }),
  );
  await assert.rejects(api.logout(), fails("invalid-response"));
});
