"use client";

import {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useWorkspaceNavigation,
  useWorkspaceProtection,
} from "./workspace-navigation";
import { useAuth } from "./auth-provider";
import { createResourcesApi } from "@/lib/resources-api";
import {
  createResourcesState,
  initialResourceState,
  hasUnsavedResourceContent,
} from "@/lib/resources-state";

const button = "button";
const input = "field mt-2";

export function ResourcesPanel() {
  const auth = useAuth();
  if (!auth.identity) return null;
  const user = auth.identity.user;
  const paused = auth.status !== "authenticated" || auth.pending !== null;
  return (
    <div className="w-full max-w-5xl">
      {paused && (
        <p role="status" className="mb-3 text-neutral-700">
          Resource controls are paused while your session is unconfirmed.
          Entered text is retained; use Check session again above if needed.
        </p>
      )}
      <fieldset disabled={paused} className="min-w-0" aria-busy={paused}>
        <legend className="sr-only">Authenticated resource workspace</legend>
        <ResourcesWorkspace
          key={`${user.id}:${user.role}:${auth.identity.expiresAt}`}
          role={user.role}
          paused={paused}
          sessionEnded={auth.endSession}
        />
      </fieldset>
    </div>
  );
}
function ResourcesWorkspace({
  role,
  paused,
  sessionEnded,
}: {
  role: "ADMIN" | "TEACHER";
  paused: boolean;
  sessionEnded: () => void;
}) {
  // The keyed parent isolates identity changes; disposal invalidates/aborts all prior work.
  const [store] = useState(() =>
    createResourcesState(
      createResourcesApi(process.env.NEXT_PUBLIC_API_BASE_URL),
      role,
      sessionEnded,
    ),
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => initialResourceState,
  );
  const [confirmRetire, setConfirmRetire] = useState(false);
  const pathname = usePathname();
  const detailId =
    role === "TEACHER" && pathname.startsWith("/resources/")
      ? pathname.slice("/resources/".length).toLowerCase()
      : null;
  const heading = useRef<HTMLHeadingElement>(null);
  const errorSummary = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    store.activate();
    return store.dispose;
  }, [store]);
  useLayoutEffect(() => {
    store.pause(paused);
  }, [store, paused]);
  useEffect(() => {
    if (role === "TEACHER" && detailId) void store.view(detailId);
    else void store.list();
  }, [store, role, detailId]);
  const editing = !!state.form;
  useEffect(() => {
    (confirmRetire
      ? document.getElementById("retire-confirm-heading")
      : heading.current
    )?.focus();
  }, [detailId, state.selected?.id, editing, confirmRetire]);
  useEffect(() => {
    if (state.error) errorSummary.current?.focus();
  }, [state.error]);
  const navigation = useWorkspaceNavigation();
  useWorkspaceProtection(() => {
    const current = store.getSnapshot();
    return {
      dirty: hasUnsavedResourceContent(current),
      blocked: current.pending === "write" || !!current.uncertain,
      paused,
    };
  });
  const busy = !!state.pending;
  const selected =
    role === "TEACHER" &&
    (!detailId ||
      detailId !== state.selected?.id ||
      state.pending ||
      state.error)
      ? null
      : state.selected;
  const admin = role === "ADMIN";
  const DetailSectionHeading = detailId ? "h2" : "h3";
  // Creation recovery must keep every server page and candidate detail reachable.
  const showList =
    !detailId &&
    (!admin ||
      (!state.form && !selected) ||
      state.uncertain?.type === "create");
  return (
    <section
      aria-labelledby="resources-heading"
      aria-busy={busy}
      className="space-y-6 min-w-0"
    >
      {detailId && (
        <Link className="text-link" href="/resources">
          ← Back to resources
        </Link>
      )}
      <h1
        ref={heading}
        tabIndex={-1}
        id="resources-heading"
        className="page-title"
      >
        {detailId
          ? (selected?.title ?? "Resource")
          : admin
            ? "Manage resources"
            : "Resources"}
      </h1>
      {!detailId && (
        <p className="body-copy max-w-2xl">
          {admin
            ? "Create teaching resources and manage active or retired material. Teachers can only read active resources."
            : "Browse active teaching resources to support your lesson planning. Open a resource to read its teaching materials."}
        </p>
      )}
      <p role="status" className="text-neutral-700">
        {state.pending === "write"
          ? "Saving resource…"
          : state.pending === "read"
            ? "Loading resources…"
            : (state.notice ?? "")}
      </p>
      {state.error && (
        <p
          id="resource-error"
          ref={errorSummary}
          tabIndex={-1}
          role="alert"
          className="feedback"
        >
          {state.error}
        </p>
      )}
      {showList && (
        <div className="flex flex-wrap gap-3">
          <button
            className={button}
            disabled={busy}
            onClick={() => void store.list()}
          >
            Reload list
          </button>
          {admin && (
            <button
              className={button}
              disabled={
                busy || !!state.uncertain || !!state.form || confirmRetire
              }
              onClick={store.create}
            >
              Create resource
            </button>
          )}
        </div>
      )}
      {showList && (
        <ul className="space-y-2" aria-label="Resource list">
          {state.items.map((v) => (
            <li
              key={v.id}
              className="workspace-panel flex min-w-0 flex-col items-start gap-4 xl:flex-row xl:items-center xl:justify-between"
            >
              <div className="min-w-0">
                <h2 className="section-title">{v.title}</h2>
                <p className="text-sm text-neutral-600">
                  {v.subject} · {v.grade} · {v.retiredAt ? "Retired" : "Active"}{" "}
                  · Version {v.version}
                </p>
                <p className="text-sm text-neutral-600">
                  Updated {v.updatedAt}
                </p>
              </div>
              {!admin ? (
                <Link
                  className="button shrink-0"
                  href={`/resources/${v.id}`}
                  aria-label={`View resource: ${v.title}`}
                >
                  View resource →
                </Link>
              ) : (
                <button
                  className={`${button} max-w-full shrink-0 text-left break-words`}
                  aria-label={`${v.retiredAt ? "View retired resource" : "Manage resource"}: ${v.title}`}
                  disabled={
                    busy ||
                    ((!!state.form || state.uncertain) &&
                      !(state.uncertain?.type === "create" && state.form)) ||
                    confirmRetire
                  }
                  onClick={() => void store.view(v.id)}
                >
                  {v.retiredAt ? "View retired resource" : "Manage resource"} →
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {showList && !state.items.length && !busy && !state.error && (
        <p className="text-neutral-600">No resources on this page.</p>
      )}
      {showList && state.nextAfter && (
        <button
          className={button}
          disabled={busy}
          onClick={() => void store.list(state.nextAfter!)}
        >
          Next page
        </button>
      )}
      {detailId && (
        <button
          className={button}
          disabled={busy}
          onClick={() => void store.view(detailId)}
        >
          Reload resource
        </button>
      )}
      {detailId && !selected && !busy && !state.error && (
        <p className="feedback">Load this resource to read its content.</p>
      )}
      {admin && (selected || state.form) && (
        <button
          className="text-link"
          disabled={busy || !!state.uncertain || confirmRetire}
          onClick={() => {
            if (navigation.requestLeave("discard")) {
              store.cancel();
              store.close();
            }
          }}
        >
          ← Back to resource list
        </button>
      )}
      {selected && (
        <article
          aria-labelledby={detailId ? "resources-heading" : "resource-title"}
          className="workspace-panel space-y-5"
        >
          {!detailId && (
            <h2
              id="resource-title"
              className="break-words text-xl font-semibold"
            >
              {selected.title}
            </h2>
          )}
          <p>
            {selected.subject} · {selected.grade} ·{" "}
            {selected.retiredAt ? "Retired" : "Active"} · Version{" "}
            {selected.version}
          </p>
          <p className="text-sm text-neutral-600">Resource ID: {selected.id}</p>
          {selected.retiredAt && (
            <p className="feedback">
              Retired · Read-only. Teachers can no longer browse, select or
              refresh this resource. Existing lesson snapshots remain unchanged.
            </p>
          )}
          <DetailSectionHeading className="font-semibold">
            Source reference
          </DetailSectionHeading>
          <p className="whitespace-pre-wrap break-words">
            {selected.sourceReference}
          </p>
          <DetailSectionHeading className="font-semibold">
            Resource text
          </DetailSectionHeading>
          <p className="whitespace-pre-wrap break-words">
            {selected.contentText}
          </p>
          {admin && !selected.retiredAt && !state.form && (
            <div className="flex flex-wrap gap-3">
              <button
                className={button}
                disabled={busy || !!state.uncertain || confirmRetire}
                onClick={store.edit}
              >
                Edit resource
              </button>
              <button
                className={button}
                disabled={busy || !!state.uncertain || confirmRetire}
                onClick={() => setConfirmRetire(true)}
              >
                Retire resource
              </button>
            </div>
          )}
          {confirmRetire && (
            <div
              role="group"
              aria-labelledby="retire-confirm-heading"
              className="space-y-3 rounded-lg border border-amber-400 bg-amber-50 p-4"
            >
              <h3
                id="retire-confirm-heading"
                tabIndex={-1}
                className="font-semibold"
              >
                Retire “{selected.title}”?
              </h3>
              <p>
                Teachers will no longer see this resource. Existing lesson
                snapshots remain unchanged. This action cannot be reversed here.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  className={button}
                  disabled={busy || !!state.uncertain}
                  onClick={() => {
                    setConfirmRetire(false);
                    void store.retire();
                  }}
                >
                  Confirm retirement
                </button>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => setConfirmRetire(false)}
                >
                  Cancel retirement
                </button>
              </div>
            </div>
          )}
        </article>
      )}
      {state.form && (
        <form
          className="workspace-panel space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void store.save();
          }}
        >
          <h2 className="text-xl font-semibold text-neutral-900">
            {state.editId
              ? `Edit resource (based on version ${state.baseVersion})`
              : "Create resource"}
          </h2>
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border border-neutral-400 bg-white p-4 shadow-sm">
            <p role="status" className="font-semibold">
              {state.pending === "write"
                ? "Saving…"
                : state.uncertain
                  ? "Uncertain outcome · Reconcile before continuing"
                  : hasUnsavedResourceContent(state)
                    ? "Unsaved changes"
                    : "Saved content"}
            </p>
            <button
              className={button}
              type="submit"
              disabled={
                busy ||
                !!state.uncertain ||
                !!(state.editId && selected?.retiredAt)
              }
            >
              Save resource
            </button>
          </div>
          <p className="text-neutral-600">
            All fields are required. Mathematics and Grade 4 are fixed. Source
            reference is citation text; URLs are not fetched.
          </p>
          <fieldset
            disabled={
              busy ||
              !!state.uncertain ||
              !!(state.editId && selected?.retiredAt)
            }
            className="space-y-4 disabled:opacity-60"
          >
            <legend className="sr-only">Resource content</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="resource-subject" className="font-medium">
                  Subject
                </label>
                <input
                  id="resource-subject"
                  className={input}
                  readOnly
                  value={state.form.subject}
                />
              </div>
              <div>
                <label htmlFor="resource-grade" className="font-medium">
                  Grade
                </label>
                <input
                  id="resource-grade"
                  className={input}
                  readOnly
                  value={state.form.grade}
                />
              </div>
            </div>
            <div>
              <label
                className="font-medium text-neutral-900"
                htmlFor="resource-title-input"
              >
                Title (maximum 200 characters)
              </label>
              <input
                className={input}
                id="resource-title-input"
                required
                aria-describedby={state.error ? "resource-error" : undefined}
                maxLength={200}
                value={state.form.title}
                onChange={(e) => store.field("title", e.target.value)}
              />
            </div>
            <div>
              <label
                className="font-medium text-neutral-900"
                htmlFor="resource-reference"
              >
                Source reference (maximum 1,000 characters)
              </label>
              <textarea
                className={input}
                id="resource-reference"
                required
                aria-describedby={state.error ? "resource-error" : undefined}
                maxLength={1000}
                rows={3}
                value={state.form.sourceReference}
                onChange={(e) => store.field("sourceReference", e.target.value)}
              />
            </div>
            <div>
              <label
                className="font-medium text-neutral-900"
                htmlFor="resource-text"
              >
                Resource text (maximum 20,000 characters)
              </label>
              <textarea
                className={input}
                id="resource-text"
                required
                aria-describedby={state.error ? "resource-error" : undefined}
                maxLength={20000}
                rows={10}
                value={state.form.contentText}
                onChange={(e) => store.field("contentText", e.target.value)}
              />
            </div>
          </fieldset>
          <button
            className={button}
            type="button"
            disabled={busy || !!state.uncertain}
            onClick={() => {
              if (navigation.requestLeave("discard")) store.cancel();
            }}
          >
            Discard entered edits
          </button>
        </form>
      )}
      {admin && (state.form || selected || state.uncertain) && (
        <div className="space-y-3 border-t border-neutral-200 pt-5">
          <p className="text-neutral-600">
            After an error, load the latest result and compare it with your
            entered text before saving again. An uncertain create may already
            exist; inspect the list and its pages before creating another.
          </p>
          <button
            className={button}
            disabled={busy}
            onClick={() => void store.reconcile()}
          >
            Load latest result (keep entered text)
          </button>
          {state.form &&
            state.editId &&
            selected?.id === state.editId &&
            !selected.retiredAt &&
            selected.version !== state.baseVersion && (
              <button
                className={button}
                disabled={busy || !!state.uncertain}
                onClick={store.useLatestVersion}
              >
                Use displayed version {selected.version} with my entered text
              </button>
            )}
          {state.uncertain && state.reconciled && (
            <button
              className={button}
              disabled={busy}
              onClick={store.acknowledge}
            >
              I checked the result; allow another action
            </button>
          )}
        </div>
      )}
    </section>
  );
}
