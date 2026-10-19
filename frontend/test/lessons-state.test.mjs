import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLessonsState,
  initialLessonState,
} from "../src/lib/lessons-state.ts";
import { createLessonsApi } from "../src/lib/lessons-api.ts";
import { AuthApiError } from "../src/lib/api-request.ts";
// Fixtures are local to avoid registering another test module twice.
const id = "11111111-1111-4111-8111-111111111111";
const resourceId = "22222222-2222-4222-8222-222222222222";
const lesson = {
  id,
  title: "Saved",
  version: 1,
  state: "DRAFT",
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
  content: { title: "Saved" },
  sources: [],
  generationOrigin: "MANUAL",
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function fixture(sessionEnded) {
  const calls = [];
  const api = {
    list: async () => ({ items: [], nextAfter: null }),
    detail: async () => structuredClone(lesson),
    create: async (content) => {
      calls.push(["create", content]);
      return { ...lesson, content };
    },
    save: async (id, version, content) => {
      calls.push(["save", id, version, content]);
      return { ...lesson, content, version: version + 1 };
    },
    source: async (...args) => {
      calls.push(args);
      return { ...lesson, version: args[1] + 1 };
    },
  };
  return { api, calls, store: createLessonsState(api, sessionEnded) };
}
test("content and base version survive validation, conflict and availability failures; reconciliation is explicit", async () => {
  for (const reason of [
    "rejected",
    "conflict",
    "unavailable",
    "invalid-response",
  ]) {
    const { store, api, calls } = fixture();
    await store.view(id);
    store.field({ title: "My unsaved text" });
    api.save = async () => {
      calls.push("failure");
      throw new AuthApiError(reason, "Safe failure");
    };
    await store.save();
    api.detail = async () => ({
      ...lesson,
      version: 2,
      title: "Other saved text",
      content: { title: "Other saved text" },
    });
    await store.reconcile();
    assert.equal(store.getSnapshot().form.title, "My unsaved text");
    assert.equal(store.getSnapshot().baseVersion, 1);
    if (store.getSnapshot().uncertain) {
      await store.save();
      assert.equal(calls.length, 1);
      store.acknowledge();
    }
    store.adoptLatest();
    assert.equal(store.getSnapshot().baseVersion, 2);
    assert.equal(store.getSnapshot().form.title, "My unsaved text");
    api.save = async (_id, version, content) => {
      assert.equal(version, 2);
      assert.equal(content.title, "My unsaved text");
      return { ...lesson, version: 3, content };
    };
    await store.save();
    assert.equal(store.getSnapshot().baseVersion, 3);
  }
});
test("all source actions retain unsaved content and share the same lesson version as saves", async () => {
  const { store, api } = fixture();
  await store.view(id);
  store.field({ title: "Unsaved working text" });
  let version = 1;
  api.source = async (_id, expected, key, action) => {
    assert.equal(expected, version);
    assert.equal(key, resourceId);
    return {
      ...lesson,
      version: ++version,
      sources:
        action === "remove"
          ? []
          : [
              {
                resourceId,
                resourceVersion: 1,
                snapshot: { title: "Captured" },
              },
            ],
    };
  };
  for (const action of ["select", "refresh", "remove"]) {
    await store.source(resourceId, action);
    assert.equal(store.getSnapshot().form.title, "Unsaved working text");
    assert.equal(store.getSnapshot().baseVersion, version);
  }
});
test("uncertain creation cannot retry or discard; inspected results require explicit identity/version adoption", async () => {
  const { store, api, calls } = fixture();
  store.create();
  store.field({ title: "Entered new draft" });
  api.create = async () => {
    calls.push("create");
    throw new AuthApiError("unavailable", "May have completed");
  };
  await store.save();
  await store.save();
  store.close();
  store.acknowledge();
  assert.equal(calls.length, 1);
  assert.equal(store.getSnapshot().form.title, "Entered new draft");
  api.list = async () => ({ items: [lesson], nextAfter: null });
  await store.list();
  assert.equal(store.getSnapshot().reconciled, false);
  await store.reconcile();
  await store.inspectCreation(id);
  assert.equal(store.getSnapshot().editId, null);
  assert.equal(store.getSnapshot().baseVersion, null);
  store.adoptLatest();
  assert.equal(store.getSnapshot().editId, null);
  store.acknowledge();
  store.adoptLatest();
  assert.equal(store.getSnapshot().editId, id);
  assert.equal(store.getSnapshot().baseVersion, 1);
  assert.equal(store.getSnapshot().form.title, "Entered new draft");
});
test("uncertain source writes require target detail, retain preconditions, and reject stale reconciliation eligibility", async () => {
  for (const action of ["select", "remove", "refresh"]) {
    const { store, api, calls } = fixture();
    await store.view(id);
    store.field({ title: "Keep me" });
    api.source = async () => {
      calls.push(action);
      throw new AuthApiError("unavailable", "Uncertain");
    };
    await store.source(resourceId, action);
    await store.list();
    store.acknowledge();
    await store.source(resourceId, action);
    assert.equal(calls.length, 1);
    assert.equal(store.getSnapshot().baseVersion, 1);
    api.detail = async (key) => {
      assert.equal(key, id);
      return { ...lesson, version: 2 };
    };
    await store.reconcile();
    assert.equal(store.getSnapshot().reconciled, true);
    api.detail = async () => {
      throw new AuthApiError("unavailable", "Failed read");
    };
    await store.reconcile();
    store.acknowledge();
    assert.ok(store.getSnapshot().uncertain);
    assert.equal(store.getSnapshot().latest, null);
    assert.equal(store.getSnapshot().form.title, "Keep me");
  }
});
test("unconfirmed auth/logout pauses controls and invalidates late writes while keeping entered content", async () => {
  for (const type of ["create", "save", "source"])
    for (const reject of [false, true]) {
      const { store, api } = fixture();
      const late = deferred();
      let calls = 0;
      if (type === "create") store.create();
      else await store.view(id);
      store.field({ title: "Retained entered text" });
      api[type] = () => {
        calls++;
        return late.promise;
      };
      const pending =
        type === "source" ? store.source(resourceId, "refresh") : store.save();
      store.pause(true);
      await store.save();
      await store.list();
      store.field({ title: "Blocked edit" });
      if (reject) late.reject(new Error("old request"));
      else late.resolve({ ...lesson, version: 2 });
      await pending;
      assert.equal(calls, 1);
      assert.equal(store.getSnapshot().form.title, "Retained entered text");
      assert.ok(store.getSnapshot().uncertain);
      assert.equal(
        store.getSnapshot().baseVersion,
        type === "create" ? null : 1,
      );
      store.pause(false);
      await store.save();
      assert.equal(calls, 1);
    }
});
test("confirmed identity changes dispose private workspace and reject prior successes/failures", async () => {
  for (const reject of [false, true]) {
    const { store, api } = fixture();
    const late = deferred();
    let signal;
    store.create();
    store.field({ title: "Prior identity secret" });
    api.create = (_content, s) => {
      signal = s;
      return late.promise;
    };
    const pending = store.save();
    store.dispose();
    assert.equal(signal.aborted, true);
    store.activate();
    await store.list();
    if (reject) late.reject(new Error("prior identity"));
    else late.resolve(lesson);
    await pending;
    assert.deepEqual(store.getSnapshot(), initialLessonState);
  }
});
test("401 requests authentication reconciliation and keeps work until identity confirmation", async () => {
  let ended = 0;
  const { store, api } = fixture(() => ended++);
  await store.view(id);
  store.field({ title: "Retained" });
  api.save = async () => {
    throw new AuthApiError("unauthenticated", "Session ended");
  };
  await store.save();
  assert.equal(ended, 1);
  assert.equal(store.getSnapshot().form.title, "Retained");
});
test("real transport/state handles writes that commit before gateway failure without duplicate writes or implicit rebase", async () => {
  for (const status of [500, 502, 503, 504])
    for (const committed of [false, true]) {
      let saved = structuredClone(lesson),
        writes = 0;
      const api = createLessonsApi(
        "http://localhost:3001",
        async (_url, options) => {
          if (options.method === "PUT") {
            writes++;
            if (committed) {
              const body = JSON.parse(options.body);
              saved = {
                ...saved,
                content: body.content,
                title: body.content.title,
                version: 2,
              };
            }
            return new Response("{}", {
              status,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify(saved), {
            headers: { "Content-Type": "application/json" },
          });
        },
      );
      const store = createLessonsState(api);
      await store.view(id);
      store.field({ title: "My entered text" });
      await store.save();
      await store.save();
      assert.equal(writes, 1);
      await store.reconcile();
      assert.equal(store.getSnapshot().latest.version, committed ? 2 : 1);
      assert.equal(store.getSnapshot().baseVersion, 1);
      assert.equal(store.getSnapshot().form.title, "My entered text");
      store.acknowledge();
      assert.equal(store.getSnapshot().baseVersion, 1);
      store.adoptLatest();
      assert.equal(store.getSnapshot().baseVersion, committed ? 2 : 1);
    }
});

test("uncertain creation through real transport preserves entered content and never silently adopts a matching list item", async () => {
  for (const status of [500, 502, 503, 504])
    for (const committed of [false, true]) {
      let saved = null,
        writes = 0;
      const reply = (value, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      const api = createLessonsApi(
        "http://localhost:3001",
        async (url, options) => {
          if (options.method === "POST") {
            writes++;
            if (committed)
              saved = {
                ...lesson,
                title: "Entered",
                content: JSON.parse(options.body).content,
              };
            return reply({}, status);
          }
          if (url.includes("?")) {
            const summary = Object.fromEntries(
              Object.entries(saved ?? lesson).filter(
                ([key]) =>
                  !["content", "sources", "generationOrigin"].includes(key),
              ),
            );
            return reply({ items: saved ? [summary] : [], nextAfter: null });
          }
          return reply(saved);
        },
      );
      const store = createLessonsState(api);
      store.create();
      store.field({ title: "Entered" });
      await store.save();
      await store.save();
      assert.equal(writes, 1);
      await store.reconcile();
      assert.equal(store.getSnapshot().editId, null);
      assert.equal(store.getSnapshot().baseVersion, null);
      if (committed) await store.inspectCreation(id);
      store.acknowledge();
      assert.equal(store.getSnapshot().form.title, "Entered");
      assert.equal(store.getSnapshot().editId, null);
      if (committed) {
        store.adoptLatest();
        assert.equal(store.getSnapshot().editId, id);
      }
    }
});
test("active resource browsing validates visibility and does not replace entered draft content", async () => {
  let retired = false;
  const resource = { id: resourceId, retiredAt: null, title: "Fractions" };
  const resources = {
    list: async () => ({
      items: [{ ...resource, retiredAt: retired ? lesson.updatedAt : null }],
      nextAfter: null,
    }),
    detail: async () => ({
      ...resource,
      retiredAt: retired ? lesson.updatedAt : null,
    }),
  };
  const { api } = fixture();
  const store = createLessonsState(api, undefined, resources);
  await store.view(id);
  store.field({ title: "Keep entered text" });
  await store.resources();
  await store.resource(resourceId);
  assert.equal(store.getSnapshot().resourceItems.length, 1);
  assert.equal(store.getSnapshot().form.title, "Keep entered text");
  retired = true;
  await store.resources();
  assert.ok(store.getSnapshot().error);
  await store.resource(resourceId);
  assert.ok(store.getSnapshot().error);
  assert.equal(store.getSnapshot().form.title, "Keep entered text");
});
