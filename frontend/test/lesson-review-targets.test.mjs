import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthApiError } from "../src/lib/api-request.ts";
import {
  fixture,
  deferred,
  submitted,
  review,
} from "./support/review-fixture.mjs";

const lessonA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const lessonB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function twoLessons() {
  const f = fixture("ADMIN");
  const lessons = new Map(
    [lessonA, lessonB].map((lessonId, index) => {
      const revisions = Array.from({ length: 21 }, (_, i) => ({
        ...structuredClone(submitted.revision),
        id: `${index ? "bbbbbbbb-bbbb-4bbb-8bbb" : "aaaaaaaa-aaaa-4aaa-8aaa"}-${(i + 1).toString(16).padStart(12, "0")}`,
        number: i + 1,
        content: {
          ...structuredClone(submitted.revision.content),
          title: `${index ? "B" : "A"} revision ${i + 1}`,
        },
        review:
          i < 20
            ? { ...review, decision: "REQUEST_CHANGES", feedback: "Revise." }
            : null,
      }));
      return [
        lessonId,
        {
          workflow: {
            ...submitted.workflow,
            lessonId,
            currentRevisionId: revisions.at(-1).id,
          },
          revisions,
        },
      ];
    }),
  );
  const page = (id, after) => {
    const { workflow, revisions } = lessons.get(id);
    const remaining = revisions.filter((r) => !after || r.id > after);
    const items = remaining
      .slice(0, 20)
      .map(({ content, sources, ...metadata }) => {
        void sources;
        return { ...metadata, title: content.title };
      });
    return structuredClone({
      workflow,
      items,
      nextAfter: remaining.length > 20 ? items.at(-1).id : null,
    });
  };
  const detail = (id, target) => {
    const { workflow, revisions } = lessons.get(id);
    const revision = revisions.find((r) => r.id === target);
    assert.ok(revision, "detail target must belong to the requested lesson");
    return structuredClone({ workflow, revision });
  };
  f.api.history = async (id, after) => {
    f.calls.push(["history", id, after]);
    return page(id, after);
  };
  f.api.detail = async (id, target) => {
    f.calls.push(["detail", id, target]);
    return detail(id, target);
  };
  return Object.assign(f, {
    page,
    detail,
    revisionA: lessons.get(lessonA).revisions.at(-1).id,
    revisionB: lessons.get(lessonB).revisions.at(-1).id,
  });
}

test("R1: ownership and cursor guards preserve canonical UUID matching for uppercase inputs", async () => {
  const f = twoLessons();
  await f.store.detail(lessonA.toUpperCase(), f.revisionA.toUpperCase());
  await f.store.history(lessonA.toUpperCase());
  const history = f.store.getSnapshot().history;
  assert.equal(f.store.getSnapshot().lessonId, lessonA);
  assert.equal(history.workflow.lessonId, lessonA);
  assert.equal(f.store.getSnapshot().selected.revision.id, f.revisionA);
  await f.store.history(lessonA.toUpperCase(), history.nextAfter.toUpperCase());
  assert.deepEqual(f.calls.at(-1), ["history", lessonA, history.nextAfter]);
  assert.equal(f.store.getSnapshot().history.items[0].id, f.revisionA);
});

test("R1: A history is cleared immediately when inspecting B, whose links and pages use only B targets", async () => {
  const f = twoLessons();
  await f.store.detail(lessonA, f.revisionA);
  await f.store.history(lessonA);
  const cursorA = f.store.getSnapshot().history.nextAfter;
  const gate = deferred(),
    detail = f.api.detail;
  f.api.detail = async (...args) => {
    const result = await detail(...args);
    await gate.promise;
    return result;
  };
  const loading = f.store.detail(lessonB, f.revisionB);
  assert.equal(f.store.getSnapshot().lessonId, lessonB);
  assert.equal(f.store.getSnapshot().pending, "read");
  assert.equal(f.store.getSnapshot().history, null);
  assert.equal(f.store.getSnapshot().selected, null);
  gate.resolve();
  await loading;
  f.api.detail = detail;
  assert.equal(f.store.getSnapshot().history, null);
  const calls = f.calls.length;
  await f.store.history(lessonB, cursorA);
  assert.equal(
    f.calls.length,
    calls,
    "an obsolete cursor must not start a new lesson page",
  );
  await f.store.history(lessonB);
  const historyB = f.store.getSnapshot().history;
  assert.equal(historyB.workflow.lessonId, lessonB);
  assert.notEqual(historyB.nextAfter, cursorA);
  await f.store.detail(historyB.workflow.lessonId, historyB.items[0].id);
  assert.deepEqual(f.calls.at(-1), ["detail", lessonB, historyB.items[0].id]);
  await f.store.history(historyB.workflow.lessonId, historyB.nextAfter);
  assert.deepEqual(f.calls.at(-1), ["history", lessonB, historyB.nextAfter]);
  assert.deepEqual(
    f.store.getSnapshot().history.items.map((r) => r.id),
    [f.revisionB],
  );
});

for (const kind of ["history", "detail"]) {
  test(`R1: failed B ${kind} reads keep B loading/errors separate from A history`, async () => {
    const f = twoLessons();
    await f.store.detail(lessonA, f.revisionA);
    await f.store.history(lessonA);
    const gate = deferred();
    f.api[kind] = () => gate.promise;
    const loading =
      kind === "history"
        ? f.store.history(lessonB)
        : f.store.detail(lessonB, f.revisionB);
    assert.equal(f.store.getSnapshot().lessonId, lessonB);
    assert.equal(f.store.getSnapshot().history, null);
    assert.equal(f.store.getSnapshot().selected, null);
    gate.reject(
      new AuthApiError("rejected", "B is unavailable to this account."),
    );
    await loading;
    assert.equal(f.store.getSnapshot().pending, null);
    assert.equal(f.store.getSnapshot().lessonId, lessonB);
    assert.equal(f.store.getSnapshot().history, null);
    assert.equal(f.store.getSnapshot().selected, null);
    assert.equal(
      f.store.getSnapshot().error,
      "B is unavailable to this account.",
    );
  });
  for (const outcome of ["success", "unavailable", "unauthenticated"]) {
    test(`R1: delayed A ${kind} ${outcome} cannot repopulate B or end its session`, async () => {
      const f = twoLessons();
      await f.store.history(lessonA);
      const gate = deferred(),
        original = f.api[kind];
      let signal;
      f.api[kind] = (...args) => {
        if (args[0] !== lessonA) return original(...args);
        signal = args.at(-1);
        return gate.promise; // Deliberately ignores abort to exercise generation rejection.
      };
      const old =
        kind === "history"
          ? f.store.history(lessonA)
          : f.store.detail(lessonA, f.revisionA);
      await f.store.detail(lessonB, f.revisionB);
      await f.store.history(lessonB);
      assert.equal(f.store.getSnapshot().lessonId, lessonB);
      assert.equal(signal.aborted, true);
      const before = structuredClone(f.store.getSnapshot());
      if (outcome === "success")
        gate.resolve(
          kind === "history" ? f.page(lessonA) : f.detail(lessonA, f.revisionA),
        );
      else gate.reject(new AuthApiError(outcome, "Obsolete A failure"));
      await old;
      assert.deepEqual(f.store.getSnapshot(), before);
      assert.equal(f.ended, 0);
    });
  }
}

test("R1: late A completion cannot clear B's pending read, and same-lesson pagination retains detail", async () => {
  const f = twoLessons();
  const a = deferred(),
    b = deferred(),
    detail = f.api.detail;
  f.api.history = (id) =>
    id === lessonA ? a.promise : Promise.resolve(f.page(id));
  f.api.detail = (...args) =>
    args[0] === lessonB ? b.promise : detail(...args);
  const old = f.store.history(lessonA);
  const next = f.store.detail(lessonB, f.revisionB);
  a.resolve(f.page(lessonA));
  await old;
  assert.equal(f.store.getSnapshot().lessonId, lessonB);
  assert.equal(f.store.getSnapshot().pending, "read");
  assert.equal(f.store.getSnapshot().history, null);
  b.resolve(f.detail(lessonB, f.revisionB));
  await next;
  f.api.history = async (id, after) => {
    f.calls.push(["history", id, after]);
    return f.page(id, after);
  };
  await f.store.history(lessonB);
  const selected = structuredClone(f.store.getSnapshot().selected);
  const cursor = f.store.getSnapshot().history.nextAfter;
  await f.store.history(lessonB, cursor);
  assert.deepEqual(f.calls.at(-1), ["history", lessonB, cursor]);
  assert.equal(f.store.getSnapshot().history.items[0].number, 21);
  assert.equal(f.store.getSnapshot().history.nextAfter, null);
  assert.deepEqual(f.store.getSnapshot().selected, selected);
});

test("R1: target switches cannot discard comments or bypass confirmations, pending writes and uncertain recovery", async () => {
  const f = twoLessons();
  await f.store.detail(lessonA, f.revisionA);
  f.store.comments("Comments for A");
  await f.store.detail(lessonB, f.revisionB);
  assert.equal(f.store.getSnapshot().lessonId, lessonA);
  f.store.prepareReview("APPROVE");
  await f.store.detail(lessonB, f.revisionB, true);
  assert.equal(f.store.getSnapshot().lessonId, lessonA);
  const gate = deferred();
  f.api.review = () => gate.promise;
  const writing = f.store.confirm();
  await f.store.detail(lessonB, f.revisionB, true);
  assert.equal(f.store.getSnapshot().pending, "write");
  assert.equal(f.store.getSnapshot().lessonId, lessonA);
  gate.reject(new AuthApiError("unavailable", "Lost write response"));
  await writing;
  await f.store.detail(lessonB, f.revisionB, true);
  await f.store.history(lessonB);
  assert.equal(f.store.getSnapshot().lessonId, lessonA);
  assert.equal(f.store.getSnapshot().comments, "Comments for A");
  assert.equal(f.store.getSnapshot().uncertain.revisionId, f.revisionA);
  await f.store.recover();
  assert.deepEqual(f.calls.at(-1), ["detail", lessonA, f.revisionA]);
  assert.ok(f.store.getSnapshot().uncertain);
});
