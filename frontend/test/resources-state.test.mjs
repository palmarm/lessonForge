import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthApiError } from "../src/lib/api-request.ts";
import {
  createResourcesState,
  initialResourceState,
} from "../src/lib/resources-state.ts";
const id = "11111111-1111-4111-8111-111111111111";
const resource = {
  id,
  title: "Original",
  subject: "Mathematics",
  grade: "Grade 4",
  sourceReference: "Original demonstration",
  contentText: "One half.",
  version: 1,
  retiredAt: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function fixture(role = "ADMIN", sessionEnded) {
  const calls = [];
  const api = {
    list: async () => ({ items: [], nextAfter: null }),
    detail: async () => resource,
    create: async (...args) => {
      calls.push(args);
      return resource;
    },
    edit: async (...args) => {
      calls.push(args);
      return { ...resource, version: 2 };
    },
    retire: async (...args) => {
      calls.push(args);
      return { ...resource, version: 2, retiredAt: resource.updatedAt };
    },
  };
  return { api, calls, store: createResourcesState(api, role, sessionEnded) };
}
test("authentication pause retains admin edits, invalidates late writes and requires exact reconciliation", async () => {
  for (const fails of [false, true]) {
    const { store, api } = fixture();
    await store.view(id);
    store.edit();
    store.field("title", "Retained admin text");
    const late = deferred();
    let writes = 0;
    api.edit = () => { writes++; return late.promise; };
    const writing = store.save();
    store.pause(true);
    assert.deepEqual(store.getSnapshot().uncertain, { type: "edit", targetId: id });
    assert.equal(store.getSnapshot().pending, null);
    store.field("title", "Must not change");
    store.cancel();
    store.useLatestVersion();
    store.acknowledge();
    await store.save();
    await store.reconcile();
    assert.equal(store.getSnapshot().reconciled, false);
    store.pause(false);
    if (fails) late.reject(new Error("Old failure"));
    else late.resolve({ ...resource, title: "Old success", version: 2 });
    await writing;
    assert.equal(store.getSnapshot().form.title, "Retained admin text");
    assert.equal(store.getSnapshot().baseVersion, 1);
    await store.save();
    assert.equal(writes, 1);
    await store.list();
    assert.equal(store.getSnapshot().reconciled, false);
    await store.reconcile();
    assert.equal(store.getSnapshot().reconciled, true);
    store.pause(true);
    store.acknowledge();
    store.pause(false);
    assert.equal(store.getSnapshot().reconciled, false);
    assert.ok(store.getSnapshot().uncertain);
    await store.reconcile();
    store.acknowledge();
    assert.equal(store.getSnapshot().uncertain, null);
  }
});

test("authentication pause invalidates late admin reads and identity disposal rejects their results", async () => {
  for (const dispose of [false, true]) {
    const { store, api } = fixture();
    const late = deferred();
    api.detail = () => late.promise;
    const reading = store.view(id);
    if (dispose) store.dispose();
    else { store.pause(true); store.pause(false); }
    late.resolve(resource);
    await reading;
    assert.equal(store.getSnapshot().selected, null);
  }
});

test("a failed ordinary list read revokes earlier uncertainty acknowledgement eligibility", async () => {
  const { store, api } = fixture();
  store.create();
  api.create = async () => { throw new AuthApiError("unavailable", "Unknown outcome"); };
  await store.save();
  await store.reconcile();
  assert.equal(store.getSnapshot().reconciled, true);
  api.list = async () => { throw new AuthApiError("unavailable", "Read failed"); };
  await store.list();
  store.acknowledge();
  assert.equal(store.getSnapshot().reconciled, false);
  assert.ok(store.getSnapshot().uncertain);
});
test("teacher state browses, prevents mutations, and refuses retired response data", async () => {
  const { store, api, calls } = fixture("TEACHER");
  await store.view(id);
  assert.equal(store.getSnapshot().selected, resource);
  store.create();
  store.edit();
  await store.save();
  await store.retire();
  assert.equal(calls.length, 0);
  api.detail = async () => ({ ...resource, retiredAt: resource.updatedAt });
  await store.view(id);
  assert.ok(store.getSnapshot().error);
  api.list = async () => ({
    items: [{ ...resource, retiredAt: resource.updatedAt }],
    nextAfter: null,
  });
  await store.list();
  assert.equal(store.getSnapshot().items.length, 0);
});
test("edits survive validation/conflict/availability errors; reconciliation requires explicit rebase and retry", async () => {
  for (const reason of [
    "rejected",
    "conflict",
    "unavailable",
    "invalid-response",
  ]) {
    const { store, api } = fixture();
    let writes = 0;
    await store.view(id);
    store.edit();
    store.field("title", "My entered text");
    api.edit = async () => {
      writes++;
      throw new AuthApiError(reason, "Safe failure");
    };
    await store.save();
    assert.equal(store.getSnapshot().form.title, "My entered text");
    assert.equal(store.getSnapshot().baseVersion, 1);
    api.detail = async () => ({
      ...resource,
      title: "Another admin's text",
      version: 2,
    });
    await store.reconcile();
    assert.equal(store.getSnapshot().form.title, "My entered text");
    assert.equal(store.getSnapshot().baseVersion, 1);
    const uncertain = ["unavailable", "invalid-response"].includes(reason);
    assert.deepEqual(
      store.getSnapshot().uncertain,
      uncertain ? { type: "edit", targetId: id } : null,
    );
    if (uncertain) {
      await store.save();
      assert.equal(writes, 1);
      store.acknowledge();
    }
    store.useLatestVersion();
    assert.equal(store.getSnapshot().baseVersion, 2);
    api.edit = async (_key, version, content) => {
      assert.equal(version, 2);
      return { ...resource, ...content, version: 3 };
    };
    await store.save();
    assert.equal(store.getSnapshot().selected.title, "My entered text");
    assert.equal(store.getSnapshot().form, null);
  }
});
test("uncertain creates cannot be retried or discarded until explicit reconciliation; draft text is retained", async () => {
  const { api, store } = fixture();
  let writes = 0;
  api.create = async () => {
    writes++;
    throw new AuthApiError("unavailable", "May have completed");
  };
  store.create();
  store.field("title", "My new resource");
  await store.save();
  store.cancel();
  store.create();
  store.acknowledge();
  await store.save();
  assert.equal(writes, 1);
  assert.equal(store.getSnapshot().form.title, "My new resource");
  api.list = async () => ({ items: [resource], nextAfter: null });
  await store.reconcile();
  await store.view(id);
  assert.equal(store.getSnapshot().selected, resource);
  assert.equal(store.getSnapshot().form.title, "My new resource");
  store.acknowledge();
  store.cancel();
  assert.equal(store.getSnapshot().form, null);
});
test("retirement keeps its original precondition; uncertain retirement loads detail before allowing further writes", async () => {
  const { api, store } = fixture();
  await store.view(id);
  let writes = 0;
  api.retire = async (key, version) => {
    writes++;
    assert.equal(key, id);
    assert.equal(version, 1);
    throw new AuthApiError("unavailable", "Uncertain");
  };
  await store.retire();
  await store.retire();
  assert.equal(writes, 1);
  api.detail = async () => ({
    ...resource,
    version: 2,
    retiredAt: resource.updatedAt,
  });
  await store.reconcile();
  assert.equal(store.getSnapshot().selected.retiredAt, resource.updatedAt);
  store.acknowledge();
  store.edit();
  assert.equal(store.getSnapshot().form, null);
});
test("resource state ignores out-of-order reads, prior-user successes/failures, and repeated effect requests", async () => {
  const { api, store } = fixture();
  const a = deferred();
  const b = deferred();
  api.detail = () => a.promise;
  const old = store.view(id);
  api.detail = () => b.promise;
  const newer = store.view(id);
  b.resolve({ ...resource, version: 2 });
  await newer;
  a.resolve(resource);
  await old;
  assert.equal(store.getSnapshot().selected.version, 2);
  const late = deferred();
  let signal;
  api.detail = (_id, s) => {
    signal = s;
    return late.promise;
  };
  const pending = store.view(id);
  store.dispose();
  assert.equal(signal.aborted, true);
  assert.deepEqual(store.getSnapshot(), initialResourceState);
  store.activate();
  await store.list();
  late.reject(new Error("old user failure"));
  await pending;
  assert.equal(store.getSnapshot().error, null);
  assert.equal(store.getSnapshot().selected, null);
});
test("pending writes cannot overlap reads or writes and cannot update a later identity workspace", async () => {
  const { api, store } = fixture();
  const late = deferred();
  let calls = 0;
  api.create = () => {
    calls++;
    return late.promise;
  };
  store.create();
  store.field("title", "Old user's private text");
  const pending = store.save();
  await store.save();
  await store.list();
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot().pending, "write");
  store.dispose();
  const next = fixture("TEACHER").store;
  await next.list();
  late.resolve(resource);
  await pending;
  assert.deepEqual(store.getSnapshot(), initialResourceState);
  assert.equal(next.getSnapshot().form, null);
  assert.equal(next.getSnapshot().selected, null);
});
test("confirmed 401 requests session reconciliation, while availability errors retain resource edits", async () => {
  let ended = 0;
  const { api, store } = fixture("ADMIN", () => ended++);
  store.create();
  store.field("title", "Retained");
  api.create = async () => {
    throw new AuthApiError("unauthenticated", "Session ended");
  };
  await store.save();
  assert.equal(ended, 1);
  assert.equal(store.getSnapshot().form.title, "Retained");
});
test("subscriptions stop on unsubscribe and successful saves do not perform implicit follow-up writes", async () => {
  const { store, calls } = fixture();
  let count = 0;
  const off = store.subscribe(() => count++);
  store.create();
  store.field("title", "Entered");
  off();
  const before = count;
  await store.save();
  assert.equal(count, before);
  assert.equal(calls.length, 1);
  assert.equal(store.getSnapshot().form, null);
});
