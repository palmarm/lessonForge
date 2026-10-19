import assert from "node:assert/strict";
import { test } from "node:test";
import { createLessonsApi } from "../src/lib/lessons-api.ts";
import { AuthApiError } from "../src/lib/api-request.ts";
export const id = "11111111-1111-4111-8111-111111111111";
export const resourceId = "22222222-2222-4222-8222-222222222222";
export const lesson = {
  id,
  title: "Fractions",
  version: 1,
  state: "DRAFT",
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
  content: { title: "Fractions", materials: [], activities: [{}] },
  sources: [],
  generationOrigin: "MANUAL",
};
export const response = (v, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
test("draft transport uses credentials, CSRF, no-store and exact content/version/source contracts", async () => {
  const calls = [];
  const api = createLessonsApi(
    "http://localhost:3001",
    async (url, options) => {
      calls.push({ url, options });
      const body = options.body ? JSON.parse(options.body) : null;
      if (url.includes("?"))
        return response({
          items: [
            {
              id,
              title: lesson.title,
              version: 1,
              state: "DRAFT",
              createdAt: lesson.createdAt,
              updatedAt: lesson.updatedAt,
            },
          ],
          nextAfter: null,
        });
      return response(
        {
          ...lesson,
          version: body?.expectedVersion ? body.expectedVersion + 1 : 1,
        },
        url.endsWith("/lessons") ? 201 : 200,
      );
    },
  );
  await api.list();
  await api.detail(id);
  await api.create(lesson.content);
  await api.save(id, 1, lesson.content);
  for (const action of ["select", "remove", "refresh"])
    await api.source(id, 1, resourceId, action);
  assert.equal(calls.length, 7);
  for (const { options } of calls) {
    assert.equal(options.credentials, "include");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    if (options.body) assert.equal(options.headers["X-LessonForge-CSRF"], "1");
  }
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    content: lesson.content,
  });
  assert.equal(calls[3].options.method, "PUT");
  for (const call of calls.slice(4))
    assert.deepEqual(JSON.parse(call.options.body), { expectedVersion: 1 });
});
test("draft response validation rejects malformed content, forged metadata, identity/version mismatches and bad pages", async () => {
  for (const patch of [
    { content: { sources: [] } },
    { content: { activities: [{ durationMinutes: "1" }] } },
    { content: { title: null } },
    { ownerId: id },
    { version: 0 },
    { state: "APPROVED" },
    { title: "Different" },
    { sources: [{ resourceId, resourceVersion: 1, snapshot: {} }] },
    { createdAt: "yesterday" },
    { id: resourceId },
  ]) {
    const api = createLessonsApi("http://localhost:3001", async () =>
      response({ ...lesson, ...patch }),
    );
    await assert.rejects(
      api.detail(id),
      (e) => e instanceof AuthApiError && e.reason === "invalid-response",
    );
  }
  const api = createLessonsApi("http://localhost:3001", async () =>
    response(lesson),
  );
  await assert.rejects(api.save(id, 1, {}), { reason: "invalid-response" });
  for (const page of [
    { items: [lesson], nextAfter: null },
    { items: [], nextAfter: id },
    { items: [], nextAfter: null, extra: true },
  ]) {
    await assert.rejects(
      createLessonsApi("http://localhost:3001", async () =>
        response(page),
      ).list(),
      { reason: "invalid-response" },
    );
  }
});
test("draft transport bounds stalled bodies, rejects hostile origins before fetch, and never retries writes", async () => {
  let count = 0;
  for (const status of [
    400, 401, 403, 404, 409, 413, 429, 500, 502, 503, 504,
  ]) {
    const api = createLessonsApi("http://localhost:3001", async () => {
      count++;
      return response({}, status);
    });
    await assert.rejects(api.create({}), {
      reason:
        status === 401
          ? "unauthenticated"
          : status === 409
            ? "conflict"
            : status >= 500
              ? "unavailable"
              : "rejected",
    });
  }
  assert.equal(count, 11);
  const api = createLessonsApi(
    "http://localhost:3001",
    async () => ({
      ok: true,
      status: 201,
      headers: new Headers({ "Content-Type": "application/json" }),
      json: () => new Promise(() => {}),
    }),
    10,
  );
  await assert.rejects(api.create({}), { reason: "unavailable" });
  await assert.rejects(
    createLessonsApi("https://evil.invalid/path", async () => {
      throw new Error("must not fetch");
    }).create({}),
  );
});
