import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthApiError } from "../src/lib/api-request.ts";
import {
  fixture,
  key,
  nextKey,
  intent,
  receipt,
  lessonId,
  revisionId,
  otherId,
  destination,
} from "./support/library-fixture.mjs";
import { deferred } from "./support/review-fixture.mjs";

async function ready(f) {
  await f.store.detail(lessonId, revisionId);
}
test("both roles browse cursor pages and read exact library targets; administrators cannot copy or recover", async () => {
  for (const role of ["TEACHER", "ADMIN"]) {
    const f = fixture(role);
    f.api.browse = async (after) => {
      f.calls.push(["browse", after]);
      return { items: [], nextAfter: after ? null : otherId };
    };
    await f.store.browse();
    await f.store.browse(otherId);
    await ready(f);
    assert.deepEqual(f.calls, [
      ["browse", undefined],
      ["browse", otherId],
      ["detail", lessonId, revisionId],
    ]);
    if (role === "ADMIN") {
      await f.store.copy();
      await f.store.check(key);
      await f.store.retry(key);
      assert.equal(f.keys, 0);
      assert.equal(f.store.getSnapshot().operations.length, 0);
    }
  }
});
test("retains original identity before POST; lost response, 404 then receipt resolves original destination", async () => {
  const f = fixture();
  await ready(f);
  f.api.copy = async (i) => {
    assert.deepEqual(f.store.getSnapshot().operations[0].intent, intent);
    f.calls.push(["copy", i]);
    throw new AuthApiError("unavailable", "Response lost");
  };
  await f.store.copy();
  f.api.lookup = async () => null;
  await f.store.check(key);
  assert.match(f.store.getSnapshot().operations[0].message, /404.*unresolved/);
  await f.store.copy();
  assert.equal(f.keys, 1);
  f.api.lookup = async () => receipt;
  await f.store.check(key);
  assert.deepEqual(f.store.getSnapshot().operations[0].receipt, receipt);
  assert.equal(f.calls.filter((c) => c[0] === "copy").length, 1);
  assert.ok(!f.calls.some((c) => c[0] === "history"));
});
test("explicit same-key retry replays original parameters despite a new source version; deliberate new copy uses new key", async () => {
  const f = fixture();
  await ready(f);
  const original = f.api.copy;
  f.api.copy = async (i) => {
    f.calls.push(["copy", i]);
    throw new AuthApiError("unavailable", "Lost");
  };
  await f.store.copy();
  const source = f.store.getSnapshot().detail;
  f.api.detail = async () => ({
    ...source,
    workflow: { ...source.workflow, version: 15 },
  });
  await ready(f);
  f.api.copy = original;
  await f.store.retry(key);
  const copies = f.calls.filter((c) => c[0] === "copy");
  assert.deepEqual(
    copies.map((c) => c[1]),
    [intent, intent],
  );
  assert.equal(f.keys, 1);
  await f.store.copy();
  assert.equal(f.keys, 2);
  assert.equal(f.store.getSnapshot().operations[1].intent.key, nextKey);
  assert.equal(
    f.store.getSnapshot().operations[1].intent.source.expectedVersion,
    15,
  );
});
test("invalid receipts and 409 remain unresolved without rebase, replacement key or automatic retry", async () => {
  for (const outcome of [
    { ...receipt, key: nextKey },
    { ...receipt, source: { ...intent.source, expectedVersion: 7 } },
    { ...receipt, destinationLessonId: lessonId },
    new AuthApiError("conflict", "Copy conflict"),
  ]) {
    const f = fixture();
    await ready(f);
    f.api.copy = async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    };
    await f.store.copy();
    assert.equal(f.store.getSnapshot().operations[0].receipt, null);
    assert.deepEqual(f.store.getSnapshot().operations[0].intent, intent);
    assert.match(f.store.getSnapshot().operations[0].message, /unresolved/);
    await f.store.copy();
    assert.equal(f.keys, 1);
  }
});
test("unconfirmed auth pauses all actions and ignores late responses; session disposal isolates same-user new sessions", async () => {
  for (const dispose of [false, true]) {
    const f = fixture();
    await ready(f);
    const held = deferred();
    f.api.copy = () => held.promise;
    const copying = f.store.copy();
    if (dispose) f.store.dispose();
    else f.store.pause(true);
    held.resolve(receipt);
    await copying;
    assert.equal(f.store.getSnapshot().operations[0]?.receipt ?? null, null);
    const count = f.calls.length;
    await f.store.check(key);
    await f.store.retry(key);
    await f.store.browse();
    assert.equal(f.calls.length, count);
    if (!dispose) {
      f.store.pause(false);
      await f.store.check(key);
      assert.deepEqual(f.store.getSnapshot().operations[0].receipt, receipt);
    } else assert.equal(f.store.getSnapshot().operations.length, 0);
  }
});
test("401 ends session and cannot publish a destination; old lookup and destination reads are ignored", async () => {
  const f = fixture();
  await ready(f);
  f.api.copy = async () => {
    throw new AuthApiError("unauthenticated", "Ended");
  };
  await f.store.copy();
  assert.equal(f.ended, 1);
  for (const kind of ["lookup", "destination"]) {
    const g = fixture();
    await ready(g);
    if (kind === "lookup") {
      g.api.copy = async () => {
        throw new Error("lost");
      };
      await g.store.copy();
      const held = deferred();
      g.api.lookup = () => held.promise;
      const read = g.store.check(key);
      g.store.dispose();
      held.resolve(receipt);
      await read;
    } else {
      await g.store.copy();
      const held = deferred();
      g.history.history = () => held.promise;
      const read = g.store.inspectDestination(key);
      g.store.pause(true);
      held.resolve({ workflow: g.workflow });
      await read;
    }
    assert.equal(g.store.getSnapshot().destination, null);
  }
});
test("receipt triggers no draft assumption: history decides editable or submitted/approved destination", async () => {
  for (const state of ["DRAFT", "CHANGES_REQUESTED", "SUBMITTED", "APPROVED"]) {
    const f = fixture();
    await ready(f);
    await f.store.copy();
    f.workflow.state = state;
    f.workflow.currentRevisionId = state === "DRAFT" ? null : revisionId;
    f.destination.state = state;
    await f.store.inspectDestination(key);
    const result = f.store.getSnapshot().destination;
    assert.equal(result.workflow.state, state);
    const reads = f.calls.filter((c) =>
      ["history", "draft", "revision"].includes(c[0]),
    );
    assert.deepEqual(
      reads.map((c) => c[0]),
      [
        "history",
        ["DRAFT", "CHANGES_REQUESTED"].includes(state) ? "draft" : "revision",
        "history",
      ],
    );
    assert.ok(reads.every((c) => c[1] === otherId));
  }
});
test("destination races require explicit reread and never adopt a version or replace entered content", async () => {
  const f = fixture();
  await ready(f);
  await f.store.copy();
  let reads = 0;
  f.history.history = async () => ({
    workflow: { ...f.workflow, version: ++reads === 1 ? 1 : 2 },
  });
  await f.store.inspectDestination(key);
  assert.equal(f.store.getSnapshot().destination, null);
  assert.match(f.store.getSnapshot().error, /Read current destination again/);
  await f.drafts.view(otherId);
  f.drafts.field({ title: "Unsaved destination work" });
  assert.equal(f.drafts.openLibraryDestination(destination), true);
  assert.equal(f.drafts.getSnapshot().form.title, "Unsaved destination work");
  assert.equal(
    f.drafts.openLibraryDestination({ ...destination, id: lessonId }),
    false,
  );
  assert.equal(f.drafts.getSnapshot().form.title, "Unsaved destination work");
});
test("failed exact detail cannot leave an earlier revision actionable", async () => {
  const f = fixture();
  await ready(f);
  f.api.detail = async () => {
    throw new Error("unavailable");
  };
  await f.store.detail(otherId, revisionId);
  await f.store.copy();
  assert.equal(f.store.getSnapshot().detail, null);
  assert.equal(f.keys, 0);
});

test("destination detail failure after history preserves receipt and asks for workflow reconciliation", async () => {
  const f = fixture();
  await ready(f);
  await f.store.copy();
  f.draftApi.detail = async () => {
    throw new AuthApiError("conflict", "No longer editable");
  };
  await f.store.inspectDestination(key);
  assert.equal(f.store.getSnapshot().destination, null);
  assert.deepEqual(f.store.getSnapshot().operations[0].receipt, receipt);
  assert.match(f.store.getSnapshot().notice, /Read current destination again/);
  f.store.pause(true);
  f.store.pause(false);
  assert.equal(f.store.getSnapshot().notice, null);
});
