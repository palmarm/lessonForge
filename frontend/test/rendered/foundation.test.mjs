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
        return respond(200, { items: [summary], nextAfter: null });
      }
      if (url.pathname === `/lessons/${id}`)
        return respond(f.detailStatus, f.lesson);
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
    if (method === "POST" && url.pathname === "/lessons") {
      const { content } = request.postDataJSON();
      f.lesson = {
        ...f.lesson,
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
      .getByRole("button", {
        name: "Load latest result (keep entered text and version)",
        exact: true,
      })
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
    await main.getByRole("heading").evaluateAll((headings) =>
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
    await p.getByRole("button", { name: "Create resource", exact: true }).click();
    await assertHeadingOutline(p, [
      [1, "Manage resources"],
      [2, "Create resource"],
    ]);
    await dialog(p, true, () =>
      p.getByRole("button", { name: "Back to resource list" }).click(),
    );
    await p
      .getByRole("button", { name: "Manage resource: Saved resource", exact: true })
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
    await p.getByRole("button", { name: "Discard entered edits", exact: true }).click();
    await p.getByRole("button", { name: "Retire resource", exact: true }).click();
    await assertHeadingOutline(p, [
      ...detailOutline,
      [3, "Retire “Saved resource”?"],
    ]);
    assert.equal(
      await p.evaluate(() => document.activeElement.id),
      "retire-confirm-heading",
    );
    await p.getByRole("button", { name: "Confirm retirement", exact: true }).click();
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
