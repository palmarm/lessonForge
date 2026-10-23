import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthApiError } from "../src/lib/auth-api.ts";
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
const unavailable = () =>
  new AuthApiError("unavailable", "Temporarily unavailable.");
const unauthorized = () =>
  new AuthApiError("unauthenticated", "Invalid email or password.");
const defaults = {
  me: async () => identity,
  login: async () => identity,
  logout: async () => {},
};
test("confirmed session end disposes identity immediately and rejects old restoration", async () => {
  const old = deferred();
  const session = createAuthSession({ ...defaults, me: () => old.promise });
  const reading = session.restore();
  session.endSession();
  old.resolve(identity);
  await reading;
  assert.equal(session.getSnapshot().identity, null);
  assert.equal(session.getSnapshot().status, "unauthenticated");
});

test("session expiry during a cookie change never revives identity or overlaps login", async () => {
  for (const fails of [false, true]) {
    const old = deferred();
    let calls = 0;
    const session = createAuthSession({ ...defaults, login: () => { calls++; return old.promise; } });
    await session.restore();
    const signingIn = session.login("teacher@example.test", "fixture");
    session.endSession();
    assert.equal(session.getSnapshot().identity, null);
    assert.equal(session.getSnapshot().pending, "login");
    await session.login("another@example.test", "fixture");
    assert.equal(calls, 1);
    if (fails) old.reject(unavailable());
    else old.resolve(identity);
    await signingIn;
    assert.equal(session.getSnapshot().identity, null);
    assert.equal(session.getSnapshot().pending, null);
  }
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("initial load restores either role and refresh uses me rather than cached browser identity", async () => {
  for (const role of ["TEACHER", "ADMIN"]) {
    let calls = 0;
    const session = createAuthSession({
      ...defaults,
      me: async () => {
        calls++;
        return { ...identity, user: { ...identity.user, role } };
      },
    });
    assert.equal(session.getSnapshot().status, "loading");
    assert.equal(session.getSnapshot().identity, null);
    await session.restore();
    assert.equal(calls, 1);
    assert.equal(session.getSnapshot().status, "authenticated");
    assert.equal(session.getSnapshot().identity.user.role, role);
  }
});

test("confirmed 401 clears identity, while unavailable me retains the last confirmed user", async () => {
  let fail;
  const session = createAuthSession({
    ...defaults,
    me: async () => {
      if (fail) throw fail;
      return identity;
    },
  });
  await session.restore();
  fail = unavailable();
  await session.restore();
  assert.equal(session.getSnapshot().status, "error");
  assert.equal(session.getSnapshot().identity, identity);
  fail = unauthorized();
  await session.restore();
  assert.equal(session.getSnapshot().status, "unauthenticated");
  assert.equal(session.getSnapshot().identity, null);
});

test("initial network failure reports an error and can recover through an explicit retry", async () => {
  let fail = true;
  const session = createAuthSession({
    ...defaults,
    me: async () => {
      if (fail) throw unavailable();
      return identity;
    },
  });
  await session.restore();
  assert.equal(session.getSnapshot().status, "error");
  assert.equal(session.getSnapshot().identity, null);
  fail = false;
  await session.restore();
  assert.equal(session.getSnapshot().status, "authenticated");
});

test("login pending state is visible; successful login replaces identity without retaining credentials", async () => {
  const pending = deferred();
  const session = createAuthSession({
    ...defaults,
    login: () => pending.promise,
  });
  const request = session.login("teacher@example.test", "fixture secret");
  assert.equal(session.getSnapshot().pending, "login");
  assert.equal(
    JSON.stringify(session.getSnapshot()).includes("fixture secret"),
    false,
  );
  pending.resolve(identity);
  await request;
  assert.equal(session.getSnapshot().status, "authenticated");
  assert.equal(session.getSnapshot().pending, null);
  assert.equal(session.getSnapshot().identity, identity);
});

test("invalid credentials become unauthenticated with a clear error", async () => {
  const session = createAuthSession({
    ...defaults,
    login: async () => {
      throw unauthorized();
    },
  });
  await session.login("teacher@example.test", "fixture");
  assert.equal(session.getSnapshot().status, "unauthenticated");
  assert.equal(session.getSnapshot().identity, null);
  assert.equal(session.getSnapshot().error, "Invalid email or password.");
});

test("failed logout retains identity and offers retry; only confirmed logout clears it", async () => {
  for (const error of [
    unavailable(),
    new AuthApiError("invalid-response", "Unexpected response."),
    new Error("untrusted failure"),
  ]) {
    let failure = error;
    const session = createAuthSession({
      ...defaults,
      logout: async () => {
        if (failure) throw failure;
      },
    });
    await session.restore();
    await session.logout();
    assert.equal(session.getSnapshot().status, "error");
    assert.equal(session.getSnapshot().identity, identity);
    assert.match(
      session.getSnapshot().error,
      /Sign out could not be confirmed/,
    );
    assert.equal(
      session.getSnapshot().error.includes("untrusted failure"),
      false,
    );
    failure = null;
    await session.logout();
    assert.equal(session.getSnapshot().status, "unauthenticated");
    assert.equal(session.getSnapshot().identity, null);
    assert.equal(session.getSnapshot().error, null);
  }
});

test("confirmed 401 during logout clears identity", async () => {
  const session = createAuthSession({
    ...defaults,
    logout: async () => {
      throw unauthorized();
    },
  });
  await session.restore();
  await session.logout();
  assert.equal(session.getSnapshot().status, "unauthenticated");
  assert.equal(session.getSnapshot().identity, null);
});

test("older me success or 401 cannot overwrite a newer login", async () => {
  for (const fail of [false, true]) {
    const old = deferred();
    const session = createAuthSession({ ...defaults, me: () => old.promise });
    const restore = session.restore();
    const admin = { ...identity, user: { ...identity.user, role: "ADMIN" } };
    await session.login("teacher@example.test", "fixture");
    const latest = session.getSnapshot();
    if (fail) old.reject(unauthorized());
    else old.resolve(admin);
    await restore;
    assert.equal(session.getSnapshot(), latest);
    assert.equal(session.getSnapshot().identity, identity);
  }
});

test("older me cannot resurrect identity after logout", async () => {
  const old = deferred();
  let reads = 0;
  const session = createAuthSession({
    ...defaults,
    me: () => (++reads === 1 ? Promise.resolve(identity) : old.promise),
  });
  await session.restore();
  const restore = session.restore();
  await session.logout();
  old.resolve(identity);
  await restore;
  assert.equal(session.getSnapshot().status, "unauthenticated");
  assert.equal(session.getSnapshot().identity, null);
});

test("mutations cannot overlap or start a read while a cookie change is pending", async () => {
  const pending = deferred();
  const calls = [];
  const session = createAuthSession({
    me: async () => {
      calls.push("me");
      return identity;
    },
    login: () => {
      calls.push("login");
      return pending.promise;
    },
    logout: async () => {
      calls.push("logout");
    },
  });
  const login = session.login("teacher@example.test", "fixture");
  await session.logout();
  await session.login("admin@example.test", "fixture");
  await session.restore();
  assert.deepEqual(calls, ["login"]);
  pending.resolve(identity);
  await login;
  await session.logout();
  assert.deepEqual(calls, ["login", "logout"]);
});

test("effect cleanup and repeated mounts invalidate earlier responses", async () => {
  const first = deferred();
  let reads = 0;
  const session = createAuthSession({
    ...defaults,
    me: () => (++reads === 1 ? first.promise : Promise.resolve(identity)),
  });
  const old = session.restore();
  session.invalidate();
  await session.restore();
  first.reject(unauthorized());
  await old;
  assert.equal(session.getSnapshot().status, "authenticated");
});

test("subscribers receive current state and unsubscribing prevents further notifications", async () => {
  const session = createAuthSession(defaults);
  const seen = [];
  const unsubscribe = session.subscribe(() =>
    seen.push(session.getSnapshot().status),
  );
  await session.restore();
  assert.deepEqual(seen, ["loading", "authenticated"]);
  unsubscribe();
  await session.logout();
  assert.deepEqual(seen, ["loading", "authenticated"]);
});

test("effect remount during login lets the accepted mutation settle without overlapping requests", async () => {
  const pending = deferred();
  const calls = [];
  const session = createAuthSession({
    me: async () => {
      calls.push("me");
      return identity;
    },
    login: () => {
      calls.push("login");
      return pending.promise;
    },
    logout: async () => {
      calls.push("logout");
    },
  });
  const login = session.login("teacher@example.test", "fixture");
  session.invalidate();
  await session.restore();
  await session.logout();
  assert.deepEqual(calls, ["login"]);
  pending.resolve(identity);
  await login;
  assert.equal(session.getSnapshot().status, "authenticated");
  assert.equal(session.getSnapshot().pending, null);
});
