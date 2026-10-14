import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { AuthApiError, createAuthApi } from "../src/lib/auth-api.ts";
import { createAuthSession } from "../src/lib/auth-session.ts";

const identity = {
  user: {
    id: "b9a67aef-5002-4d2d-a208-a5aad144802c",
    email: "teacher@example.test",
    displayName: "Sample Teacher",
    role: "TEACHER",
  },
  expiresAt: "2030-01-01T08:00:00.000Z",
};
const origin = "http://localhost:3001";
const failure = (reason) => (error) =>
  error instanceof AuthApiError && error.reason === reason;
const deferred = () => Promise.withResolvers();
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

test("stalled headers abort at the default 15-second deadline and never retry automatically", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const headers = deferred();
  let signal;
  let calls = 0;
  const api = createAuthApi(origin, async (_url, options) => {
    calls++;
    signal = options.signal;
    return headers.promise; // Deliberately ignore abort to exercise the deadline race.
  });
  const rejected = assert.rejects(api.me(), failure("unavailable"));
  context.mock.timers.tick(14_999);
  await flush();
  assert.equal(signal.aborted, false);
  context.mock.timers.tick(1);
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.reason, "unavailable");
  assert.equal(calls, 1);
  headers.resolve(Response.json(identity));
  await flush();
});

test("the same deadline stays active through complete streaming JSON consumption", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const headers = deferred();
  let reader;
  const body = new ReadableStream({
    start(controller) {
      reader = controller;
    },
  });
  let signal;
  const api = createAuthApi(origin, async (_url, options) => {
    signal = options.signal;
    signal.addEventListener("abort", () => reader.error(signal.reason), {
      once: true,
    });
    return headers.promise;
  });
  const rejected = assert.rejects(api.me(), failure("unavailable"));
  context.mock.timers.tick(10_000);
  headers.resolve(
    new Response(body, { headers: { "Content-Type": "application/json" } }),
  );
  reader.enqueue(new TextEncoder().encode('{"user":'));
  await flush();
  context.mock.timers.tick(4_999);
  await flush();
  assert.equal(signal.aborted, false);
  context.mock.timers.tick(1);
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(getEventListeners(signal, "abort").length, 0);
});

test("a successful request consumes its body and clears the timer without later abort", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const clear = context.mock.method(globalThis, "clearTimeout");
  const external = new AbortController();
  let reader;
  let signal;
  const body = new ReadableStream({
    start(controller) {
      reader = controller;
    },
  });
  const api = createAuthApi(origin, async (_url, options) => {
    signal = options.signal;
    return new Response(body, {
      headers: { "Content-Type": "application/json" },
    });
  });
  const request = api.me({ signal: external.signal });
  assert.equal(getEventListeners(external.signal, "abort").length, 1);
  await flush();
  context.mock.timers.tick(14_999);
  reader.enqueue(new TextEncoder().encode(JSON.stringify(identity)));
  await flush();
  let settled = false;
  void request.then(() => {
    settled = true;
  });
  await flush();
  assert.equal(settled, false); // A full JSON chunk still needs end-of-body.
  reader.close();
  assert.deepEqual(await request, identity);
  assert.equal(clear.mock.callCount(), 1);
  assert.equal(getEventListeners(external.signal, "abort").length, 0);
  context.mock.timers.tick(20_000);
  external.abort();
  assert.equal(signal.aborted, false);
});

test("HTTP, transport, invalid-body, timeout, and cancellation paths remove timers and caller listeners", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const clear = context.mock.method(globalThis, "clearTimeout");
  for (const scenario of [
    "http",
    "transport",
    "invalid-body",
    "timeout",
    "cancel",
  ]) {
    const external = new AbortController();
    const stalled = deferred();
    let signal;
    const api = createAuthApi(origin, async (_url, options) => {
      signal = options.signal;
      if (scenario === "http")
        return Response.json({ message: "fixture" }, { status: 401 });
      if (scenario === "transport")
        throw new Error("private transport details");
      if (scenario === "invalid-body")
        return new Response("{bad", {
          headers: { "Content-Type": "application/json" },
        });
      return stalled.promise;
    });
    const before = clear.mock.callCount();
    const rejected = assert.rejects(
      api.me({ signal: external.signal }),
      failure(
        scenario === "http"
          ? "unauthenticated"
          : scenario === "invalid-body"
            ? "invalid-response"
            : scenario === "cancel"
              ? "cancelled"
              : "unavailable",
      ),
    );
    if (scenario === "timeout") context.mock.timers.tick(15_000);
    if (scenario === "cancel")
      external.abort(new Error("private cancellation details"));
    await rejected;
    assert.equal(clear.mock.callCount(), before + 1, scenario);
    assert.equal(
      getEventListeners(external.signal, "abort").length,
      0,
      scenario,
    );
    assert.equal(signal.aborted, true, scenario);
    stalled.resolve(Response.json(identity));
    await flush();
  }
});

test("already-cancelled requests never fetch and cancellation remains distinct from timeout", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const clear = context.mock.method(globalThis, "clearTimeout");
  const external = new AbortController();
  external.abort(new Error("private reason"));
  let calls = 0;
  const api = createAuthApi(origin, async () => {
    calls++;
    return Response.json(identity);
  });
  await assert.rejects(
    api.me({ signal: external.signal }),
    (error) =>
      failure("cancelled")(error) && !error.message.includes("private"),
  );
  assert.equal(calls, 0);
  assert.equal(clear.mock.callCount(), 1);
  assert.equal(getEventListeners(external.signal, "abort").length, 0);
});

test("caller cancellation during body reading aborts and cleans up without becoming a 401", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const external = new AbortController();
  const body = deferred();
  let signal;
  const response = Response.json(identity);
  response.json = () => body.promise;
  const api = createAuthApi(origin, async (_url, options) => {
    signal = options.signal;
    return response;
  });
  const rejected = assert.rejects(
    api.me({ signal: external.signal }),
    failure("cancelled"),
  );
  await flush();
  external.abort();
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(getEventListeners(external.signal, "abort").length, 0);
  body.resolve(identity);
  await flush();
});

test("initial session timeout leaves loading, supports reconciliation, and ignores late headers", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const headers = deferred();
  let calls = 0;
  const session = createAuthSession(
    createAuthApi(origin, async () =>
      ++calls === 1 ? headers.promise : Response.json(identity),
    ),
  );
  const initial = session.restore();
  assert.equal(session.getSnapshot().status, "loading");
  context.mock.timers.tick(15_000);
  await initial;
  assert.equal(session.getSnapshot().status, "error");
  assert.equal(session.getSnapshot().pending, null);
  assert.match(session.getSnapshot().error, /timed out/);
  await session.restore();
  assert.equal(session.getSnapshot().status, "authenticated");
  const latest = session.getSnapshot();
  headers.resolve(new Response(null, { status: 401 }));
  await flush();
  assert.equal(session.getSnapshot(), latest);
  assert.equal(calls, 2);
});

test("uncertain logout retains identity, permits retry, and late success cannot clear a newer login", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const headers = deferred();
  let logouts = 0;
  const session = createAuthSession(
    createAuthApi(origin, async (url) => {
      if (url.endsWith("/logout"))
        return ++logouts === 1
          ? headers.promise
          : new Response(null, { status: 204 });
      return Response.json(identity);
    }),
  );
  await session.restore();
  const logout = session.logout();
  context.mock.timers.tick(15_000);
  await logout;
  assert.equal(session.getSnapshot().status, "error");
  assert.deepEqual(session.getSnapshot().identity, identity);
  assert.equal(session.getSnapshot().pending, null);
  assert.match(session.getSnapshot().error, /Sign out could not be confirmed/);
  await session.logout();
  assert.equal(session.getSnapshot().status, "unauthenticated");
  await session.login("teacher@example.test", "fixture");
  const latest = session.getSnapshot();
  headers.resolve(new Response(null, { status: 204 }));
  await flush();
  assert.equal(session.getSnapshot(), latest);
  assert.equal(logouts, 2);
});

test("timed-out login does not reject credentials or retry automatically and can reconcile the session", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const body = deferred();
  const response = Response.json(identity);
  response.json = () => body.promise; // Simulate late JSON despite transport abort.
  const calls = [];
  const session = createAuthSession(
    createAuthApi(origin, async (url) => {
      calls.push(url);
      return url.endsWith("/login") ? response : Response.json(identity);
    }),
  );
  const login = session.login("teacher@example.test", "fixture");
  await flush();
  context.mock.timers.tick(15_000);
  await login;
  assert.equal(session.getSnapshot().status, "error");
  assert.equal(session.getSnapshot().pending, null);
  assert.match(session.getSnapshot().error, /may have completed/);
  assert.doesNotMatch(session.getSnapshot().error, /Invalid email or password/);
  assert.deepEqual(calls, [`${origin}/auth/login`]);
  await session.restore();
  assert.deepEqual(calls, [`${origin}/auth/login`, `${origin}/auth/me`]);
  assert.equal(session.getSnapshot().status, "authenticated");
  const latest = session.getSnapshot();
  body.reject(new Error("late untrusted body failure"));
  await flush();
  assert.equal(session.getSnapshot(), latest);
});

test("effect cleanup keeps an older timed-out restore from overwriting a newer mount", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const headers = deferred();
  let calls = 0;
  const session = createAuthSession(
    createAuthApi(origin, async () =>
      ++calls === 1 ? headers.promise : Response.json(identity),
    ),
  );
  const old = session.restore();
  session.invalidate();
  await session.restore();
  const latest = session.getSnapshot();
  context.mock.timers.tick(15_000);
  await old;
  assert.equal(session.getSnapshot(), latest);
  headers.resolve(Response.json(identity));
  await flush();
});

test("a late successful login body cannot replace an identity restored after timeout", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const body = deferred();
  const response = Response.json(identity);
  response.json = () => body.promise;
  const session = createAuthSession(
    createAuthApi(origin, async (url) =>
      url.endsWith("/login") ? response : Response.json(identity),
    ),
  );
  const login = session.login("teacher@example.test", "fixture");
  await flush();
  context.mock.timers.tick(15_000);
  await login;
  await session.restore();
  const latest = session.getSnapshot();
  body.resolve({ ...identity, user: { ...identity.user, role: "ADMIN" } });
  await flush();
  assert.equal(session.getSnapshot(), latest);
  assert.equal(session.getSnapshot().identity.user.role, "TEACHER");
});

test("invalid configuration/deadlines allocate no timer or caller listener", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const set = context.mock.method(globalThis, "setTimeout");
  const external = new AbortController();
  const fetcher = async () => {
    throw new Error("must not fetch");
  };
  for (const value of [0, -1, NaN, Infinity, 1.5, 2_147_483_648])
    assert.throws(
      () => createAuthApi(origin, fetcher, value),
      failure("configuration"),
    );
  await assert.rejects(
    createAuthApi(undefined, fetcher).me({ signal: external.signal }),
    failure("configuration"),
  );
  assert.equal(set.mock.callCount(), 0);
  assert.equal(getEventListeners(external.signal, "abort").length, 0);
});
