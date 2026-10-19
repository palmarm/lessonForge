import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthApiError } from "../src/lib/api-request.ts";
import { createResourcesApi } from "../src/lib/resources-api.ts";
const id = "11111111-1111-4111-8111-111111111111";
const content = {
  title: "Equal parts",
  subject: "Mathematics",
  grade: "Grade 4",
  sourceReference: "Original https://no-fetch.invalid",
  contentText: "<b>One half</b>",
};
const resource = {
  ...content,
  id,
  version: 1,
  retiredAt: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
};
const { contentText, sourceReference, ...summary } = resource;
void contentText;
void sourceReference;
const fails = (reason) => (error) =>
  error instanceof AuthApiError && error.reason === reason;

test("resource routes use shared credentialed transport, bounded pagination, fixed ids, CSRF and allowlisted writes", async () => {
  const calls = [];
  const api = createResourcesApi(
    "http://localhost:3001",
    async (url, options) => {
      calls.push({ url, options });
      return Response.json(
        url.includes("?") ? { items: [], nextAfter: null } : resource,
        { status: url.endsWith("/resources") ? 201 : 200 },
      );
    },
  );
  await api.list();
  await api.list(id);
  await api.detail(id);
  await api.create({
    ...content,
    id: "injected",
    retiredAt: "bad",
    version: 50,
  });
  await api.edit(id, 1, { ...content, version: 50 });
  await api.retire(id, 1);
  assert.deepEqual(
    calls.map((v) => v.url),
    [
      "http://localhost:3001/resources?limit=20",
      `http://localhost:3001/resources?limit=20&after=${id}`,
      `http://localhost:3001/resources/${id}`,
      "http://localhost:3001/resources",
      `http://localhost:3001/resources/${id}`,
      `http://localhost:3001/resources/${id}/retire`,
    ],
  );
  for (const { options } of calls) {
    assert.equal(options.credentials, "include");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.equal(new Headers(options.headers).get("Authorization"), null);
    assert.equal(
      new Headers(options.headers).get("X-LessonForge-CSRF"),
      options.body ? "1" : null,
    );
  }
  assert.deepEqual(JSON.parse(calls[3].options.body), content);
  assert.equal(calls[4].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[4].options.body), {
    ...content,
    expectedVersion: 1,
  });
  assert.deepEqual(JSON.parse(calls[5].options.body), { expectedVersion: 1 });
  for (const bad of ["../auth/me", "https://evil.test", `${id}?x=y`]) {
    assert.throws(() => api.detail(bad), fails("rejected"));
    assert.throws(() => api.list(bad), fails("rejected"));
  }
  assert.equal(calls.length, 6);
});
test("resources reject unsafe configuration and malformed detail/list/status bodies without leaking server messages", async () => {
  let calls = 0;
  await assert.rejects(
    createResourcesApi("https://secret:secret@evil.test", async () => {
      calls++;
    }).list(),
    fails("configuration"),
  );
  assert.equal(calls, 0);
  for (const value of [
    null,
    {},
    { ...resource, token: "secret" },
    { ...resource, version: 0 },
    { ...resource, grade: "4" },
    { ...resource, id: "bad" },
    { ...resource, createdAt: "2030-02-30T00:00:00.000Z" },
    { ...resource, contentText: "x".repeat(20001) },
    { ...resource, title: " " },
  ]) {
    await assert.rejects(
      createResourcesApi("http://localhost:3001", async () =>
        Response.json(value),
      ).detail(id),
      fails("invalid-response"),
    );
  }
  for (const page of [
    { items: [resource], nextAfter: null },
    { items: Array(21).fill(summary), nextAfter: null },
    { items: [summary, summary], nextAfter: null },
    { items: [summary], nextAfter: id },
    { items: [], nextAfter: "bad" },
    { items: [], nextAfter: null, extra: true },
  ])
    await assert.rejects(
      createResourcesApi("http://localhost:3001", async () =>
        Response.json(page),
      ).list(),
      fails("invalid-response"),
    );
  await assert.rejects(
    createResourcesApi("http://localhost:3001", async () =>
      Response.json({ items: [summary], nextAfter: null }),
    ).list(id),
    fails("invalid-response"),
  );
  await assert.rejects(
    createResourcesApi("http://localhost:3001", async () =>
      Response.json({
        ...resource,
        id: "22222222-2222-4222-8222-222222222222",
      }),
    ).detail(id),
    fails("invalid-response"),
  );
  for (const response of [
    Response.json(resource, { status: 201 }),
    new Response("unreadable", {
      headers: { "Content-Type": "application/json" },
    }),
    new Response(JSON.stringify(resource)),
  ])
    await assert.rejects(
      createResourcesApi("http://localhost:3001", async () => response).detail(
        id,
      ),
      fails("invalid-response"),
    );
  for (const [status, reason] of [
    [400, "rejected"],
    [401, "unauthenticated"],
    [403, "rejected"],
    [404, "rejected"],
    [409, "conflict"],
    [413, "rejected"],
    [429, "rejected"],
    [500, "unavailable"],
    [502, "unavailable"],
    [503, "unavailable"],
    [504, "unavailable"],
  ]) {
    const api = createResourcesApi("http://localhost:3001", async () =>
      Response.json({ message: "private diagnostic" }, { status }),
    );
    await assert.rejects(
      api.edit(id, 1, content),
      (error) => fails(reason)(error) && !error.message.includes("private"),
    );
  }
});
test("resources validate a complete bounded page and keep citation/markup as data", async () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    ...summary,
    id: `${String(i + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
  }));
  const page = { items, nextAfter: items.at(-1).id };
  const api = createResourcesApi("http://localhost:3001", async (url) =>
    Response.json(url.includes("?") ? page : resource),
  );
  assert.deepEqual(await api.list(), page);
  assert.deepEqual(await api.detail(id), resource);
});
test("resource deadlines cover stalled headers and streaming bodies, abort transports, and never retry uncertain writes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const streaming of [false, true]) {
    let calls = 0;
    let signal;
    const api = createResourcesApi(
      "http://localhost:3001",
      async (_url, opts) => {
        calls++;
        signal = opts.signal;
        return streaming
          ? new Response(
              new ReadableStream({
                start(c) {
                  c.enqueue(new TextEncoder().encode("{"));
                },
              }),
              { headers: { "Content-Type": "application/json" } },
            )
          : await new Promise(() => {});
      },
    );
    const result = assert.rejects(api.create(content), fails("unavailable"));
    await Promise.resolve();
    await Promise.resolve();
    t.mock.timers.tick(15000);
    await result;
    assert.equal(calls, 1);
    assert.equal(signal.aborted, true);
  }
});
test("resource requests support cancellation and retain confirmed status errors", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    createResourcesApi("http://localhost:3001", async () => {
      calls++;
    }).detail(id, controller.signal),
    fails("cancelled"),
  );
  assert.equal(calls, 0);
  let signal;
  const api = createResourcesApi(
    "http://localhost:3001",
    async (_url, options) => {
      signal = options.signal;
      return Response.json({}, { status: 409 });
    },
  );
  await assert.rejects(api.edit(id, 1, content), fails("conflict"));
  assert.equal(signal.aborted, true);
});
