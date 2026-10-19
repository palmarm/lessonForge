"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "./auth-provider";
import { createResourcesApi } from "@/lib/resources-api";
import {
  createResourcesState,
  initialResourceState,
} from "@/lib/resources-state";

const button =
  "rounded-lg border border-slate-500 bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-700 disabled:opacity-50 disabled:cursor-not-allowed";
const input =
  "mt-2 w-full rounded-lg border border-slate-400 bg-white p-3 text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700";

export function ResourcesPanel() {
  const auth = useAuth();
  if (!auth.identity) return null;
  const user = auth.identity.user;
  const paused = auth.status !== "authenticated" || auth.pending !== null;
  return (
    <div className="w-full max-w-5xl">
      {paused && (
        <p role="status" className="mb-3 text-slate-700">
          Resource controls are paused while your session is unconfirmed.
          Entered text is retained; use Check session again above if needed.
        </p>
      )}
      <fieldset disabled={paused} className="min-w-0" aria-busy={paused}>
        <legend className="sr-only">Authenticated resource workspace</legend>
        <ResourcesWorkspace
          key={`${user.id}:${user.role}:${auth.identity.expiresAt}`}
          role={user.role}
          sessionEnded={() => void auth.restore()}
        />
      </fieldset>
    </div>
  );
}
function ResourcesWorkspace({
  role,
  sessionEnded,
}: {
  role: "ADMIN" | "TEACHER";
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
  useEffect(() => {
    store.activate();
    void store.list();
    return store.dispose;
  }, [store]);
  const busy = !!state.pending;
  const selected = state.selected;
  const admin = role === "ADMIN";
  return (
    <section
      aria-labelledby="resources-heading"
      aria-busy={busy}
      className="w-full max-w-5xl space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <h2
        id="resources-heading"
        className="text-2xl font-semibold text-slate-900"
      >
        Curriculum resources
      </h2>
      <p className="text-slate-600">
        Grade 4 Mathematics · Demonstration material without claims of official
        curriculum alignment.
      </p>
      <p role="status" className="text-slate-700">
        {state.pending === "write"
          ? "Saving resource…"
          : state.pending === "read"
            ? "Loading resources…"
            : (state.notice ??
              "Browse resources to read their source material.")}
      </p>
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {state.error}
        </p>
      )}
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
      <ul className="space-y-2" aria-label="Resource list">
        {state.items.map((v) => (
          <li key={v.id}>
            <button
              className={`${button} w-full text-left break-words`}
              disabled={
                busy ||
                ((!!state.form || state.uncertain) &&
                  !(state.uncertain?.type === "create" && state.form)) ||
                confirmRetire
              }
              onClick={() => void store.view(v.id)}
            >
              {v.title}{" "}
              <span className="text-sm text-slate-600">
                {v.retiredAt ? "Retired" : "Active"} · Version {v.version}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!state.items.length && !busy && (
        <p className="text-slate-600">No resources on this page.</p>
      )}
      {state.nextAfter && (
        <button
          className={button}
          disabled={busy}
          onClick={() => void store.list(state.nextAfter!)}
        >
          Next page
        </button>
      )}
      {selected && (
        <article
          aria-labelledby="resource-title"
          className="space-y-3 border-t border-slate-200 pt-5 text-slate-900"
        >
          <h3 id="resource-title" className="break-words text-xl font-semibold">
            {selected.title}
          </h3>
          <p>
            {selected.subject} · {selected.grade} ·{" "}
            {selected.retiredAt ? "Retired" : "Active"} · Version{" "}
            {selected.version}
          </p>
          <p className="text-sm text-slate-600">Resource ID: {selected.id}</p>
          <h4 className="font-semibold">Source reference</h4>
          <p className="whitespace-pre-wrap break-words">
            {selected.sourceReference}
          </p>
          <h4 className="font-semibold">Resource text</h4>
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
              <h4 id="retire-confirm-heading" className="font-semibold">
                Retire “{selected.title}”?
              </h4>
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
          className="space-y-5 border-t border-slate-200 pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void store.save();
          }}
        >
          <h3 className="text-xl font-semibold text-slate-900">
            {state.editId
              ? `Edit resource (based on version ${state.baseVersion})`
              : "Create resource"}
          </h3>
          <p className="text-slate-600">
            All fields are required. Mathematics and Grade 4 are fixed. Source
            reference is citation text; URLs are not fetched.
          </p>
          <fieldset
            disabled={busy || !!state.uncertain}
            className="space-y-4 disabled:opacity-60"
          >
            <legend className="sr-only">Resource content</legend>
            <div>
              <label
                className="font-medium text-slate-900"
                htmlFor="resource-title-input"
              >
                Title (maximum 200 characters)
              </label>
              <input
                className={input}
                id="resource-title-input"
                required
                maxLength={200}
                value={state.form.title}
                onChange={(e) => store.field("title", e.target.value)}
              />
            </div>
            <div>
              <label
                className="font-medium text-slate-900"
                htmlFor="resource-reference"
              >
                Source reference (maximum 1,000 characters)
              </label>
              <textarea
                className={input}
                id="resource-reference"
                required
                maxLength={1000}
                rows={3}
                value={state.form.sourceReference}
                onChange={(e) => store.field("sourceReference", e.target.value)}
              />
            </div>
            <div>
              <label
                className="font-medium text-slate-900"
                htmlFor="resource-text"
              >
                Resource text (maximum 20,000 characters)
              </label>
              <textarea
                className={input}
                id="resource-text"
                required
                maxLength={20000}
                rows={10}
                value={state.form.contentText}
                onChange={(e) => store.field("contentText", e.target.value)}
              />
            </div>
            <button className={button} type="submit">
              Save resource
            </button>
          </fieldset>
          <button
            className={button}
            type="button"
            disabled={busy || !!state.uncertain}
            onClick={store.cancel}
          >
            Discard entered edits
          </button>
        </form>
      )}
      {admin && (state.form || selected || state.uncertain) && (
        <div className="space-y-3 border-t border-slate-200 pt-5">
          <p className="text-slate-600">
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
