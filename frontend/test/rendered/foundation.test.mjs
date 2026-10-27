import assert from "node:assert/strict";
import { before, after, test as nodeTest } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

// Optional runner: never downloads packages/browsers. Fixture responses exist only
// in this browser harness; all application calls use its real transport and stores.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
).catch(() => {
  throw new Error(
    "Playwright is missing. Run: npm install --save-dev --prefix frontend playwright; then npm exec --prefix frontend -- playwright install chromium. No installation was attempted.",
  );
});
const root = fileURLToPath(new URL("../../", import.meta.url));
const origin = "http://localhost:3210";
const test = (name, run) => nodeTest(name, { timeout: 45_000 }, run);
const apiOrigin = "http://localhost:3001";
let server, browser;
let serverOutput = "";
before(async () => {
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "localhost",
      "--port",
      "3210",
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk;
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk;
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) break;
    try {
      if (
        serverOutput.includes("Ready") &&
        (
          await fetch(`${origin}/sign-in`, {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      ) {
        ready = true;
        break;
      }
    } catch {
      /* Starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(
    ready,
    `Production test server did not start. Build the frontend first.\n${serverOutput}`,
  );
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill("SIGTERM");
    const forceStop = setTimeout(() => server.kill("SIGKILL"), 5_000);
    try {
      await stopped;
    } finally {
      clearTimeout(forceStop);
    }
  }
});
const id = "11111111-1111-4111-8111-111111111111";
const resourceId = "22222222-2222-4222-8222-222222222222";
const teacher = {
  user: {
    id: "33333333-3333-4333-8333-333333333333",
    email: "teacher@example.test",
    displayName: "Test Teacher",
    role: "TEACHER",
  },
  expiresAt: "2030-01-01T08:00:00.000Z",
};
const admin = {
  ...teacher,
  user: {
    ...teacher.user,
    id: "44444444-4444-4444-8444-444444444444",
    role: "ADMIN",
    displayName: "Test Administrator",
  },
};
const lesson = {
  id,
  title: "Saved lesson",
  version: 1,
  state: "DRAFT",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  content: {
    title: "Saved lesson",
    introduction: { text: "Saved introduction" },
  },
  generationOrigin: "MANUAL",
  sources: [],
};
const resource = {
  id: resourceId,
  title: "Saved resource",
  subject: "Mathematics",
  grade: "Grade 4",
  sourceReference: "Test citation",
  contentText: "Test text",
  version: 1,
  retiredAt: null,
  createdAt: lesson.createdAt,
  updatedAt: lesson.updatedAt,
};
function deferred() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function fixture(identity = teacher, fallback = false) {
  const context = await browser.newContext();
  // Keep a native reference so tests can also exercise entries outside our wrappers.
  await context.addInitScript(() => {
    window.__foundationReplaceState = history.replaceState.bind(history);
  });
  if (fallback)
    await context.addInitScript(() =>
      Object.defineProperty(window, "navigation", { value: undefined }),
    );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const f = {
    context,
    page,
    identity,
    meStatus: 200,
    logoutStatus: 204,
    loginStatus: 200,
    detailStatus: 200,
    lesson: structuredClone(lesson),
    resource: structuredClone(resource),
    calls: [],
    hold: null,
    writeStatus: 200,
  };
  await page.route(`${apiOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Content-Type, X-LessonForge-CSRF",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Cache-Control": "no-store",
    };
    const respond = async (status, value) => {
      try {
        await route.fulfill({
          status,
          headers,
          ...(status === 204
            ? {}
            : { contentType: "application/json", body: JSON.stringify(value) }),
        });
      } catch {
        /* Aborted requests may still finish on the server; the store must ignore them. */
      }
    };
    if (method === "OPTIONS") return respond(204);
    f.calls.push({
      method,
      path: url.pathname,
      body: request.postDataJSON(),
      search: url.search,
    });
    if (url.pathname === "/auth/me")
      return respond(f.identity ? f.meStatus : 401, f.identity);
    if (url.pathname === "/auth/login")
      return respond(f.loginStatus, f.identity);
    if (url.pathname === "/auth/logout") {
      if (f.logoutStatus === 204) f.identity = null;
      return respond(f.logoutStatus, {});
    }
    if (method === "GET") {
      if (url.pathname === "/lessons") {
        const { content, sources, generationOrigin, ...summary } = f.lesson;
        void content;
        void sources;
        void generationOrigin;
        const result = structuredClone(
          f.lessonPage ?? { items: [summary], nextAfter: null },
        );
        const status = f.listStatus ?? 200;
        f.listStarted?.resolve();
        if (f.listHold) await f.listHold.promise;
        return respond(status, result);
      }
      if (url.pathname === `/lessons/${f.lesson.id}`) {
        const status = f.detailStatus;
        const result = structuredClone(f.lesson);
        f.detailStarted?.resolve();
        if (f.detailHold) await f.detailHold.promise;
        return respond(status, result);
      }
      if (url.pathname === "/resources") {
        const { sourceReference, contentText, ...summary } = f.resource;
        void sourceReference;
        void contentText;
        return respond(
          200,
          f.resourcePage ?? { items: [summary], nextAfter: null },
        );
      }
      if (url.pathname === `/resources/${resourceId}`)
        return respond(f.detailStatus, f.resource);
    }
    if (
      method === "POST" &&
      url.pathname === `/resources/${resourceId}/retire`
    ) {
      f.resource = {
        ...f.resource,
        version: request.postDataJSON().expectedVersion + 1,
        retiredAt: lesson.updatedAt,
      };
      return respond(f.writeStatus, f.resource);
    }
    if (method === "PUT") {
      const body = request.postDataJSON();
      if (url.pathname.startsWith("/lessons/"))
        f.lesson = {
          ...f.lesson,
          content: body.content,
          title: body.content.title ?? "",
          version: body.expectedVersion + 1,
        };
      else {
        const { expectedVersion, ...content } = body;
        f.resource = {
          ...f.resource,
          ...content,
          version: expectedVersion + 1,
        };
      }
      const result = structuredClone(
        url.pathname.startsWith("/lessons/") ? f.lesson : f.resource,
      );
      const status = f.writeStatus;
      if (f.hold) await f.hold.promise;
      return respond(status, result);
    }
    if (method === "POST" && url.pathname === "/resources") {
      f.resource = { ...f.resource, ...request.postDataJSON(), version: 1 };
      return respond(f.writeStatus === 200 ? 201 : f.writeStatus, f.resource);
    }
    if (
      method === "POST" &&
      url.pathname.startsWith(`/lessons/${id}/resources/${resourceId}/`)
    ) {
      const action = url.pathname.split("/").at(-1);
      const { title, subject, grade, sourceReference, contentText } =
        f.resource;
      const selection = {
        resourceId,
        resourceVersion: f.resource.version,
        snapshot: { title, subject, grade, sourceReference, contentText },
      };
      const version = request.postDataJSON().expectedVersion;
      if (version !== f.lesson.version) return respond(409, {});
      f.lesson = {
        ...f.lesson,
        version: version + 1,
        sources: action === "remove" ? [] : [selection],
      };
      return respond(f.writeStatus, f.lesson);
    }
    if (method === "POST" && url.pathname === "/lessons") {
      const { content } = request.postDataJSON();
      f.lesson = {
        ...f.lesson,
        id: f.creationId ?? id,
        content,
        title: content.title ?? "",
        version: 1,
      };
      return respond(f.writeStatus === 200 ? 201 : f.writeStatus, f.lesson);
    }
    throw new Error(`Unexpected fixture request: ${method} ${url.pathname}`);
  });
  f.goto = async (path) => {
    await page.goto(`${origin}${path}`);
    await page
      .getByRole("button", { name: "Check session again", exact: true })
      .first()
      .waitFor();
  };
  f.close = async () => {
    f.hold?.resolve();
    f.listHold?.resolve();
    f.detailHold?.resolve();
    await context.close();
    assert.deepEqual(errors, []);
  };
  return f;
}
const account = (page) =>
  page.getByRole("region", { name: "Account", exact: true });
const nav = (page, name) =>
  page.getByRole("navigation").getByRole("link", { name, exact: true });
async function dialog(page, accept, action) {
  const handled = page
    .waitForEvent("dialog", { timeout: 10_000 })
    .then(async (event) => {
      if (accept) await event.accept();
      else await event.dismiss();
    });
  await Promise.all([action(), handled]);
  // Dialog dismissal can precede the end of the browser's traversal task. Wait
  // for rendering before issuing another Back/Forward (otherwise it may coalesce).
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
async function openLesson(f) {
  await f.goto("/drafts");
  await f.page
    .getByRole("button", { name: /Open draft: Saved lesson/ })
    .click();
  await f.page
    .getByLabel("Title", { exact: true })
    .fill("Retained lesson text");
}
async function openResource(f) {
  await f.goto("/admin/resources");
  await f.page
    .getByRole("button", {
      name: "Manage resource: Saved resource",
      exact: true,
    })
    .click();
  await f.page
    .getByRole("button", { name: "Edit resource", exact: true })
    .click();
  await f.page
    .getByLabel("Title (maximum 200 characters)")
    .fill("Retained administrator text");
}

async function skipToContent(page) {
  // Wait for the navigation effect to own anchors before testing its focus.
  await page.waitForFunction(
    () => !!history.state?.__lessonforgeNavigationIndex,
  );
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "main-content",
  );
  assert.equal(new URL(page.url()).hash, "#main-content");
}

async function assertRetainedDraft(page, url) {
  await page.waitForURL(url);
  await page.getByRole("heading", { name: "My drafts", exact: true }).waitFor();
  const title = page.getByLabel("Title", { exact: true });
  assert.equal(await title.isVisible(), true);
  assert.equal(await title.inputValue(), "History regression text");
  assert.equal(
    await page
      .getByRole("heading", { name: "Resources", exact: true })
      .isVisible(),
    false,
  );
  assert.equal(
    await page
      .locator("summary")
      .filter({ hasText: "Compare saved content and recover" })
      .isVisible(),
    true,
  );
}

for (const fallback of [false, true])
  for (const entry of ["fragment", "unmarked"])
    for (const direction of ["Back", "Forward"])
      for (const outcome of ["dirty", "pending", "uncertain"])
        test(`fragment history: ${fallback ? "fallback" : "Navigation API"}, ${entry}, ${direction}, ${outcome}`, async () => {
          const f = await fixture(teacher, fallback);
          const p = f.page;
          try {
            await f.goto(direction === "Back" ? "/resources" : "/drafts");
            if (direction === "Forward") await nav(p, "Resources").click();
            await skipToContent(p);
            if (entry === "unmarked") {
              await p.evaluate(() =>
                window.__foundationReplaceState(null, "", location.href),
              );
              assert.equal(await p.evaluate(() => history.state), null);
            }
            if (direction === "Back") await nav(p, "My drafts").click();
            else {
              // Pass the resource route and its fragment entry to return to drafts.
              await p.evaluate(() => history.go(-2));
              await p.waitForURL(`${origin}/drafts`);
            }
            await p
              .getByRole("button", { name: /Open draft: Saved lesson/ })
              .click();
            await p
              .getByLabel("Title", { exact: true })
              .fill("History regression text");
            const retainedUrl = p.url();
            if (outcome !== "dirty") {
              if (outcome === "pending") f.hold = deferred();
              else f.writeStatus = 503;
              await p
                .getByRole("button", {
                  name: "Save draft content",
                  exact: true,
                })
                .click();
              await p
                .getByText(
                  outcome === "pending"
                    ? "Saving draft…"
                    : "A write is unconfirmed.",
                  { exact: outcome === "pending" },
                )
                .waitFor();
            }
            const traverse = () =>
              p.evaluate(
                (back) => history.go(back ? -1 : 2),
                direction === "Back",
              );
            if (outcome === "dirty") await dialog(p, false, traverse);
            else await traverse();
            await p.locator("[data-navigation-notice]").waitFor();
            await assertRetainedDraft(p, retainedUrl);
            // A blocked traversal must not make a subsequent link look safe.
            if (outcome === "dirty")
              await dialog(p, false, () => nav(p, "Resources").click());
            else await nav(p, "Resources").click();
            await assertRetainedDraft(p, retainedUrl);
            if (outcome === "pending") {
              f.hold.resolve();
              await p
                .getByText("Draft saved. No submitted revision was created.", {
                  exact: true,
                })
                .waitFor();
            } else if (outcome === "uncertain") {
              await p
                .getByRole("button", {
                  name: "Load latest result (keep entered text and version)",
                  exact: true,
                })
                .click();
              await p
                .getByRole("button", {
                  name: "I checked the result; allow another action",
                  exact: true,
                })
                .waitFor();
              await nav(p, "Resources").click();
              await assertRetainedDraft(p, retainedUrl);
              await p
                .getByRole("button", {
                  name: "I checked the result; allow another action",
                  exact: true,
                })
                .click();
              await p
                .getByRole("button", {
                  name: /Use displayed draft, version, and selections/,
                })
                .click();
            } else {
              // Accepting ordinary dirty navigation retains the mounted editor.
              await dialog(p, true, () => nav(p, "Resources").click());
              await p.waitForURL(`${origin}/resources`);
              await dialog(p, true, () => nav(p, "My drafts").click());
              await assertRetainedDraft(p, `${origin}/drafts`);
              await p
                .getByRole("button", {
                  name: "Save draft content",
                  exact: true,
                })
                .click();
              await p
                .getByText("Draft saved. No submitted revision was created.", {
                  exact: true,
                })
                .waitFor();
            }
            await nav(p, "Resources").click();
            await p.waitForURL(`${origin}/resources`);
            await p
              .getByRole("heading", { name: "Resources", exact: true })
              .waitFor();
            await p.evaluate(() => history.back());
            await assertRetainedDraft(p, `${origin}/drafts`);
            await p.evaluate(() => history.forward());
            await p.waitForURL(`${origin}/resources`);
            assert.equal(
              await p.getByLabel("Title", { exact: true }).isVisible(),
              false,
            );
            assert.equal(
              f.calls.filter((call) => call.method === "PUT").length,
              1,
            );
          } finally {
            await f.close();
          }
        });

for (const fallback of [false, true]) {
  for (const direction of ["Back", "Forward"])
    test(`fragment history: accepted unmarked ${direction} synchronizes the ${fallback ? "fallback" : "Navigation API"} router`, async () => {
      const f = await fixture(teacher, fallback);
      const p = f.page;
      try {
        await f.goto(direction === "Back" ? "/resources" : "/drafts");
        if (direction === "Forward") await nav(p, "Resources").click();
        await skipToContent(p);
        await p.evaluate(() =>
          window.__foundationReplaceState(null, "", location.href),
        );
        if (direction === "Back") await nav(p, "My drafts").click();
        else {
          await p.evaluate(() => history.go(-2));
          await p.waitForURL(`${origin}/drafts`);
        }
        await p
          .getByRole("button", { name: /Open draft: Saved lesson/ })
          .click();
        await p
          .getByLabel("Title", { exact: true })
          .fill("History regression text");
        await dialog(p, true, () =>
          p.evaluate((back) => history.go(back ? -1 : 2), direction === "Back"),
        );
        await p.waitForURL(`${origin}/resources#main-content`);
        await p
          .getByRole("heading", { name: "Resources", exact: true })
          .waitFor();
        assert.equal(
          await p.getByLabel("Title", { exact: true }).isVisible(),
          false,
        );
        await dialog(p, true, () => nav(p, "My drafts").click());
        await assertRetainedDraft(p, `${origin}/drafts`);
      } finally {
        await f.close();
      }
    });
  test(`fragment history: editor anchors retain accessible focus and dirty Back/Forward (${fallback ? "fallback" : "Navigation API"})`, async () => {
    const f = await fixture(teacher, fallback);
    const p = f.page;
    try {
      await openLesson(f);
      await p.getByText("Draft help and limits", { exact: true }).click();
      await p
        .getByRole("link", { name: "Edit introduction", exact: true })
        .click();
      assert.equal(
        await p.evaluate(() => document.activeElement.id),
        "lesson-introduction",
      );
      await p
        .getByRole("link", {
          name: "Select or manage resource snapshots",
          exact: true,
        })
        .click();
      assert.equal(
        await p.evaluate(() => document.activeElement.id),
        "draft-sources-heading",
      );
      await dialog(p, false, () => p.evaluate(() => history.back()));
      await p.waitForURL(`${origin}/drafts#draft-sources-heading`);
      await dialog(p, true, () => p.evaluate(() => history.back()));
      await p.waitForURL(`${origin}/drafts#lesson-introduction`);
      await dialog(p, false, () => p.evaluate(() => history.forward()));
      await p.waitForURL(`${origin}/drafts#lesson-introduction`);
      await dialog(p, true, () => p.evaluate(() => history.forward()));
      await p.waitForURL(`${origin}/drafts#draft-sources-heading`);
      assert.equal(
        await p.getByLabel("Title", { exact: true }).inputValue(),
        "Retained lesson text",
      );
    } finally {
      await f.close();
    }
  });
}

for (const fallback of [false, true])
  test(`dirty navigation retains work and protects browser Back/Forward (${fallback ? "history fallback" : "Navigation API"})`, async () => {
    const f = await fixture(teacher, fallback);
    const p = f.page;
    try {
      await f.goto("/resources");
      await nav(p, "My drafts").click();
      await p
        .getByRole("button", { name: "New manual draft", exact: true })
        .click();
      await p
        .getByLabel("Title", { exact: true })
        .fill("Unsaved persistent text");
      await dialog(p, false, () => nav(p, "Resources").click());
      assert.equal(new URL(p.url()).pathname, "/drafts");
      await dialog(p, true, () => nav(p, "Resources").click());
      await p.waitForURL(`${origin}/resources`);
      await dialog(p, true, () => nav(p, "My drafts").click());
      await p.waitForURL(`${origin}/drafts`);
      assert.equal(
        await p.getByLabel("Title", { exact: true }).inputValue(),
        "Unsaved persistent text",
      );
      await dialog(p, false, () => p.evaluate(() => history.back()));
      await p.getByRole("alert").filter({ hasText: "Stayed" }).waitFor();
      await p.waitForURL(`${origin}/drafts`);
      assert.equal(new URL(p.url()).pathname, "/drafts");
      await dialog(p, true, () => p.evaluate(() => history.back()));
      await p.waitForURL(`${origin}/resources`);
      await dialog(p, true, () => p.evaluate(() => history.forward()));
      await p.waitForURL(`${origin}/drafts`);
      assert.equal(
        await p.getByLabel("Title", { exact: true }).inputValue(),
        "Unsaved persistent text",
      );
    } finally {
      await f.close();
    }
  });

test("pending/uncertain teacher writes block navigation, logout and discard until explicit recovery", async () => {
  const f = await fixture();
  const p = f.page;
  try {
    await openLesson(f);
    f.hold = deferred();
    f.writeStatus = 503;
    await p
      .getByRole("button", { name: "Save draft content", exact: true })
      .click();
    await nav(p, "Resources").click();
    await p
      .locator("[data-navigation-notice]")
      .filter({ hasText: "pending or uncertain" })
      .waitFor();
    assert.equal(new URL(p.url()).pathname, "/drafts");
    await account(p)
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    assert.equal(
      f.calls.filter((call) => call.path === "/auth/logout").length,
      0,
    );
    f.hold.resolve();
    await p.getByText("A write is unconfirmed.", { exact: false }).waitFor();
    assert.equal(
      await p
        .getByRole("button", { name: "Close editor and discard unsaved text" })
        .isDisabled(),
      true,
    );
    f.detailStatus = 503;
    await p
      .getByRole("button", {
        name: "Load latest result (keep entered text and version)",
        exact: true,
      })
      .click();
    await p
      .getByRole("alert")
      .filter({ hasText: "temporarily unavailable" })
      .waitFor();
    await p.waitForFunction(
      () =>
        document.activeElement?.getAttribute("role") === "alert" &&
        document.activeElement.textContent.includes("temporarily unavailable"),
    );
    assert.equal(
      await p
        .getByRole("button", {
          name: "I checked the result; allow another action",
        })
        .count(),
      0,
    );
    f.detailStatus = 200;
    await p
      .getByRole("button", {
        name: "Load latest result (keep entered text and version)",
        exact: true,
      })
      .click();
    await p
      .getByRole("button", {
        name: "I checked the result; allow another action",
      })
      .waitFor();
    await nav(p, "Resources").click();
    assert.equal(
      new URL(p.url()).pathname,
      "/drafts",
      "a successful read alone never unlocks leaving",
    );
    await p
      .getByRole("button", {
        name: "I checked the result; allow another action",
      })
      .click();
    assert.equal(
      await p.getByLabel("Title", { exact: true }).inputValue(),
      "Retained lesson text",
    );
    await p
      .getByRole("heading", { name: "Edit draft · based on version 1" })
      .waitFor();
    await p
      .getByRole("button", {
        name: /Use displayed draft, version, and selections/,
      })
      .click();
    await p
      .getByRole("heading", { name: "Edit draft · based on version 2" })
      .waitFor();
    assert.equal(f.calls.filter((call) => call.method === "PUT").length, 1);
  } finally {
    await f.close();
  }
});

for (const role of ["TEACHER", "ADMIN"])
  test(`${role} session uncertainty pauses edits and ignores a late committed write`, async () => {
    const f = await fixture(role === "ADMIN" ? admin : teacher);
    const p = f.page;
    try {
      if (role === "ADMIN") await openResource(f);
      else await openLesson(f);
      f.hold = deferred();
      await p
        .getByRole("button", {
          name: role === "ADMIN" ? "Save resource" : "Save draft content",
          exact: true,
        })
        .click();
      f.meStatus = 503;
      await account(p)
        .getByRole("button", { name: "Check session again", exact: true })
        .click();
      const title = p.getByLabel(
        role === "ADMIN" ? "Title (maximum 200 characters)" : "Title",
        { exact: true },
      );
      await p
        .getByRole("alert")
        .filter({ hasText: "temporarily unavailable" })
        .waitFor();
      assert.equal(await title.isDisabled(), true);
      f.hold.resolve();
      f.meStatus = 200;
      await account(p)
        .getByRole("button", { name: "Check session again", exact: true })
        .click();
      await p
        .getByText("Session changed during a write.", { exact: false })
        .waitFor();
      assert.equal(
        await title.inputValue(),
        role === "ADMIN"
          ? "Retained administrator text"
          : "Retained lesson text",
      );
      assert.equal(
        await p
          .getByRole("button", {
            name: role === "ADMIN" ? "Save resource" : "Save draft content",
            exact: true,
          })
          .isDisabled(),
        true,
      );
      assert.equal(f.calls.filter((call) => call.method === "PUT").length, 1);
      // A stale success must not erase the uncertainty or adopt its new version.
      await p
        .getByRole("button", {
          name:
            role === "ADMIN"
              ? "Load latest result (keep entered text)"
              : "Load latest result (keep entered text and version)",
          exact: true,
        })
        .click();
      await p
        .getByRole("button", {
          name: "I checked the result; allow another action",
        })
        .waitFor();
    } finally {
      await f.close();
    }
  });

test("confirmed 401 disposes an in-flight workspace; same-user new session receives no old editor content", async () => {
  const f = await fixture();
  const p = f.page;
  try {
    await openLesson(f);
    f.hold = deferred();
    await p
      .getByRole("button", { name: "Save draft content", exact: true })
      .click();
    f.meStatus = 401;
    await account(p)
      .getByRole("button", { name: "Check session again", exact: true })
      .click();
    await p.getByLabel("Email", { exact: true }).waitFor();
    assert.equal(await p.getByLabel("Title", { exact: true }).count(), 0);
    f.identity = { ...teacher, expiresAt: "2030-01-01T09:00:00.000Z" };
    f.meStatus = 200;
    await p.getByLabel("Email", { exact: true }).fill("teacher@example.test");
    await p
      .getByLabel("Password", { exact: true })
      .fill("fictional test password");
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await p
      .getByRole("button", { name: "New manual draft", exact: true })
      .waitFor();
    f.hold.resolve();
    await p
      .getByRole("button", { name: "New manual draft", exact: true })
      .click();
    assert.equal(await p.getByLabel("Title", { exact: true }).inputValue(), "");
  } finally {
    await f.close();
  }
});

test("failed logout retains paused administrator work; explicit recovery and confirmed logout dispose it", async () => {
  const f = await fixture(admin);
  const p = f.page;
  try {
    await openResource(f);
    f.logoutStatus = 503;
    await dialog(p, true, () =>
      account(p).getByRole("button", { name: "Sign out", exact: true }).click(),
    );
    await p
      .getByRole("alert")
      .filter({ hasText: "Sign out could not be confirmed" })
      .waitFor();
    assert.equal(
      await p.getByLabel("Title (maximum 200 characters)").inputValue(),
      "Retained administrator text",
    );
    assert.equal(
      await p.getByLabel("Title (maximum 200 characters)").isDisabled(),
      true,
    );
    await account(p)
      .getByRole("button", { name: "Check session again", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Save resource", exact: true })
      .waitFor();
    f.logoutStatus = 204;
    await dialog(p, true, () =>
      account(p).getByRole("button", { name: "Sign out", exact: true }).click(),
    );
    await p.getByLabel("Email", { exact: true }).waitFor();
    assert.equal(
      await p.getByLabel("Title (maximum 200 characters)").count(),
      0,
    );
  } finally {
    await f.close();
  }
});

test("role/session replacement and absolute expiry dispose prior workspaces", async () => {
  const f = await fixture();
  const p = f.page;
  try {
    await p.clock.install({ time: new Date("2030-01-01T00:00:00.000Z") });
    await openLesson(f);
    f.identity = { ...admin, expiresAt: "2030-01-01T00:01:00.000Z" };
    await account(p)
      .getByRole("button", { name: "Check session again", exact: true })
      .click();
    await p
      .getByRole("navigation", { name: "Administrator navigation" })
      .waitFor();
    assert.equal(await p.getByLabel("Title", { exact: true }).count(), 0);
    assert.equal(await nav(p, "My drafts").count(), 0);
    await nav(p, "Manage resources").click();
    await p
      .getByRole("button", { name: "Create resource", exact: true })
      .click();
    await p
      .getByLabel("Title (maximum 200 characters)")
      .fill("Expires without transfer");
    await p.clock.fastForward(61_000);
    await p.getByLabel("Email", { exact: true }).waitFor();
    assert.equal(
      await p.getByLabel("Title (maximum 200 characters)").count(),
      0,
    );
  } finally {
    await f.close();
  }
});

test("unknown-ID creation requires explicit candidate inspection; a failed reinspection keeps recovery blocked", async () => {
  const f = await fixture();
  const p = f.page;
  try {
    await f.goto("/drafts");
    await p
      .getByRole("button", { name: "New manual draft", exact: true })
      .click();
    await p.getByLabel("Title", { exact: true }).fill("Unconfirmed creation");
    f.writeStatus = 503;
    await p
      .getByRole("button", { name: "Save draft content", exact: true })
      .click();
    await p.getByText("A write is unconfirmed.", { exact: false }).waitFor();
    const reconcile = p.getByRole("button", {
      name: "Load latest result (keep entered text and version)",
      exact: true,
    });
    const acknowledge = p.getByRole("button", {
      name: "I checked the result; allow another action",
    });
    await reconcile.click();
    const inspect = p.getByRole("button", {
      name: /Inspect possible saved draft: Unconfirmed creation/,
    });
    await inspect.waitFor();
    assert.equal(
      await acknowledge.count(),
      0,
      "list success is not candidate inspection",
    );
    await inspect.click();
    await acknowledge.waitFor();
    f.detailStatus = 503;
    await inspect.click();
    await p
      .getByRole("alert")
      .filter({ hasText: "temporarily unavailable" })
      .waitFor();
    assert.equal(await acknowledge.count(), 0);
    assert.equal(
      await p
        .getByRole("button", {
          name: "I found no matching draft; allow a new create",
        })
        .count(),
      0,
    );
    await nav(p, "Resources").click();
    assert.equal(new URL(p.url()).pathname, "/drafts");
    assert.equal(
      await p.getByLabel("Title", { exact: true }).inputValue(),
      "Unconfirmed creation",
    );
    assert.equal(
      f.calls.filter(
        (call) => call.method === "POST" && call.path === "/lessons",
      ).length,
      1,
    );
  } finally {
    await f.close();
  }
});

for (const replacement of ["user", "role", "session"])
  test(`confirmed ${replacement} replacement disposes entered work independently`, async () => {
    const f = await fixture();
    const p = f.page;
    try {
      await openLesson(f);
      f.identity =
        replacement === "user"
          ? { ...teacher, user: { ...teacher.user, id: admin.user.id } }
          : replacement === "role"
            ? { ...teacher, user: { ...teacher.user, role: "ADMIN" } }
            : { ...teacher, expiresAt: "2030-01-01T09:00:00.000Z" };
      await account(p)
        .getByRole("button", { name: "Check session again", exact: true })
        .click();
      if (replacement === "role")
        await p
          .getByRole("navigation", { name: "Administrator navigation" })
          .waitFor();
      else await p.getByText("No lesson is open.", { exact: false }).waitFor();
      assert.equal(await p.getByLabel("Title", { exact: true }).count(), 0);
    } finally {
      await f.close();
    }
  });

test("shared shell and controls support keyboard focus and narrow teacher/admin workspaces", async () => {
  for (const identity of [teacher, admin]) {
    const f = await fixture(identity);
    const p = f.page;
    try {
      if (identity === teacher) await openLesson(f);
      else await openResource(f);
      for (const width of [320, 390, 768, 1024, 1440]) {
        await p.setViewportSize({ width, height: 900 });
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        assert.ok(
          await p
            .locator(".field:visible")
            .first()
            .evaluate((field) => field.getBoundingClientRect().height >= 44),
        );
      }
      await p.evaluate(() => {
        document.body.tabIndex = -1;
        document.body.focus();
      });
      await p.keyboard.press("Tab");
      assert.equal(
        await p.evaluate(() => document.activeElement.textContent),
        "Skip to content",
      );
      assert.equal(
        await p
          .locator(".skip-link")
          .evaluate((link) => getComputedStyle(link).outlineWidth),
        "3px",
      );
      await p.keyboard.press("Enter");
      assert.equal(
        await p.evaluate(() => document.activeElement.id),
        "main-content",
      );
    } finally {
      await f.close();
    }
  }
});

test("sign-in uses real request shape, clears passwords, and distinguishes rejection from uncertainty", async () => {
  const f = await fixture(null);
  const p = f.page;
  try {
    await p.goto(`${origin}/sign-in`);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await p
      .getByRole("alert")
      .filter({ hasText: "Check your sign-in details" })
      .waitFor();
    await p.getByLabel("Email", { exact: true }).fill("teacher@example.test");
    await p.getByLabel("Password", { exact: true }).fill("fictional password");
    await p.getByRole("button", { name: "Show password" }).click();
    assert.equal(
      await p.getByLabel("Password", { exact: true }).getAttribute("type"),
      "text",
    );
    f.loginStatus = 401;
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await p
      .getByRole("alert")
      .filter({ hasText: "Invalid email or password" })
      .waitFor();
    assert.equal(
      await p.getByLabel("Password", { exact: true }).inputValue(),
      "",
    );
    assert.equal(
      await p.getByLabel("Email", { exact: true }).inputValue(),
      "teacher@example.test",
    );
    assert.deepEqual(f.calls.find((call) => call.path === "/auth/login").body, {
      email: "teacher@example.test",
      password: "fictional password",
    });
    f.loginStatus = 503;
    await p
      .getByLabel("Password", { exact: true })
      .fill("another fictional password");
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await p
      .getByRole("alert")
      .filter({ hasText: "temporarily unavailable" })
      .waitFor();
    await p
      .getByRole("button", { name: "Check session again", exact: true })
      .waitFor();
    assert.equal(
      await p.getByLabel("Password", { exact: true }).inputValue(),
      "",
    );
    assert.equal(
      await p.evaluate(() => sessionStorage.length + localStorage.length),
      0,
    );
    for (const width of [320, 390, 768, 1024, 1440]) {
      await p.setViewportSize({ width, height: 900 });
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    }
  } finally {
    await f.close();
  }
});

async function assertHeadingOutline(page, expected) {
  const [level, name] = expected.at(-1);
  const main = page.getByRole("main");
  await main.getByRole("heading", { level, name, exact: true }).waitFor();
  assert.deepEqual(
    await main
      .getByRole("heading")
      .evaluateAll((headings) =>
        headings.map((heading) => [
          Number(heading.tagName.slice(1)),
          heading.textContent.trim(),
        ]),
      ),
    expected,
  );
}

test("Phase 2 heading outline: teacher resource list and direct detail", async () => {
  const f = await fixture();
  const p = f.page;
  try {
    await f.goto("/resources");
    await assertHeadingOutline(p, [
      [1, "Resources"],
      [2, "Saved resource"],
    ]);
    await p
      .getByRole("link", { name: "View resource: Saved resource", exact: true })
      .click();
    const detailOutline = [
      [1, "Saved resource"],
      [2, "Source reference"],
      [2, "Resource text"],
    ];
    await assertHeadingOutline(p, detailOutline);
    await p.reload();
    await assertHeadingOutline(p, detailOutline);
  } finally {
    await f.close();
  }
});

test("Phase 2 heading outline: administrator list, editors, detail and retirement", async () => {
  const f = await fixture(admin);
  const p = f.page;
  try {
    await f.goto("/admin/resources");
    await assertHeadingOutline(p, [
      [1, "Manage resources"],
      [2, "Saved resource"],
    ]);
    await p
      .getByRole("button", { name: "Create resource", exact: true })
      .click();
    await assertHeadingOutline(p, [
      [1, "Manage resources"],
      [2, "Create resource"],
    ]);
    await dialog(p, true, () =>
      p.getByRole("button", { name: "Back to resource list" }).click(),
    );
    await p
      .getByRole("button", {
        name: "Manage resource: Saved resource",
        exact: true,
      })
      .click();
    const detailOutline = [
      [1, "Manage resources"],
      [2, "Saved resource"],
      [3, "Source reference"],
      [3, "Resource text"],
    ];
    await assertHeadingOutline(p, detailOutline);
    await p.getByRole("button", { name: "Edit resource", exact: true }).click();
    await assertHeadingOutline(p, [
      ...detailOutline,
      [2, "Edit resource (based on version 1)"],
    ]);
    await p
      .getByRole("button", { name: "Discard entered edits", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Retire resource", exact: true })
      .click();
    await assertHeadingOutline(p, [
      ...detailOutline,
      [3, "Retire “Saved resource”?"],
    ]);
    assert.equal(
      await p.evaluate(() => document.activeElement.id),
      "retire-confirm-heading",
    );
    await p
      .getByRole("button", { name: "Confirm retirement", exact: true })
      .click();
    await p.getByText(/Retired · Read-only/).waitFor();
    await assertHeadingOutline(p, detailOutline);
  } finally {
    await f.close();
  }
});

test("Phase 2 direct teacher detail loads exact UUID, handles unavailable content and keeps API text plain", async () => {
  const f = await fixture();
  try {
    f.resource.contentText = "<b>Only API content</b>";
    await f.goto(`/resources/${resourceId}`);
    await f.page
      .getByText("<b>Only API content</b>", { exact: true })
      .waitFor();
    assert.equal(f.calls.filter((c) => c.path === "/resources").length, 0);
    assert.equal(await f.page.locator("article b").count(), 0);
    f.detailStatus = 404;
    await f.page
      .getByRole("button", { name: "Reload resource", exact: true })
      .click();
    await f.page
      .getByRole("alert")
      .filter({ hasText: "unavailable" })
      .waitFor();
    assert.equal(
      await f.page
        .getByText("<b>Only API content</b>", { exact: true })
        .count(),
      0,
    );
    await f.page.getByRole("link", { name: "Back to resources" }).click();
    await f.page
      .getByRole("link", { name: "View resource: Saved resource" })
      .waitFor();
  } finally {
    await f.close();
  }
});

test("Phase 2 server pagination renders summaries and requests the supplied cursor", async () => {
  const f = await fixture();
  try {
    const { sourceReference, contentText, ...summary } = f.resource;
    void sourceReference;
    void contentText;
    const items = Array.from({ length: 20 }, (_, i) => ({
      ...summary,
      id: `22222222-2222-4222-8222-${String(i + 1).padStart(12, "0")}`,
      title: `Page resource ${i + 1}`,
    }));
    f.resourcePage = { items, nextAfter: items.at(-1).id };
    await f.goto("/resources");
    await f.page
      .getByRole("link", {
        name: "View resource: Page resource 20",
        exact: true,
      })
      .waitFor();
    f.resourcePage = { items: [], nextAfter: null };
    await f.page
      .getByRole("button", { name: "Next page", exact: true })
      .click();
    await f.page
      .getByText("No resources on this page.", { exact: true })
      .waitFor();
    assert.ok(
      f.calls.some((c) => c.search === `?limit=20&after=${items.at(-1).id}`),
    );
    assert.equal(
      f.calls.filter((c) => c.path.startsWith("/resources/")).length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("Phase 2 retirement confirms viewed version and presents retired content read-only", async () => {
  const f = await fixture(admin);
  try {
    await f.goto("/admin/resources");
    await f.page
      .getByRole("button", {
        name: "Manage resource: Saved resource",
        exact: true,
      })
      .click();
    await f.page
      .getByRole("button", { name: "Retire resource", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Cancel retirement", exact: true })
      .click();
    assert.equal(f.calls.filter((c) => c.method === "POST").length, 0);
    await f.page
      .getByRole("button", { name: "Retire resource", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Confirm retirement", exact: true })
      .click();
    await f.page.getByText(/Retired · Read-only/).waitFor();
    assert.deepEqual(f.calls.find((c) => c.path.endsWith("/retire")).body, {
      expectedVersion: 1,
    });
    assert.equal(
      await f.page
        .getByRole("button", { name: "Edit resource", exact: true })
        .count(),
      0,
    );
  } finally {
    await f.close();
  }
});

test("Phase 2 administrator validation and comparison preserve text and version", async () => {
  const f = await fixture(admin);
  try {
    await openResource(f);
    f.writeStatus = 400;
    await f.page
      .getByRole("button", { name: "Save resource", exact: true })
      .click();
    const alert = f.page
      .getByRole("alert")
      .filter({ hasText: "Check required fields" });
    await alert.waitFor();
    assert.equal(
      await alert.evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(
      await f.page.getByLabel("Title (maximum 200 characters)").inputValue(),
      "Retained administrator text",
    );
    f.resource.title = "Other administrator text";
    f.resource.version = 3;
    await f.page
      .getByRole("button", {
        name: "Load latest result (keep entered text)",
        exact: true,
      })
      .click();
    await f.page
      .getByRole("button", {
        name: "Use displayed version 3 with my entered text",
      })
      .waitFor();
    assert.equal(
      await f.page.getByLabel("Title (maximum 200 characters)").inputValue(),
      "Retained administrator text",
    );
    assert.equal(f.calls.filter((c) => c.method === "PUT").length, 1);
  } finally {
    await f.close();
  }
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`Phase 2 resource layouts and labeled keyboard controls fit ${width}px`, async () => {
    const f = await fixture(admin);
    try {
      await f.page.setViewportSize({ width, height: 900 });
      await f.goto("/admin/resources");
      await f.page
        .getByRole("button", {
          name: "Manage resource: Saved resource",
          exact: true,
        })
        .waitFor();
      assert.equal(
        await f.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await f.page.screenshot({
        path: `/tmp/lessonforge-phase2-admin-list-${width}.png`,
        fullPage: true,
      });
      await openResource(f);
      const title = f.page.getByLabel("Title (maximum 200 characters)");
      await title.focus();
      await f.page.keyboard.press("Tab");
      assert.equal(
        await f.page
          .getByLabel("Source reference (maximum 1,000 characters)")
          .evaluate((el) => el === document.activeElement),
        true,
      );
      assert.equal(
        await f.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      const saveBounds = await f.page
        .getByRole("button", { name: "Save resource", exact: true })
        .boundingBox();
      assert.ok(
        saveBounds.y >= 0 && saveBounds.y + saveBounds.height <= 900,
        "Save remains in the viewport while editing",
      );
      const fieldBounds = await f.page
        .getByLabel("Source reference (maximum 1,000 characters)")
        .boundingBox();
      const barBounds = await f.page.locator("form .sticky").boundingBox();
      assert.ok(
        fieldBounds.y >= barBounds.y + barBounds.height,
        "focused field clears the sticky save bar",
      );
      await f.page.screenshot({
        path: `/tmp/lessonforge-phase2-admin-viewport-${width}.png`,
        fullPage: false,
      });
      await f.page.screenshot({
        path: `/tmp/lessonforge-phase2-admin-${width}.png`,
        fullPage: true,
      });
      f.page.on("dialog", (d) => d.accept());
      await f.page.goto(`${origin}/resources/${resourceId}`);
      f.identity = teacher;
      await account(f.page)
        .getByRole("button", { name: "Check session again", exact: true })
        .click();
      await f.page.getByText("Test text", { exact: true }).waitFor();
      await f.page.screenshot({
        path: `/tmp/lessonforge-phase2-detail-${width}.png`,
        fullPage: true,
      });
      await f.page.getByRole("link", { name: "Back to resources" }).click();
      await f.page
        .getByRole("link", { name: "View resource: Saved resource" })
        .waitFor();
      await f.page.screenshot({
        path: `/tmp/lessonforge-phase2-list-${width}.png`,
        fullPage: true,
      });
      assert.equal(
        await f.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    } finally {
      await f.close();
    }
  });
}

test("Phase 2 uncertain resource creation keeps candidates reachable and blocks stale acknowledgement", async () => {
  const f = await fixture(admin, true);
  try {
    const p = f.page;
    await f.goto("/admin/resources");
    await p
      .getByRole("button", { name: "Create resource", exact: true })
      .click();
    await p
      .getByLabel("Title (maximum 200 characters)")
      .fill("Uncertain resource");
    await p
      .getByLabel("Source reference (maximum 1,000 characters)")
      .fill("Citation");
    await p
      .getByLabel("Resource text (maximum 20,000 characters)")
      .fill("Retained content");
    f.writeStatus = 503;
    await p.getByRole("button", { name: "Save resource", exact: true }).click();
    await p.getByText(/Uncertain outcome · Reconcile/).waitFor();
    await p
      .getByRole("button", {
        name: "Load latest result (keep entered text)",
        exact: true,
      })
      .click();
    await p
      .getByRole("button", {
        name: "Manage resource: Uncertain resource",
        exact: true,
      })
      .click();
    await p
      .getByRole("button", {
        name: "I checked the result; allow another action",
      })
      .waitFor();
    f.detailStatus = 503;
    await p
      .getByRole("button", {
        name: "Manage resource: Uncertain resource",
        exact: true,
      })
      .click();
    await p
      .getByRole("alert")
      .filter({ hasText: "temporarily unavailable" })
      .waitFor();
    assert.equal(
      await p
        .getByRole("button", {
          name: "I checked the result; allow another action",
        })
        .count(),
      0,
    );
    assert.equal(
      await p
        .getByLabel("Resource text (maximum 20,000 characters)")
        .inputValue(),
      "Retained content",
    );
    await p.locator(".skip-link").focus();
    await p.keyboard.press("Enter");
    await p.waitForURL(`${origin}/admin/resources#main-content`);
    assert.equal(
      await p.evaluate(() => document.activeElement.id),
      "main-content",
    );
    await p.evaluate(() => history.back());
    await p.locator("[data-navigation-notice]").waitFor();
    await p.waitForURL(`${origin}/admin/resources#main-content`);
    assert.equal(
      await p
        .getByLabel("Resource text (maximum 20,000 characters)")
        .inputValue(),
      "Retained content",
    );
    assert.equal(
      f.calls.filter((c) => c.method === "POST" && c.path === "/resources")
        .length,
      1,
    );
  } finally {
    await f.close();
  }
});

test("Phase 2 create validates required fields, saves exact content and reopens server detail", async () => {
  const f = await fixture(admin);
  try {
    const p = f.page;
    await f.goto("/admin/resources");
    await p
      .getByRole("button", { name: "Create resource", exact: true })
      .click();
    await p.getByRole("button", { name: "Save resource", exact: true }).click();
    assert.equal(f.calls.filter((c) => c.method === "POST").length, 0);
    assert.equal(
      await p
        .getByLabel("Title (maximum 200 characters)")
        .evaluate((el) => el.validity.valueMissing),
      true,
    );
    await p.getByLabel("Title (maximum 200 characters)").fill("New resource");
    await p
      .getByLabel("Source reference (maximum 1,000 characters)")
      .fill("New citation");
    await p
      .getByLabel("Resource text (maximum 20,000 characters)")
      .fill("New content");
    await p.getByRole("button", { name: "Save resource", exact: true }).click();
    await p
      .getByText("Resource saved. Reload the list to update browsing.", {
        exact: true,
      })
      .waitFor();
    assert.deepEqual(f.calls.find((c) => c.method === "POST").body, {
      title: "New resource",
      subject: "Mathematics",
      grade: "Grade 4",
      sourceReference: "New citation",
      contentText: "New content",
    });
    await p.getByRole("button", { name: "Back to resource list" }).click();
    await p.getByRole("button", { name: "Reload list", exact: true }).click();
    await p
      .getByRole("button", {
        name: "Manage resource: New resource",
        exact: true,
      })
      .click();
    await p.getByText("New content", { exact: true }).waitFor();
  } finally {
    await f.close();
  }
});

test("Phase 2 admin conflict requires comparison and explicit version adoption before replacement save", async () => {
  const f = await fixture(admin);
  try {
    const p = f.page;
    await openResource(f);
    f.writeStatus = 409;
    await p.getByRole("button", { name: "Save resource", exact: true }).click();
    await p
      .getByRole("alert")
      .filter({ hasText: "Resource changed or is retired" })
      .waitFor();
    f.resource = { ...f.resource, title: "Winning content", version: 3 };
    await p
      .getByRole("button", {
        name: "Load latest result (keep entered text)",
        exact: true,
      })
      .click();
    const adopt = p.getByRole("button", {
      name: "Use displayed version 3 with my entered text",
    });
    await adopt.waitFor();
    assert.equal(
      await p.getByLabel("Title (maximum 200 characters)").inputValue(),
      "Retained administrator text",
    );
    assert.equal(f.calls.filter((c) => c.method === "PUT").length, 1);
    await adopt.click();
    f.writeStatus = 200;
    await p.getByRole("button", { name: "Save resource", exact: true }).click();
    await p
      .getByText("Resource saved. Reload the list to update browsing.", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      f.calls.filter((c) => c.method === "PUT").at(-1).body.expectedVersion,
      3,
    );
  } finally {
    await f.close();
  }
});

test("Phase 3 editor keeps array item text exact and Save visible while scrolling", async () => {
  const f = await fixture(teacher);
  try {
    const p = f.page;
    await f.goto("/drafts");
    await p
      .getByRole("button", { name: "New manual draft", exact: true })
      .click();
    await p.getByLabel("Title", { exact: true }).fill("Exact draft");
    await p
      .getByRole("button", { name: "Add learning objectives item" })
      .click();
    await p
      .getByLabel("Learning objectives, item 1")
      .fill("First line\nsecond line");
    await p.getByRole("button", { name: "Add materials item" }).click();
    await p.getByLabel("Materials, item 1").fill("  paper\nstrips  ");
    await p.getByLabel("Introduction duration (minutes)").fill("0");
    await p
      .getByRole("button", { name: "Save draft content", exact: true })
      .click();
    await p
      .getByText("Draft saved. No submitted revision was created.")
      .waitFor();
    const create = f.calls
      .filter((call) => call.method === "POST" && call.path === "/lessons")
      .at(-1);
    assert.deepEqual(create.body.content.learningObjectives, [
      "First line\nsecond line",
    ]);
    assert.deepEqual(create.body.content.materials, ["  paper\nstrips  "]);
    assert.equal(create.body.content.introduction.durationMinutes, 0);
    await p
      .getByRole("button", { name: "Close editor and discard unsaved text" })
      .click();
    await p.getByRole("button", { name: /Open draft: Exact draft/ }).click();
    assert.equal(
      await p.getByLabel("Learning objectives, item 1").inputValue(),
      "First line\nsecond line",
    );
    assert.equal(
      await p.getByLabel("Materials, item 1").inputValue(),
      "  paper\nstrips  ",
    );
    assert.equal(
      await p.getByLabel("Introduction duration (minutes)").inputValue(),
      "0",
    );
    await p.getByLabel("Learning objectives, item 1").fill("Line A\nLine B");
    assert.equal(
      await p
        .getByRole("status")
        .filter({ hasText: "Unsaved changes." })
        .count(),
      1,
    );
    const save = p.getByRole("button", {
      name: "Save draft content",
      exact: true,
    });
    for (const width of [320, 390, 768, 1024, 1440]) {
      await p.setViewportSize({ width, height: 760 });
      await p
        .getByLabel("Differentiation: extension activities")
        .scrollIntoViewIfNeeded();
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.equal(await save.isVisible(), true);
      const box = await save.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= 760);
    }
    await save.click();
    await p
      .getByText("Draft saved. No submitted revision was created.")
      .waitFor();
    const write = f.calls.filter((call) => call.method === "PUT").at(-1);
    assert.deepEqual(write.body.content.learningObjectives, ["Line A\nLine B"]);
    assert.deepEqual(write.body.content.materials, ["  paper\nstrips  "]);
    assert.equal(write.body.content.introduction.durationMinutes, 0);
  } finally {
    await f.close();
  }
});

test("Phase 3 handoff: draft cards, local focus, optional context and native validation", async () => {
  const f = await fixture(teacher);
  const p = f.page;
  try {
    await f.goto("/drafts");
    const list = p.getByRole("list", { name: "My saved drafts", exact: true });
    await list
      .getByRole("heading", { name: "Saved lesson", exact: true })
      .waitFor();
    assert.equal(
      await list.locator("time").getAttribute("datetime"),
      lesson.updatedAt,
    );
    await list
      .getByRole("button", { name: /Open draft: Saved lesson/ })
      .click();
    await p.waitForFunction(
      () => document.activeElement?.id === "draft-editor-heading",
    );
    assert.equal(await list.count(), 0);
    assert.equal(new URL(p.url()).pathname, "/drafts");
    assert.equal(
      await p.getByLabel("Subject", { exact: true }).inputValue(),
      "",
    );
    assert.equal(await p.getByLabel("Grade", { exact: true }).inputValue(), "");
    await p.getByLabel("Title", { exact: true }).focus();
    await p.keyboard.press("Tab");
    assert.equal(
      await p.evaluate(() => document.activeElement?.id),
      "lesson-subject",
    );
    await p.keyboard.press("Tab");
    assert.equal(
      await p.evaluate(() => document.activeElement?.id),
      "lesson-grade",
    );
    const minutes = p.getByLabel("Total duration (minutes)");
    await minutes.fill("1441");
    await p
      .getByRole("button", { name: "Save draft content", exact: true })
      .click();
    assert.equal(f.calls.filter((c) => c.method === "PUT").length, 0);
    assert.equal(await minutes.getAttribute("aria-invalid"), "true");
    assert.equal(
      await minutes.evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(
      await minutes.evaluate((el) =>
        el
          .getAttribute("aria-describedby")
          .split(" ")
          .every((id) => document.getElementById(id)?.textContent),
      ),
      true,
    );
    await minutes.fill("0");
    await p.getByLabel("Subject", { exact: true }).selectOption("Mathematics");
    await p
      .getByRole("button", { name: "Save draft content", exact: true })
      .click();
    await p
      .getByText("Draft saved. No submitted revision was created.")
      .waitFor();
    let content = f.calls.filter((c) => c.method === "PUT").at(-1).body.content;
    assert.equal(content.subject, "Mathematics");
    assert.equal(content.durationMinutes, 0);
    for (const key of ["grade", "learningObjectives", "materials"])
      assert.equal(Object.hasOwn(content, key), false);
    await p.getByLabel("Subject", { exact: true }).selectOption("");
    await minutes.fill("");
    await p
      .getByRole("button", { name: "Save draft content", exact: true })
      .click();
    await p
      .getByText("Draft saved. No submitted revision was created.")
      .waitFor();
    content = f.calls.filter((c) => c.method === "PUT").at(-1).body.content;
    for (const key of [
      "subject",
      "grade",
      "durationMinutes",
      "learningObjectives",
      "materials",
    ])
      assert.equal(Object.hasOwn(content, key), false);
    await p
      .getByRole("button", { name: "Close editor and discard unsaved text" })
      .click();
    await p.waitForFunction(
      () => document.activeElement?.id === "drafts-heading",
    );
    assert.equal(await list.isVisible(), true);
  } finally {
    await f.close();
  }
});

test("Phase 3 handoff: responsive writing and snapshots retain separate versioned actions", async () => {
  const f = await fixture(teacher);
  const p = f.page;
  try {
    const { title, subject, grade, sourceReference, contentText } = f.resource;
    f.lesson.sources = [
      {
        resourceId,
        resourceVersion: 1,
        snapshot: { title, subject, grade, sourceReference, contentText },
      },
    ];
    f.resource = {
      ...f.resource,
      version: 2,
      contentText: "Updated source text",
    };
    await openLesson(f);
    const sources = p.getByRole("region", {
      name: "Selected resource snapshots (saved separately)",
      exact: true,
    });
    await sources
      .getByRole("heading", { name: "Saved resource · Selected version 1" })
      .waitFor();
    await sources
      .getByText("Read retained resource text", { exact: true })
      .click();
    assert.equal(
      await sources.getByText("Test text", { exact: true }).isVisible(),
      true,
    );
    assert.equal(
      await sources.getByText("Updated source text", { exact: true }).count(),
      0,
    );
    const save = p.getByRole("button", {
      name: "Save draft content",
      exact: true,
    });
    for (const width of [320, 390, 768, 1024, 1440]) {
      await p.setViewportSize({ width, height: 900 });
      const columns = await p
        .locator("[data-draft-columns]")
        .evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
        );
      assert.equal(columns, width >= 1280 ? 2 : 1);
      const titleField = p.getByLabel("Title", { exact: true });
      await titleField.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await titleField.focus();
      const titleBox = await titleField.boundingBox();
      const saveBar = await p
        .getByRole("region", { name: "Draft save controls", exact: true })
        .boundingBox();
      assert.ok(
        titleBox && saveBar && titleBox.y >= saveBar.y + saveBar.height,
      );
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await p.screenshot({
        path: `/tmp/lessonforge-phase3-handoff-writing-${width}.png`,
      });
      await sources
        .getByRole("heading", {
          name: "Saved resource · Selected version 1",
          exact: true,
        })
        .evaluate((el) => {
          window.scrollBy({ top: el.getBoundingClientRect().top - 160 });
        });
      const bar = await p
        .getByRole("region", { name: "Draft save controls", exact: true })
        .boundingBox();
      const button = await save.boundingBox();
      assert.ok(
        bar && button && button.y >= 0 && button.y + button.height <= 900,
      );
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await p.screenshot({
        path: `/tmp/lessonforge-phase3-handoff-sources-${width}.png`,
      });
    }
    await sources
      .getByRole("button", {
        name: "Refresh from latest active resource",
        exact: true,
      })
      .click();
    await sources.getByText("Updated source text", { exact: true }).waitFor();
    assert.equal(
      await p.getByLabel("Title", { exact: true }).inputValue(),
      "Retained lesson text",
    );
    assert.equal(f.calls.filter((c) => c.method === "PUT").length, 0);
    let sourceWrite = f.calls.filter((c) => c.path.endsWith("/refresh")).at(-1);
    assert.deepEqual(sourceWrite.body, { expectedVersion: 1 });
    await save.click();
    await p
      .getByText("Draft saved. No submitted revision was created.")
      .waitFor();
    assert.equal(
      f.calls.filter((c) => c.method === "PUT").at(-1).body.expectedVersion,
      2,
    );
    assert.equal(f.lesson.sources[0].resourceVersion, 2);
    await p
      .getByLabel("Title", { exact: true })
      .fill("Unsaved after source refresh");
    await sources
      .getByRole("button", { name: "Remove selection", exact: true })
      .click();
    await sources
      .getByText("No resources selected.", { exact: false })
      .waitFor();
    assert.deepEqual(
      f.calls.filter((c) => c.path.endsWith("/remove")).at(-1).body,
      { expectedVersion: 3 },
    );
    await sources
      .getByRole("button", { name: "Browse active resources", exact: true })
      .click();
    await sources
      .getByRole("button", { name: "Saved resource · Version 2", exact: true })
      .click();
    await sources
      .getByRole("button", {
        name: "Select latest active resource",
        exact: true,
      })
      .click();
    await sources
      .getByRole("heading", { name: "Saved resource · Selected version 2" })
      .waitFor();
    sourceWrite = f.calls.filter((c) => c.path.endsWith("/select")).at(-1);
    assert.deepEqual(sourceWrite.body, { expectedVersion: 4 });
    assert.equal(
      await p.getByLabel("Title", { exact: true }).inputValue(),
      "Unsaved after source refresh",
    );
    assert.equal(f.calls.filter((c) => c.method === "PUT").length, 1);
  } finally {
    await f.close();
  }
});

test("Phase 3 corrections: R1 timing feedback follows current validity after activity removal", async () => {
  const f = await fixture();
  const p = f.page;
  try {
    f.lesson.content.activities = [
      { teacherTasks: "  first\nactivity  ", durationMinutes: 1 },
      { learnerTasks: "  retained\ntext  ", durationMinutes: 5 },
    ];
    await f.goto("/drafts");
    await p.getByRole("button", { name: /Open draft: Saved lesson/ }).click();
    const timings = p.getByLabel("Activity duration (minutes)", {
      exact: true,
    });
    await timings.nth(0).fill("1441");
    assert.equal(await timings.nth(0).getAttribute("aria-invalid"), "true");
    await p
      .getByRole("group", { name: "Activity 1", exact: true })
      .getByRole("button", { name: "Remove activity 1", exact: true })
      .click();
    const remaining = timings.first();
    const assertValid = async () => {
      assert.equal(await timings.count(), 1);
      assert.equal(await remaining.inputValue(), "5");
      assert.equal(await remaining.evaluate((el) => el.validity.valid), true);
      assert.equal(await remaining.getAttribute("aria-invalid"), null);
      assert.equal(
        await p.getByRole("alert").filter({ hasText: /\S/ }).count(),
        0,
      );
      assert.equal(
        await remaining.evaluate((el) =>
          el
            .getAttribute("aria-describedby")
            .split(" ")
            .some(
              (id) =>
                document.getElementById(id)?.getAttribute("role") === "alert",
            ),
        ),
        false,
      );
    };
    await assertValid();
    await p
      .getByRole("button", { name: "Save draft content", exact: true })
      .click();
    await p
      .getByText("Draft saved. No submitted revision was created.")
      .waitFor();
    await assertValid();
    assert.deepEqual(
      f.calls.filter((c) => c.method === "PUT").map((c) => c.body),
      [
        {
          expectedVersion: 1,
          content: {
            title: "Saved lesson",
            introduction: { text: "Saved introduction" },
            activities: [
              { learnerTasks: "  retained\ntext  ", durationMinutes: 5 },
            ],
          },
        },
      ],
    );
  } finally {
    await f.close();
  }
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`Phase 3 corrections: D1 initial open/create and scrolled Save at ${width}px`, async () => {
    const f = await fixture();
    const p = f.page;
    try {
      await p.setViewportSize({ width, height: 900 });
      await f.goto("/drafts");
      for (const mode of ["open", "create"]) {
        await p
          .getByRole("button", {
            name:
              mode === "open" ? /Open draft: Saved lesson/ : "New manual draft",
            exact: mode === "create",
          })
          .click();
        await p.waitForFunction(
          () => document.activeElement?.id === "draft-editor-heading",
        );
        assert.equal(
          await p
            .getByText("Create a draft or open one of your saved drafts.", {
              exact: true,
            })
            .count(),
          0,
        );
        assert.equal(
          await p.getByText("No lesson is open.", { exact: false }).count(),
          0,
        );
        assert.equal(
          await p
            .locator("details")
            .filter({
              has: p.locator("summary", { hasText: "Draft help and limits" }),
            })
            .getAttribute("open"),
          null,
        );
        assert.equal(
          await p
            .locator("details")
            .filter({
              has: p.locator("summary", {
                hasText: "Compare saved content and recover",
              }),
            })
            .getAttribute("open"),
          null,
        );
        const titleBox = await p
          .getByLabel("Title", { exact: true })
          .boundingBox();
        const save = p.getByRole("button", {
          name: "Save draft content",
          exact: true,
        });
        const saveBox = await save.boundingBox();
        assert.ok(
          titleBox && titleBox.y >= 0 && titleBox.y + titleBox.height <= 900,
          `Initial ${mode} title outside viewport: ${JSON.stringify(titleBox)}`,
        );
        assert.ok(
          saveBox && saveBox.y >= 0 && saveBox.y + saveBox.height <= 900,
        );
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await p.screenshot({
          path: `/tmp/lessonforge-phase3-corrections-${mode}-${width}.png`,
        });
        await p
          .getByLabel("Differentiation: extension activities")
          .scrollIntoViewIfNeeded();
        const scrolled = await save.boundingBox();
        assert.ok(
          scrolled && scrolled.y >= 0 && scrolled.y + scrolled.height <= 900,
        );
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        if (mode === "open") {
          await p
            .getByRole("button", {
              name: "Close editor and discard unsaved text",
            })
            .click();
          await p
            .getByRole("button", { name: "New manual draft", exact: true })
            .waitFor({ state: "visible" });
          await p.waitForFunction(
            () =>
              !document.querySelector('button[aria-label^="Open draft"]')
                ?.disabled,
          );
        }
      }
      assert.equal(f.calls.filter((c) => c.method !== "GET").length, 0);
    } finally {
      await f.close();
    }
  });
}

test("Phase 3 corrections: D1 disclosures and comparison reads never write or adopt; failed inspection and conflict expose recovery", async () => {
  const f = await fixture();
  const p = f.page;
  try {
    await openLesson(f);
    const details = p.locator("details").filter({
      has: p.locator("summary", {
        hasText: "Compare saved content and recover",
      }),
    });
    const summary = details.locator(":scope > summary");
    const read = p.getByRole("button", {
      name: "Load latest result (keep entered text and version)",
      exact: true,
    });
    await summary.focus();
    await p.keyboard.press("Enter");
    assert.equal(await read.isVisible(), true);
    const requestsBeforeToggle = f.calls.length;
    await p.keyboard.press("Space");
    assert.equal(await details.getAttribute("open"), null);
    await p.keyboard.press("Space");
    assert.equal(await read.isVisible(), true);
    assert.equal(f.calls.length, requestsBeforeToggle);
    assert.equal(f.calls.filter((c) => c.method !== "GET").length, 0);
    f.lesson = {
      ...f.lesson,
      title: "Other writer",
      version: 3,
      content: { title: "Other writer" },
    };
    await read.click();
    await p
      .getByRole("heading", { name: "Latest saved result · Version 3" })
      .waitFor();
    assert.equal(
      await p.getByLabel("Title", { exact: true }).inputValue(),
      "Retained lesson text",
    );
    assert.equal(
      await p
        .getByRole("heading", { name: "Edit draft · based on version 1" })
        .isVisible(),
      true,
    );
    assert.equal(f.calls.filter((c) => c.method !== "GET").length, 0);
    const held = (f.detailHold = deferred());
    const detailStarted = (f.detailStarted = deferred());
    f.detailStatus = 503;
    const readsBefore = f.calls.filter(
      (c) => c.path === `/lessons/${id}`,
    ).length;
    await read.click();
    await detailStarted.promise;
    await p.waitForFunction(
      () =>
        document
          .querySelector('section[aria-labelledby="draft-editor-heading"]')
          ?.getAttribute("aria-busy") === "true",
    );
    assert.equal(
      f.calls.filter((c) => c.path === `/lessons/${id}`).length,
      readsBefore + 1,
    );
    await summary.click();
    assert.equal(await details.getAttribute("open"), null);
    held.resolve();
    await p
      .getByRole("alert")
      .filter({ hasText: "temporarily unavailable" })
      .waitFor();
    await read.waitFor({ state: "visible" });
    assert.equal(await details.getAttribute("open"), "");
    assert.equal(
      await p
        .getByRole("heading", { name: "Latest saved result · Version 3" })
        .count(),
      0,
    );
    assert.equal(
      await p
        .getByRole("button", {
          name: "I checked the result; allow another action",
        })
        .count(),
      0,
    );
    assert.equal(f.calls.filter((c) => c.method !== "GET").length, 0);
    await summary.click();
    f.writeStatus = 409;
    await p
      .getByRole("button", { name: "Save draft content", exact: true })
      .click();
    await p
      .getByText("Saving is paused after a conflict.", { exact: false })
      .waitFor();
    assert.equal(await details.getAttribute("open"), "");
    assert.equal(
      await p
        .getByRole("button", { name: "Save draft content", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await p.getByLabel("Title", { exact: true }).inputValue(),
      "Retained lesson text",
    );
    assert.equal(f.calls.filter((c) => c.method === "PUT").length, 1);
  } finally {
    await f.close();
  }
});

test("Phase 3 corrections: D2 distinct creation ID and renamed summaries reopen without manual Reload", async () => {
  const f = await fixture();
  const p = f.page;
  try {
    f.creationId = "55555555-5555-4555-8555-555555555555";
    await f.goto("/drafts");
    await p
      .getByRole("button", { name: "New manual draft", exact: true })
      .click();
    await p.getByLabel("Title", { exact: true }).fill("New distinct draft");
    await p
      .getByRole("button", { name: "Save draft content", exact: true })
      .click();
    await p
      .getByText("Draft saved. No submitted revision was created.")
      .waitFor();
    for (const [name, version] of [
      ["New distinct draft", 1],
      ["Renamed distinct draft", 2],
    ]) {
      const listReads = f.calls.filter(
        (c) => c.method === "GET" && c.path === "/lessons",
      ).length;
      await p
        .getByRole("button", { name: "Close editor and discard unsaved text" })
        .click();
      await p
        .getByRole("button", {
          name: `Open draft: ${name} · Saved version ${version}`,
          exact: true,
        })
        .click();
      assert.equal(
        f.calls.filter((c) => c.method === "GET" && c.path === "/lessons")
          .length,
        listReads + 1,
      );
      assert.equal(
        f.calls.filter(
          (c) => c.path === `/lessons/${f.creationId}` && c.method === "GET",
        ).length,
        version,
      );
      assert.equal(
        await p.getByLabel("Title", { exact: true }).inputValue(),
        name,
      );
      if (version === 1) {
        await p
          .getByLabel("Title", { exact: true })
          .fill("Renamed distinct draft");
        await p
          .getByRole("button", { name: "Save draft content", exact: true })
          .click();
        await p
          .getByText("Draft saved. No submitted revision was created.")
          .waitFor();
      }
    }
    assert.equal(
      f.calls.filter((c) => c.method === "POST" && c.path === "/lessons")
        .length,
      1,
    );
    assert.deepEqual(
      f.calls
        .filter((c) => c.method === "PUT")
        .map((c) => ({ path: c.path, version: c.body.expectedVersion })),
      [{ path: `/lessons/${f.creationId}`, version: 1 }],
    );
  } finally {
    await f.close();
  }
});

test("Phase 3 corrections: D2 returned-list loading and failure require explicit read recovery", async () => {
  const f = await fixture();
  const p = f.page;
  try {
    await f.goto("/drafts");
    await p.getByRole("button", { name: /Open draft: Saved lesson/ }).click();
    f.listStatus = 503;
    const held = (f.listHold = deferred());
    const listStarted = (f.listStarted = deferred());
    await p
      .getByRole("button", { name: "Close editor and discard unsaved text" })
      .click();
    await p
      .getByRole("status")
      .filter({ hasText: /^Loading…$/ })
      .waitFor();
    await listStarted.promise;
    assert.equal(
      await p.getByText("No drafts on this page.", { exact: true }).count(),
      0,
    );
    assert.equal(
      await p.getByRole("button", { name: /Open draft:/ }).count(),
      0,
    );
    assert.equal(
      await p
        .getByRole("button", { name: "Reload drafts", exact: true })
        .isDisabled(),
      true,
    );
    held.resolve();
    await p
      .getByRole("alert")
      .filter({ hasText: "temporarily unavailable" })
      .waitFor();
    assert.equal(
      await p.getByText("No drafts on this page.", { exact: true }).count(),
      0,
    );
    f.listStatus = 200;
    await p.getByRole("button", { name: "Reload drafts", exact: true }).click();
    await p.getByRole("button", { name: /Open draft: Saved lesson/ }).waitFor();
    assert.equal(
      await p.getByRole("alert").filter({ hasText: /\S/ }).count(),
      0,
    );
    assert.equal(f.calls.filter((c) => c.method !== "GET").length, 0);
  } finally {
    await f.close();
  }
});

test("Phase 3 corrections: D2 late return response cannot populate a replacement session", async () => {
  const f = await fixture();
  const p = f.page;
  try {
    await f.goto("/drafts");
    await p.getByRole("button", { name: /Open draft: Saved lesson/ }).click();
    const held = (f.listHold = deferred());
    const listStarted = (f.listStarted = deferred());
    await p
      .getByRole("button", { name: "Close editor and discard unsaved text" })
      .click();
    await p
      .getByRole("status")
      .filter({ hasText: /^Loading…$/ })
      .waitFor();
    await listStarted.promise;
    f.listHold = null;
    f.identity = { ...teacher, expiresAt: "2031-01-01T08:00:00.000Z" };
    f.lesson = {
      ...f.lesson,
      title: "Replacement session result",
      content: { title: "Replacement session result" },
    };
    await account(p)
      .getByRole("button", { name: "Check session again", exact: true })
      .click();
    await p
      .getByRole("button", { name: /Open draft: Replacement session result/ })
      .waitFor();
    held.resolve();
    await p.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(
      await p.getByRole("button", { name: /Open draft: Saved lesson/ }).count(),
      0,
    );
    await p
      .getByRole("button", { name: /Open draft: Replacement session result/ })
      .click();
    assert.equal(
      await p.getByLabel("Title", { exact: true }).inputValue(),
      "Replacement session result",
    );
    assert.equal(f.calls.filter((c) => c.method !== "GET").length, 0);
  } finally {
    await f.close();
  }
});

test("Phase 3 corrections: R1 a shifted invalid activity gets its own current native feedback", async () => {
  const f = await fixture();
  const p = f.page;
  try {
    f.lesson.content.activities = [
      { durationMinutes: 1 },
      { durationMinutes: 5 },
    ];
    await f.goto("/drafts");
    await p.getByRole("button", { name: /Open draft: Saved lesson/ }).click();
    const timings = p.getByLabel("Activity duration (minutes)", {
      exact: true,
    });
    await timings.nth(0).fill("1441");
    await timings.nth(1).fill("-1");
    await p
      .getByRole("button", { name: "Remove activity 1", exact: true })
      .click();
    const remaining = timings.first();
    assert.equal(await remaining.inputValue(), "-1");
    assert.equal(await remaining.getAttribute("aria-invalid"), "true");
    const message = await remaining.evaluate((el) => el.validationMessage);
    assert.equal(
      await p
        .getByRole("group", { name: "Activity 1", exact: true })
        .getByRole("alert")
        .textContent(),
      message,
    );
    assert.equal(
      await p
        .getByText("Value must be less than or equal to 1440.", { exact: true })
        .count(),
      0,
    );
    await remaining.fill("0");
    assert.equal(await remaining.getAttribute("aria-invalid"), null);
    assert.equal(
      await p.getByRole("alert").filter({ hasText: /\S/ }).count(),
      0,
    );
    await p
      .getByRole("button", { name: "Save draft content", exact: true })
      .click();
    await p
      .getByText("Draft saved. No submitted revision was created.")
      .waitFor();
    assert.deepEqual(
      f.calls.filter((c) => c.method === "PUT").at(-1).body.content.activities,
      [{ durationMinutes: 0 }],
    );
  } finally {
    await f.close();
  }
});

test("Phase 3 corrections: R1 local row identity separates invalid native text from an unset timing", async () => {
  const f = await fixture();
  const p = f.page;
  try {
    f.lesson.content.activities = [{}, {}];
    await f.goto("/drafts");
    await p.getByRole("button", { name: /Open draft: Saved lesson/ }).click();
    const timings = p.getByLabel("Activity duration (minutes)", {
      exact: true,
    });
    await timings.nth(0).press("e");
    assert.equal(
      await timings.nth(0).evaluate((el) => el.validity.badInput),
      true,
    );
    await p
      .getByRole("button", { name: "Save draft content", exact: true })
      .click();
    assert.equal(f.calls.filter((c) => c.method === "PUT").length, 0);
    assert.equal(await timings.nth(0).getAttribute("aria-invalid"), "true");
    assert.equal(
      await timings.nth(1).evaluate((el) => el.validity.valid),
      true,
    );
    await p
      .getByRole("button", { name: "Remove activity 1", exact: true })
      .click();
    assert.equal(await timings.count(), 1);
    assert.equal(await timings.first().inputValue(), "");
    assert.equal(
      await timings.first().evaluate((el) => el.validity.valid),
      true,
    );
    assert.equal(await timings.first().getAttribute("aria-invalid"), null);
    assert.equal(
      await p.getByRole("alert").filter({ hasText: /\S/ }).count(),
      0,
    );
    await p
      .getByRole("button", { name: "Save draft content", exact: true })
      .click();
    await p
      .getByText("Draft saved. No submitted revision was created.")
      .waitFor();
    assert.deepEqual(
      f.calls.filter((c) => c.method === "PUT").at(-1).body.content.activities,
      [{}],
    );
  } finally {
    await f.close();
  }
});

test("Phase 3 corrections: D2 paused return read never reports a confirmed empty page or resumes itself", async () => {
  const f = await fixture();
  const p = f.page;
  try {
    await f.goto("/drafts");
    await p.getByRole("button", { name: /Open draft: Saved lesson/ }).click();
    f.lessonPage = { items: [], nextAfter: null };
    const held = (f.listHold = deferred());
    const started = (f.listStarted = deferred());
    await p
      .getByRole("button", { name: "Close editor and discard unsaved text" })
      .click();
    await started.promise;
    f.meStatus = 503;
    await account(p)
      .getByRole("button", { name: "Check session again", exact: true })
      .click();
    await p
      .getByText(
        "Draft controls are paused while your session is unconfirmed.",
        { exact: false },
      )
      .waitFor();
    held.resolve();
    const reads = f.calls.filter(
      (c) => c.method === "GET" && c.path === "/lessons",
    ).length;
    f.meStatus = 200;
    f.listHold = null;
    await account(p)
      .getByRole("button", { name: "Check session again", exact: true })
      .click();
    const reload = p.getByRole("button", {
      name: "Reload drafts",
      exact: true,
    });
    await p
      .getByText(
        "Draft controls are paused while your session is unconfirmed.",
        { exact: false },
      )
      .waitFor({ state: "hidden" });
    await p.waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].find(
          (b) => b.textContent.trim() === "Reload drafts",
        )?.disabled,
    );
    assert.equal(
      await p
        .getByText("Load drafts to see your saved lessons.", { exact: true })
        .isVisible(),
      true,
    );
    assert.equal(
      await p.getByText("No drafts on this page.", { exact: true }).count(),
      0,
    );
    assert.equal(
      f.calls.filter((c) => c.method === "GET" && c.path === "/lessons").length,
      reads,
    );
    await reload.click();
    await p.getByText("No drafts on this page.", { exact: true }).waitFor();
    assert.equal(
      f.calls.filter((c) => c.method === "GET" && c.path === "/lessons").length,
      reads + 1,
    );
    assert.equal(f.calls.filter((c) => c.method !== "GET").length, 0);
  } finally {
    await f.close();
  }
});
