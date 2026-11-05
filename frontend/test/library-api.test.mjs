import assert from "node:assert/strict";
import { test } from "node:test";
import { createLibraryApi } from "../src/lib/library-api.ts";
import { response } from "./support/review-fixture.mjs";
import {
  detail,
  summary,
  intent,
  receipt,
  lessonId,
  revisionId,
  otherId,
  key,
} from "./support/library-fixture.mjs";
const base = "http://localhost:3001";
test("library transport uses exact routes, cursor, statuses, credentials and retained write parameters", async () => {
  const calls = [];
  const api = createLibraryApi(base, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/copy"))
      return response({ operation: receipt }, calls.length === 3 ? 201 : 200);
    if (url.includes("copy-operations"))
      return response({ operation: receipt });
    if (url.includes("?")) return response({ items: [], nextAfter: null });
    return response(detail);
  });
  await api.browse(otherId);
  await api.detail(lessonId.toUpperCase(), revisionId.toUpperCase());
  assert.deepEqual(await api.copy(intent), receipt);
  assert.deepEqual(await api.copy(intent), receipt);
  assert.deepEqual(await api.lookup(intent), receipt);
  assert.deepEqual(
    calls.map((c) => new URL(c.url).pathname),
    [
      "/library/approved",
      `/library/approved/${lessonId}/revisions/${revisionId}`,
      `/lessons/${lessonId}/revisions/${revisionId}/copy`,
      `/lessons/${lessonId}/revisions/${revisionId}/copy`,
      `/library/copy-operations/${key}`,
    ],
  );
  assert.equal(new URL(calls[0].url).search, `?limit=20&after=${otherId}`);
  for (const { options } of calls) {
    assert.equal(options.credentials, "include");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
  }
  for (const c of calls.slice(2, 4)) {
    assert.deepEqual(JSON.parse(c.options.body), {
      operationKey: key,
      expectedVersion: 6,
    });
    assert.equal(c.options.headers["X-LessonForge-CSRF"], "1");
  }
});
test("both 201 and 200 receipts reject wrong key/source/version/destination, private fields and invalid bodies", async () => {
  for (const status of [200, 201])
    for (const operation of [
      { ...receipt, key: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
      { ...receipt, source: { ...intent.source, lessonId: otherId } },
      { ...receipt, source: { ...intent.source, revisionId: otherId } },
      { ...receipt, source: { ...intent.source, expectedVersion: 7 } },
      { ...receipt, destinationLessonId: "bad" },
      { ...receipt, destinationLessonId: lessonId },
      { ...receipt, draft: {} },
    ])
      await assert.rejects(
        createLibraryApi(base, async () =>
          response({ operation }, status),
        ).copy(intent),
        { reason: "invalid-response" },
      );
  for (const status of [202, 204])
    await assert.rejects(
      createLibraryApi(base, async () =>
        status === 204
          ? new Response(null, { status })
          : response({ operation: receipt }, status),
      ).copy(intent),
      { reason: "invalid-response" },
    );
  await assert.rejects(
    createLibraryApi(
      base,
      async () =>
        new Response("{", {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    ).copy(intent),
    { reason: "invalid-response" },
  );
});
test("lookup 404 is unresolved and later 200 must match original operation; copy 404 is a rejection", async () => {
  let status = 404;
  const api = createLibraryApi(base, async () =>
    response(
      status === 404 ? { private: "hidden" } : { operation: receipt },
      status,
    ),
  );
  assert.equal(await api.lookup(intent), null);
  await assert.rejects(api.copy(intent), { reason: "rejected" });
  status = 200;
  assert.deepEqual(await api.lookup(intent), receipt);
  await assert.rejects(
    createLibraryApi(base, async () =>
      response({ operation: { ...receipt, key: otherId } }),
    ).lookup(intent),
    { reason: "invalid-response" },
  );
});
test("exact approved reads reject mismatched/private data and preserve origin and snapshot text verbatim", async () => {
  const api = createLibraryApi(base, async () => response(detail));
  assert.deepEqual(await api.detail(lessonId, revisionId), detail);
  for (const value of [
    { ...detail, ownerId: otherId },
    { ...detail, revision: { ...detail.revision, review: {} } },
    { ...detail, workflow: { ...detail.workflow, state: "DRAFT" } },
    { ...detail, workflow: { ...detail.workflow, lessonId: otherId } },
    { ...detail, revision: { ...detail.revision, id: otherId } },
    { ...detail, revision: { ...detail.revision, sources: [] } },
  ])
    await assert.rejects(
      createLibraryApi(base, async () => response(value)).detail(
        lessonId,
        revisionId,
      ),
      { reason: "invalid-response" },
    );
});
test("cursor pages accept UUID order only, next cursor bound to page and exclusive after", async () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    ...summary,
    workflow: {
      ...summary.workflow,
      lessonId: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    },
  }));
  const page = { items, nextAfter: items.at(-1).workflow.lessonId };
  assert.deepEqual(
    await createLibraryApi(base, async () => response(page)).browse(),
    page,
  );
  for (const value of [
    { items: [summary, summary], nextAfter: null },
    { items: [summary], nextAfter: lessonId },
    { ...page, nextAfter: otherId },
    { items: [summary], nextAfter: null, ownerId: otherId },
  ])
    await assert.rejects(
      createLibraryApi(base, async () => response(value)).browse(),
      { reason: "invalid-response" },
    );
  await assert.rejects(
    createLibraryApi(base, async () =>
      response({ items: [summary], nextAfter: null }),
    ).browse(lessonId),
    { reason: "invalid-response" },
  );
});
test("401/403/409/503 are not receipts and never parse private error content", async () => {
  for (const [status, reason] of [
    [401, "unauthenticated"],
    [403, "rejected"],
    [409, "conflict"],
    [503, "unavailable"],
  ])
    await assert.rejects(
      createLibraryApi(base, async () =>
        response({ secret: "hidden" }, status),
      ).copy(intent),
      (e) => e.reason === reason && !e.message.includes("hidden"),
    );
});
