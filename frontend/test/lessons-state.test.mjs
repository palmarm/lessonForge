import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLessonsState,
  initialLessonState,
  hasUnsavedLessonContent,
} from "../src/lib/lessons-state.ts";
import { createLessonsApi } from "../src/lib/lessons-api.ts";
import { createResourcesApi } from "../src/lib/resources-api.ts";
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
test("a new failed list read invalidates candidate acknowledgement and creation no-match eligibility", async () => {
  const { store, api } = fixture();
  store.create();
  api.create = async () => {
    throw new AuthApiError("unavailable", "Unknown outcome");
  };
  await store.save();
  await store.reconcile();
  await store.inspectCreation(id);
  assert.equal(store.getSnapshot().reconciled, true);
  api.list = async () => {
    throw new AuthApiError("unavailable", "Read failed");
  };
  await store.list();
  store.acknowledge();
  store.confirmCreationNotFound();
  assert.equal(store.getSnapshot().reconciled, false);
  assert.equal(store.getSnapshot().latest, null);
  assert.equal(store.getSnapshot().creationListChecked, false);
  assert.ok(store.getSnapshot().uncertain);
});

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
    assert.deepEqual(store.getSnapshot(), initialLessonState);
    store.activate();
    await store.list();
    if (reject) late.reject(new Error("prior identity"));
    else late.resolve(lesson);
    await pending;
    assert.deepEqual(store.getSnapshot(), {
      ...initialLessonState,
      listLoaded: true,
    });
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
      if (committed) store.acknowledge();
      else store.confirmCreationNotFound();
      assert.equal(store.getSnapshot().uncertain, null);
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

test("creation candidate A is cleared before inspecting B; failed B cannot acknowledge, adopt or retry", async () => {
  const { store, api } = fixture();
  let writes = 0;
  api.create = async () => {
    writes++;
    throw new AuthApiError("unavailable", "Creation uncertain");
  };
  store.create();
  store.field({ title: "Keep my entered lesson" });
  await store.save();
  await store.reconcile();
  store.acknowledge();
  assert.ok(
    store.getSnapshot().uncertain,
    "a list read is not a candidate inspection",
  );
  await store.inspectCreation(id);
  assert.equal(store.getSnapshot().reconciled, true);
  const b = deferred();
  api.detail = () => b.promise;
  const pending = store.inspectCreation(resourceId);
  assert.equal(store.getSnapshot().reconciled, false);
  assert.equal(store.getSnapshot().latest, null);
  assert.equal(store.getSnapshot().creationListChecked, false);
  store.acknowledge();
  store.confirmCreationNotFound();
  b.reject(new AuthApiError("unavailable", "Candidate B unavailable"));
  await pending;
  store.acknowledge();
  store.adoptLatest();
  store.confirmCreationNotFound();
  await store.save();
  assert.equal(writes, 1);
  assert.ok(store.getSnapshot().uncertain);
  assert.equal(store.getSnapshot().latest, null);
  assert.equal(store.getSnapshot().editId, null);
  assert.equal(store.getSnapshot().baseVersion, null);
  assert.equal(store.getSnapshot().form.title, "Keep my entered lesson");
  api.detail = async () => ({ ...lesson, id: resourceId, version: 4 });
  await store.inspectCreation(resourceId); // Failed B can be inspected again without weakening acknowledgement.
  store.acknowledge();
  assert.equal(store.getSnapshot().editId, null);
  store.adoptLatest();
  assert.equal(store.getSnapshot().editId, resourceId);
  assert.equal(store.getSnapshot().baseVersion, 4);
  assert.equal(store.getSnapshot().form.title, "Keep my entered lesson");
});

test("stale candidate successes/failures cannot restore eligibility after authentication pause or disposal", async () => {
  for (const oldFails of [false, true])
    for (const currentFails of [false, true]) {
      const { store, api } = fixture();
      api.create = async () => {
        throw new AuthApiError("unavailable", "Creation uncertain");
      };
      store.create();
      store.field({ title: "Private entered text" });
      await store.save();
      await store.inspectCreation(id);
      const old = deferred();
      api.detail = () => old.promise;
      const pending = store.inspectCreation(id);
      store.pause(true);
      store.pause(false);
      api.detail = async () => {
        if (currentFails)
          throw new AuthApiError("unavailable", "Current inspection failed");
        return { ...lesson, id: resourceId, version: 3 };
      };
      await store.inspectCreation(resourceId);
      if (oldFails) old.reject(new Error("Old inspection failed"));
      else old.resolve({ ...lesson, version: 99 });
      await pending;
      assert.equal(store.getSnapshot().reconciled, !currentFails);
      assert.equal(
        store.getSnapshot().latest?.id ?? null,
        currentFails ? null : resourceId,
      );
      assert.equal(store.getSnapshot().editId, null);
      assert.equal(store.getSnapshot().baseVersion, null);
      assert.equal(store.getSnapshot().form.title, "Private entered text");
      const last = deferred();
      api.detail = () => last.promise;
      const disposed = store.inspectCreation(id);
      store.dispose();
      store.activate();
      last.resolve(lesson);
      await disposed;
      assert.deepEqual(store.getSnapshot(), initialLessonState);
    }
});

test("empty creation search has a separate explicit no-match choice; wrong-target inspection fails closed", async () => {
  const { store, api } = fixture();
  let writes = 0;
  api.create = async () => {
    writes++;
    throw new AuthApiError("unavailable", "Unknown result");
  };
  store.create();
  await store.save();
  await store.reconcile();
  store.acknowledge();
  await store.save();
  assert.equal(writes, 1);
  assert.ok(store.getSnapshot().creationListChecked);
  api.detail = async () => ({ ...lesson, id: resourceId });
  await store.inspectCreation(id);
  assert.equal(store.getSnapshot().reconciled, false);
  assert.equal(store.getSnapshot().latest, null);
  store.confirmCreationNotFound();
  assert.ok(store.getSnapshot().uncertain);
  await store.reconcile();
  store.confirmCreationNotFound();
  assert.equal(store.getSnapshot().uncertain, null);
  assert.equal(writes, 1, "explicit no-match choice never sends a write");
  assert.equal(store.getSnapshot().editId, null);
  assert.equal(store.getSnapshot().baseVersion, null);
});

test("read-only resource browsing is separate from editing, source saves retain unsaved introduction, and reload requires reopening", async () => {
  let persisted = null,
    writes = 0;
  const resource = {
    id: resourceId,
    title: "Fraction reference",
    subject: "Mathematics",
    grade: "Grade 4",
    sourceReference: "Original demonstration",
    contentText: "Resource introduction, read-only.",
    version: 1,
    retiredAt: null,
    createdAt: lesson.createdAt,
    updatedAt: lesson.updatedAt,
  };
  const reply = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const summary = (v) =>
    Object.fromEntries(
      Object.entries(v).filter(
        ([k]) =>
          ![
            "content",
            "sources",
            "generationOrigin",
            "sourceReference",
            "contentText",
          ].includes(k),
      ),
    );
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === "/resources")
      return reply({ items: [summary(resource)], nextAfter: null });
    if (path === `/resources/${resourceId}`) return reply(resource);
    if (options.method === "GET")
      return path === "/lessons"
        ? reply({
            items: persisted ? [summary(persisted)] : [],
            nextAfter: null,
          })
        : reply(persisted);
    const body = JSON.parse(options.body);
    writes++;
    if (path === "/lessons") {
      persisted = {
        ...lesson,
        title: body.content.title ?? "",
        content: body.content,
      };
      return reply(persisted, 201);
    }
    assert.equal(body.expectedVersion, persisted.version);
    if (options.method === "PUT")
      persisted = {
        ...persisted,
        content: body.content,
        title: body.content.title ?? "",
        version: persisted.version + 1,
      };
    else {
      const action = path.split("/").at(-1);
      const { title, subject, grade, sourceReference, contentText } = resource;
      persisted = {
        ...persisted,
        version: persisted.version + 1,
        sources:
          action === "remove"
            ? []
            : [
                {
                  resourceId,
                  resourceVersion: resource.version,
                  snapshot: {
                    title,
                    subject,
                    grade,
                    sourceReference,
                    contentText,
                  },
                },
              ],
      };
    }
    return reply(persisted);
  };
  const api = createLessonsApi("http://localhost:3001", fetcher);
  const resources = createResourcesApi("http://localhost:3001", fetcher);
  const store = createLessonsState(api, undefined, resources);
  await store.resources();
  await store.resource(resourceId);
  assert.equal(store.getSnapshot().form, null);
  await store.save();
  await store.source(resourceId, "select");
  assert.equal(writes, 0);
  store.create();
  store.field({
    title: "Fractions lesson",
    introduction: { text: "My introduction" },
  });
  assert.equal(hasUnsavedLessonContent(store.getSnapshot()), true);
  await store.save();
  assert.equal(hasUnsavedLessonContent(store.getSnapshot()), false);
  const savedId = store.getSnapshot().editId;
  store.field({
    introduction: { text: "Entered introduction not yet saved" },
    title: "Fractions lesson",
  });
  for (const action of ["select", "refresh", "remove"]) {
    if (action === "refresh") {
      resource.version++;
      resource.contentText = "New reference introduction";
    }
    await store.source(resourceId, action);
    assert.equal(
      store.getSnapshot().form.introduction.text,
      "Entered introduction not yet saved",
    );
    assert.equal(persisted.content.introduction.text, "My introduction");
    assert.equal(hasUnsavedLessonContent(store.getSnapshot()), true);
  }
  await store.save();
  assert.equal(hasUnsavedLessonContent(store.getSnapshot()), false);
  store.field({
    ...store.getSnapshot().form,
    introduction: { text: "Unsaved before page refresh" },
  });
  store.dispose();
  const reloaded = createLessonsState(api, undefined, resources);
  await reloaded.list();
  assert.equal(reloaded.getSnapshot().items[0].id, savedId);
  assert.equal(
    reloaded.getSnapshot().form,
    null,
    "page refresh does not silently open/adopt a draft",
  );
  await reloaded.view(savedId);
  assert.equal(
    reloaded.getSnapshot().form.introduction.text,
    "Entered introduction not yet saved",
  );
  assert.equal(hasUnsavedLessonContent(reloaded.getSnapshot()), false);
});

test("returning to drafts reads the authoritative first page and clears stale summaries while loading", async () => {
  const { api, store, calls } = fixture();
  const page = { items: [lesson], nextAfter: resourceId };
  api.list = async () => page;
  await store.list(resourceId);
  await store.view(id);
  store.field({ title: "Renamed draft" });
  await store.save();
  const read = deferred();
  api.list = (after, signal) => {
    calls.push(["list", after, signal]);
    return read.promise;
  };
  const returning = store.close();
  assert.equal(store.getSnapshot().form, null);
  assert.equal(store.getSnapshot().pending, "read");
  assert.deepEqual(store.getSnapshot().items, []);
  assert.equal(store.getSnapshot().nextAfter, null);
  assert.equal(calls.at(-1)[1], undefined);
  const confirmedPage = {
    items: [{ ...lesson, title: "Renamed draft", version: 2 }],
    nextAfter: id,
  };
  read.resolve(confirmedPage);
  await returning;
  assert.deepEqual(store.getSnapshot().items, confirmedPage.items);
  assert.equal(store.getSnapshot().nextAfter, id);
  assert.equal(store.getSnapshot().pending, null);
  assert.equal(calls.filter((call) => call[0] === "save").length, 1);
});

test("a returned-list failure stays a read failure and only an explicit list read recovers", async () => {
  const { api, store, calls } = fixture();
  await store.view(id);
  api.list = async () => {
    throw new AuthApiError("unavailable", "List unavailable");
  };
  await store.close();
  assert.equal(store.getSnapshot().error, "List unavailable");
  assert.equal(store.getSnapshot().uncertain, null);
  assert.equal(store.getSnapshot().pending, null);
  assert.deepEqual(store.getSnapshot().items, []);
  api.list = async () => ({ items: [lesson], nextAfter: null });
  await store.list();
  assert.equal(store.getSnapshot().error, null);
  assert.equal(store.getSnapshot().items[0].id, id);
  assert.equal(calls.length, 0);
});

test("returned-list success and failure cannot leak across pause or session disposal/replacement", async () => {
  for (const boundary of ["pause", "replace"])
    for (const failure of [false, true]) {
      let ended = 0;
      const { api, store } = fixture(() => {
        ended++;
      });
      await store.view(id);
      const late = deferred();
      let signal;
      api.list = (_after, value) => {
        signal = value;
        return late.promise;
      };
      const returning = store.close();
      let replacement;
      if (boundary === "pause") {
        store.pause(true);
        store.pause(false);
        api.list = async () => ({
          items: [{ ...lesson, title: "Current page" }],
          nextAfter: null,
        });
        await store.list();
      } else {
        store.dispose();
        replacement = fixture();
        replacement.api.list = async () => ({
          items: [{ ...lesson, title: "New session" }],
          nextAfter: null,
        });
        await replacement.store.list();
      }
      assert.equal(signal.aborted, true);
      if (failure) late.reject(new AuthApiError("unauthenticated", "Old 401"));
      else
        late.resolve({
          items: [{ ...lesson, title: "Stale page" }],
          nextAfter: resourceId,
        });
      await returning;
      const state = (replacement?.store ?? store).getSnapshot();
      assert.equal(
        state.items[0].title,
        boundary === "pause" ? "Current page" : "New session",
      );
      assert.equal(state.error, null);
      assert.equal(state.nextAfter, null);
      assert.equal(ended, 0, "A stale 401 must not end the current session");
      if (replacement)
        assert.deepEqual(store.getSnapshot(), initialLessonState);
    }
});

test("return refresh cannot discard or infer success for an uncertain creation or known write", async () => {
  for (const create of [true, false]) {
    const { api, store } = fixture();
    let reads = 0,
      writes = 0;
    if (create) store.create();
    else await store.view(id);
    store.field({ title: "Keep uncertain text" });
    api.list = async () => {
      reads++;
      return { items: [], nextAfter: null };
    };
    api[create ? "create" : "save"] = async () => {
      writes++;
      throw new AuthApiError("unavailable", "Unknown outcome");
    };
    await store.save();
    await store.close();
    assert.equal(store.getSnapshot().form.title, "Keep uncertain text");
    assert.ok(store.getSnapshot().uncertain);
    assert.equal(reads, 0);
    assert.equal(writes, 1);
  }
});

test("an interrupted return read is not a confirmed empty list and resumes only on explicit reload", async () => {
  const { api, store } = fixture();
  await store.view(id);
  const late = deferred();
  let reads = 0;
  api.list = async () => {
    reads++;
    return late.promise;
  };
  const returning = store.close();
  store.pause(true);
  late.resolve({ items: [], nextAfter: null });
  await returning;
  store.pause(false);
  assert.equal(store.getSnapshot().listLoaded, false);
  assert.equal(store.getSnapshot().pending, null);
  assert.equal(reads, 1);
  api.list = async () => {
    reads++;
    return { items: [], nextAfter: null };
  };
  await store.list();
  assert.equal(store.getSnapshot().listLoaded, true);
  assert.equal(reads, 2);
});
