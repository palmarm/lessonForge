import assert from "node:assert/strict";
import { test } from "node:test";
import { createResourcesApi } from "../src/lib/resources-api.ts";
import { createResourcesState } from "../src/lib/resources-state.ts";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const content = {
  title: "My original fractions demonstration",
  subject: "Mathematics",
  grade: "Grade 4",
  sourceReference: "Original demonstration citation",
  contentText: "One half is one of two equal parts.\nCompare two quarters.",
};
const resource = {
  ...content,
  id,
  version: 1,
  retiredAt: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
};
const summary = ({ sourceReference, contentText, ...value }) => {
  void sourceReference;
  void contentText;
  return value;
};

// Exercise the real transport, response validator, and state store together.
// The in-memory server can commit before returning an infrastructure failure.
function fixture(status, operation, committed = true) {
  const requests = [];
  let saved = operation === "create" ? null : { ...resource };
  let failed = false;
  let detailResponse;
  let page;
  let ended = 0;
  const api = createResourcesApi(
    "http://localhost:3001",
    async (url, options) => {
      const path = new URL(url).pathname;
      requests.push({ path, method: options.method, body: options.body });
      if (options.method === "GET") {
        if (path === "/resources") {
          const result = page ?? {
            items: saved ? [summary(saved)] : [],
            nextAfter: null,
          };
          const after = new URL(url).searchParams.get("after") ?? "";
          return Response.json({
            ...result,
            items: result.items.filter((item) => item.id > after),
          });
        }
        assert.equal(path, `/resources/${id}`);
        return detailResponse?.() ?? Response.json(saved);
      }
      const body = JSON.parse(options.body);
      const firstWrite = !failed;
      if (!firstWrite || committed) {
        if (operation === "create") {
          assert.equal(path, "/resources");
          assert.equal(
            saved,
            null,
            "a duplicate create must never reach the server",
          );
          saved = { ...resource, ...body };
        } else {
          assert.equal(body.expectedVersion, saved.version);
          saved = {
            ...saved,
            ...(operation === "edit"
              ? Object.fromEntries(
                  Object.entries(body).filter(
                    ([key]) => key !== "expectedVersion",
                  ),
                )
              : { retiredAt: "2030-01-01T00:01:00.000Z" }),
            version: saved.version + 1,
            updatedAt: "2030-01-01T00:01:00.000Z",
          };
        }
      }
      if (firstWrite) {
        failed = true;
        return Response.json(
          { message: "private upstream diagnostic" },
          { status },
        );
      }
      return Response.json(saved, {
        status: operation === "create" ? 201 : 200,
      });
    },
  );
  const store = createResourcesState(api, "ADMIN", () => ended++);
  return {
    store,
    requests,
    writes: () => requests.filter((request) => request.method !== "GET"),
    saved: () => saved,
    ended: () => ended,
    page: (value) => {
      page = value;
    },
    detail: (response) => {
      detailResponse = response;
    },
  };
}
function enter(store) {
  store.create();
  for (const field of ["title", "sourceReference", "contentText"])
    store.field(field, content[field]);
}

test("500/502/503/504 create failures block duplicate POSTs before reconciliation, including committed writes", async (t) => {
  for (const status of [500, 502, 503, 504]) {
    for (const committed of [false, true]) {
      await t.test(`${status}, committed=${committed}`, async () => {
        const f = fixture(status, "create", committed);
        enter(f.store);
        await f.store.save();
        assert.deepEqual(f.store.getSnapshot().uncertain, {
          type: "create",
          targetId: null,
        });
        assert.deepEqual(f.store.getSnapshot().form, content);
        assert.equal(f.store.getSnapshot().reconciled, false);
        assert.doesNotMatch(f.store.getSnapshot().error, /private/);
        assert.equal(f.saved() !== null, committed);
        f.store.cancel();
        f.store.create();
        f.store.acknowledge();
        await f.store.save();
        assert.equal(f.writes().length, 1);
        assert.deepEqual(f.store.getSnapshot().form, content);

        await f.store.reconcile();
        assert.equal(f.store.getSnapshot().reconciled, true);
        await f.store.save(); // A read alone does not authorize another write.
        assert.equal(f.writes().length, 1);
        if (committed) {
          await f.store.view(id);
          assert.deepEqual(f.store.getSnapshot().selected, f.saved());
        }
        f.store.acknowledge();
        assert.equal(f.store.getSnapshot().uncertain, null);
        assert.deepEqual(f.store.getSnapshot().form, content);
        assert.equal(f.writes().length, 1); // Neither reads nor acknowledgement replay a write.
        if (committed) f.store.cancel();
        else await f.store.save(); // An explicit submission after reconciliation is allowed.
        assert.equal(f.writes().length, committed ? 1 : 2);
        assert.deepEqual(f.saved(), resource);
        f.store.dispose();
      });
    }
  }
});

test("uncertain edits and retirement require exact-target detail, never a list or failed/mismatched detail", async (t) => {
  for (const status of [500, 502, 503, 504]) {
    for (const operation of ["edit", "retire"]) {
      await t.test(`${status}, ${operation}`, async () => {
        const f = fixture(status, operation);
        await f.store.view(id);
        if (operation === "edit") {
          f.store.edit();
          f.store.field("title", "My retained edit");
          await f.store.save();
        } else await f.store.retire();
        const uncertain = { type: operation, targetId: id };
        assert.deepEqual(f.store.getSnapshot().uncertain, uncertain);
        assert.equal(f.saved().version, 2); // The first write committed before the response failed.
        const retained = f.store.getSnapshot().form;
        const baseVersion = f.store.getSnapshot().baseVersion;
        const blocked = async () => {
          f.store.acknowledge();
          f.store.cancel();
          f.store.create();
          await f.store.save();
          await f.store.retire();
          assert.deepEqual(f.store.getSnapshot().uncertain, uncertain);
          assert.equal(f.store.getSnapshot().reconciled, false);
          assert.equal(f.store.getSnapshot().form, retained);
          assert.equal(f.store.getSnapshot().baseVersion, baseVersion);
          assert.equal(f.writes().length, 1);
        };
        for (const items of [
          [],
          [summary({ ...resource, id: otherId })],
          [summary(f.saved())],
        ]) {
          f.page({ items, nextAfter: null });
          await f.store.list();
          await f.store.list(otherId); // Even unrelated/empty later pages cannot reconcile the target.
          await blocked();
        }
        await f.store.view(otherId);
        assert.equal(
          f.requests.some((request) => request.path.endsWith(otherId)),
          false,
        );
        for (const response of [
          () => Response.json({}, { status: 404 }),
          () => Response.json({}, { status: 503 }),
          () => Response.json({ ...f.saved(), id: otherId }),
        ]) {
          f.detail(response);
          await f.store.reconcile();
          assert.ok(f.store.getSnapshot().error);
          await blocked();
        }
        f.detail(undefined);
        await f.store.reconcile();
        assert.equal(f.store.getSnapshot().reconciled, true);
        assert.deepEqual(f.store.getSnapshot().selected, f.saved());
        assert.equal(f.store.getSnapshot().form, retained);
        assert.equal(f.store.getSnapshot().baseVersion, baseVersion);
        f.detail(() => Response.json({}, { status: 503 }));
        await f.store.reconcile(); // A new failed reconciliation must not leave acknowledgement enabled.
        await blocked();
        f.detail(undefined);
        await f.store.reconcile();
        f.store.acknowledge();
        assert.equal(f.store.getSnapshot().uncertain, null);
        assert.equal(f.writes().length, 1);
        if (operation === "edit") {
          assert.equal(f.store.getSnapshot().baseVersion, 1);
          f.store.useLatestVersion();
          assert.equal(f.store.getSnapshot().baseVersion, 2);
          assert.equal(f.store.getSnapshot().form, retained);
          await f.store.save();
          assert.equal(f.saved().version, 3);
          assert.equal(f.saved().title, "My retained edit");
        } else {
          f.store.edit();
          assert.equal(f.store.getSnapshot().form, null);
          assert.ok(f.store.getSnapshot().selected.retiredAt);
        }
        f.store.dispose();
      });
    }
  }
});

test("validation, authentication, authorization and conflict rejections retain edits without uncertain-write state", async () => {
  for (const status of [400, 401, 403, 409]) {
    const f = fixture(status, "edit", false);
    await f.store.view(id);
    f.store.edit();
    f.store.field("title", "Retained after rejection");
    await f.store.save();
    assert.equal(f.store.getSnapshot().uncertain, null);
    assert.equal(f.store.getSnapshot().reconciled, false);
    assert.equal(f.store.getSnapshot().form.title, "Retained after rejection");
    assert.equal(f.store.getSnapshot().baseVersion, 1);
    assert.equal(f.saved().version, 1);
    assert.equal(f.ended(), status === 401 ? 1 : 0);
    assert.equal(f.writes().length, 1);
    assert.match(
      f.store.getSnapshot().error,
      {
        400: /required fields/,
        401: /session has ended/,
        403: /blocked/,
        409: /changed or is retired/,
      }[status],
    );
    f.store.dispose();
  }
});
