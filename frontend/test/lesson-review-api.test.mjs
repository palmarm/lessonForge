import assert from "node:assert/strict";
import { test } from "node:test";
import { createReviewApi } from "../src/lib/lesson-review-api.ts";
import { lessonId, revisionId, otherId, submitted, review, response, stamp } from "./support/review-fixture.mjs";

test("workflow requests use exact owned/revision routes, credentials, CSRF, statuses and preconditions", async () => {
  const calls = [];
  const api = createReviewApi("http://localhost:3001", async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/reviews/pending")) return response({ items: [], nextAfter: null });
    if (url.includes("?")) return response({ workflow: submitted.workflow, items: [], nextAfter: null });
    const body = options.body && JSON.parse(options.body);
    if (url.endsWith("/review")) return response({ workflow: { ...submitted.workflow, version: 6, state: "APPROVED" }, revision: { ...submitted.revision, review } }, 201);
    return response(submitted, body ? 201 : 200);
  });
  await api.history(lessonId); await api.detail(lessonId, revisionId); await api.pending(otherId); await api.submit(lessonId, 4); await api.review(lessonId, revisionId, 5, "APPROVE", "");
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [`/lessons/${lessonId}/revisions`, `/lessons/${lessonId}/revisions/${revisionId}`, "/reviews/pending", `/lessons/${lessonId}/submit`, `/lessons/${lessonId}/revisions/${revisionId}/review`]);
  assert.equal(new URL(calls[2].url).search, `?limit=20&after=${otherId}`);
  assert.deepEqual(JSON.parse(calls[3].options.body), { expectedVersion: 4 });
  assert.deepEqual(JSON.parse(calls[4].options.body), { expectedVersion: 5, decision: "APPROVE", feedback: "" });
  for (const { options } of calls) {
    assert.equal(options.credentials, "include"); assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error");
    if (options.body) assert.equal(options.headers["X-LessonForge-CSRF"], "1");
  }
});
test("mutation success validates exact status, target, resulting state and incremented version", async () => {
  for (const value of [
    { ...submitted, workflow: { ...submitted.workflow, lessonId: otherId } },
    { ...submitted, workflow: { ...submitted.workflow, version: 7 } },
    { ...submitted, workflow: { ...submitted.workflow, state: "APPROVED" } },
    { ...submitted, revision: { ...submitted.revision, ownerId: otherId } },
    { ...submitted, revision: { ...submitted.revision, sources: [] } },
  ]) await assert.rejects(createReviewApi("http://localhost:3001", async () => response(value, 201)).submit(lessonId, 4), { reason: "invalid-response" });
  await assert.rejects(createReviewApi("http://localhost:3001", async () => response(submitted, 200)).submit(lessonId, 4), { reason: "invalid-response" });
  const wrongRevision = { workflow: { ...submitted.workflow, version: 6, state: "APPROVED", currentRevisionId: otherId }, revision: { ...submitted.revision, id: otherId, review } };
  await assert.rejects(createReviewApi("http://localhost:3001", async () => response(wrongRevision, 201)).review(lessonId, revisionId, 5, "APPROVE", ""), { reason: "invalid-response" });
});
test("detail accepts historical revision alongside newer current workflow and keeps original snapshots", async () => {
  const historical = { workflow: { ...submitted.workflow, version: 12, currentRevisionId: otherId }, revision: { ...submitted.revision, review: { ...review, decision: "REQUEST_CHANGES", feedback: "Explain." } } };
  const result = await createReviewApi("http://localhost:3001", async () => response(historical)).detail(lessonId, revisionId);
  assert.deepEqual(result, historical);
  assert.equal(result.revision.sources[0].snapshot.contentText, "Historical equal parts text.");
});
test("detail rejects wrong revision, malformed/extra private fields, source text and review metadata", async () => {
  for (const value of [
    { ...submitted, draftContent: {} },
    { ...submitted, revision: { ...submitted.revision, id: otherId } },
    { ...submitted, revision: { ...submitted.revision, content: { title: "x", unknown: true } } },
    { ...submitted, revision: { ...submitted.revision, submittedAt: "yesterday" } },
    { ...submitted, revision: { ...submitted.revision, sources: [{ ...submitted.revision.sources[0], snapshot: { title: "Forged" } }] } },
    { ...submitted, workflow: { ...submitted.workflow, state: "CHANGES_REQUESTED" } },
    { ...submitted, revision: { ...submitted.revision, review: { ...review, reviewerId: "bad" } } },
  ]) await assert.rejects(createReviewApi("http://localhost:3001", async () => response(value)).detail(lessonId, revisionId), { reason: "invalid-response" });
});
test("history and pending pagination accept only authoritative ordered pages and matching current metadata", async () => {
  const summary = { id: revisionId, number: 1, title: "Historical", generationOrigin: "MANUAL", submittedAt: stamp, review: null };
  const pending = { workflow: submitted.workflow, revision: summary };
  const history = { workflow: submitted.workflow, items: [summary], nextAfter: null };
  assert.deepEqual(await createReviewApi("http://localhost:3001", async () => response(history)).history(lessonId), history);
  for (const page of [
    { ...history, items: [summary, summary] }, { ...history, nextAfter: revisionId },
    { ...history, items: [], nextAfter: revisionId }, { ...history, workflow: { ...submitted.workflow, lessonId: otherId } },
    { ...history, items: [{ ...summary, content: {} }] },
  ]) await assert.rejects(createReviewApi("http://localhost:3001", async () => response(page)).history(lessonId), { reason: "invalid-response" });
  assert.deepEqual((await createReviewApi("http://localhost:3001", async () => response({ items: [pending], nextAfter: null })).pending()).items, [pending]);
  for (const item of [
    { ...pending, workflow: { ...pending.workflow, currentRevisionId: otherId } },
    { ...pending, revision: { ...summary, review } },
    { ...pending, ownerId: otherId },
  ]) await assert.rejects(createReviewApi("http://localhost:3001", async () => response({ items: [item], nextAfter: null })).pending(), { reason: "invalid-response" });
});
test("unknown/foreign target and forbidden/conflict errors are safe and do not parse private bodies", async () => {
  for (const [status, reason] of [[400, "rejected"], [401, "unauthenticated"], [403, "rejected"], [404, "rejected"], [409, "conflict"], [503, "unavailable"]]) {
    await assert.rejects(createReviewApi("http://localhost:3001", async () => response({ private: "secret" }, status)).review(lessonId, revisionId, 5, "APPROVE", "kept"), (error) => error.reason === reason && !error.message.includes("secret"));
  }
});
test("invalid destination/identifiers fail before fetch and streaming mutations time out without retry", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return response(submitted); };
  assert.throws(() => createReviewApi("http://localhost:3001", fetcher).detail("bad", revisionId), { reason: "rejected" });
  await assert.rejects(createReviewApi("https://other.test/path", fetcher).pending(), { reason: "configuration" });
  assert.equal(calls, 0);
  const stalled = createReviewApi("http://localhost:3001", async () => { calls++; return new Response(new ReadableStream({ start() {} }), { status: 201, headers: { "Content-Type": "application/json" } }); }, 5);
  await assert.rejects(stalled.submit(lessonId, 4), { reason: "unavailable" });
  assert.equal(calls, 1);
});
