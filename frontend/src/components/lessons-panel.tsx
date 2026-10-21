"use client";
import {
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useAuth } from "./auth-provider";
import { createLessonsApi, type DraftContent } from "@/lib/lessons-api";
import { createResourcesApi } from "@/lib/resources-api";
import {
  createLessonsState,
  hasUnsavedLessonContent,
  initialLessonState,
} from "@/lib/lessons-state";

const button =
  "rounded-lg border border-slate-500 bg-white px-4 py-2 text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-50";
const input =
  "mt-1 w-full rounded-lg border border-slate-400 bg-white p-2 text-slate-900";
export function LessonsPanel() {
  const auth = useAuth();
  if (!auth.identity || auth.identity.user.role !== "TEACHER") return null;
  const paused = auth.status !== "authenticated" || auth.pending !== null;
  return (
    <div className="w-full max-w-5xl">
      {paused && (
        <p role="status">
          Draft controls are paused while your session is unconfirmed. Entered
          text is retained.
        </p>
      )}
      <fieldset disabled={paused} className="min-w-0" aria-busy={paused}>
        <legend className="sr-only">Teacher draft workspace</legend>
        <LessonsWorkspace
          key={`${auth.identity.user.id}:${auth.identity.user.role}:${auth.identity.expiresAt}`}
          paused={paused}
          sessionEnded={() => void auth.restore()}
        />
      </fieldset>
    </div>
  );
}
function LessonsWorkspace({
  paused,
  sessionEnded,
}: {
  paused: boolean;
  sessionEnded: () => void;
}) {
  const [store] = useState(() =>
    createLessonsState(
      createLessonsApi(process.env.NEXT_PUBLIC_API_BASE_URL),
      sessionEnded,
      createResourcesApi(process.env.NEXT_PUBLIC_API_BASE_URL),
    ),
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => initialLessonState,
  );
  useLayoutEffect(() => {
    store.activate();
    return store.dispose;
  }, [store]);
  useLayoutEffect(() => {
    store.pause(paused);
  }, [store, paused]);
  useEffect(() => {
    void store.list();
  }, [store]);
  const busy = !!state.pending;
  const locked = busy || !!state.uncertain || state.blocked;
  const form = state.form;
  const unsaved = hasUnsavedLessonContent(state);
  useEffect(() => {
    if (!unsaved && !state.uncertain && state.pending !== "write") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved, state.uncertain, state.pending]);
  const change = (patch: Partial<DraftContent>) => {
    if (form) store.field({ ...form, ...patch });
  };
  function textField(
    label: string,
    value: string | undefined,
    onChange: (v: string) => void,
    maxLength = 4000,
    id?: string,
  ) {
    return (
      <label className="block space-y-1 font-medium">
        {label}
        <textarea
          id={id}
          className={input}
          value={value ?? ""}
          maxLength={maxLength}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    );
  }
  function minutes(
    label: string,
    value: number | undefined,
    onChange: (v: number | undefined) => void,
  ) {
    return (
      <label className="block font-medium">
        {label}
        <input
          className={input}
          type="number"
          min={0}
          max={1440}
          step={1}
          value={value ?? ""}
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      </label>
    );
  }
  return (
    <section
      aria-labelledby="drafts-heading"
      aria-busy={busy}
      className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm"
    >
      <h2 id="drafts-heading" className="text-2xl font-semibold">
        My lesson drafts
      </h2>
      <p>
        Grade 4 Mathematics · Manual drafts may be incomplete. Saving creates no
        submitted revision. Submission and submission validation are not
        available yet.
      </p>
      {!form && (
        <p className="rounded-lg bg-slate-50 p-3">
          No lesson is open. Choose <strong>New manual draft</strong> or{" "}
          <strong>Open draft</strong> below to edit your lesson introduction and
          other sections. After refreshing this page, reopen your saved draft
          from the list. Only saved content can be restored; unsaved text is not
          stored across page refreshes. Reading a curriculum resource does not
          open or create a lesson.
        </p>
      )}
      <p role="status">
        {busy
          ? state.pending === "write"
            ? "Saving draft…"
            : "Loading…"
          : (state.notice ??
            "Create a draft or open one of your saved drafts.")}
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
          Reload drafts
        </button>
        <button
          className={button}
          disabled={busy || !!form || !!state.uncertain}
          onClick={store.create}
        >
          New manual draft
        </button>
      </div>
      <ul aria-label="My saved drafts" className="space-y-2">
        {state.items.map((v) => (
          <li key={v.id}>
            <button
              className={button}
              disabled={busy || (!!form && state.uncertain?.type !== "create")}
              onClick={() =>
                void (state.uncertain?.type === "create"
                  ? store.inspectCreation(v.id)
                  : store.view(v.id))
              }
            >
              {state.uncertain?.type === "create"
                ? "Inspect possible saved draft: "
                : "Open draft: "}
              {v.title || "Untitled draft"} · Saved version {v.version}
            </button>
          </li>
        ))}
      </ul>
      {!state.items.length && <p>No drafts on this page.</p>}
      {state.nextAfter && (
        <button
          className={button}
          disabled={busy}
          onClick={() => void store.list(state.nextAfter!)}
        >
          Next drafts page
        </button>
      )}
      {form && (
        <>
          <form
            className="space-y-4 border-t pt-5"
            onSubmit={(e) => {
              e.preventDefault();
              void store.save();
            }}
          >
            <h3 className="text-xl font-semibold">
              {state.editId
                ? `Edit draft · based on version ${state.baseVersion}`
                : "New draft"}
            </h3>
            <p role="status">
              {state.editId
                ? unsaved
                  ? `Unsaved lesson content. Last confirmed saved version: ${state.baseVersion}. Save draft content to keep these edits.`
                  : `Lesson content matches confirmed saved version ${state.baseVersion}.`
                : "New lesson — not saved yet. Write your content, then choose Save draft content."}{" "}
              Resource selection saves separately. Refreshing the page requires
              reopening the saved draft.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button className={button} type="submit" disabled={locked}>
                Save draft content
              </button>
              <a className="underline" href="#lesson-introduction">
                Edit introduction
              </a>
              <a className="underline" href="#draft-sources-heading">
                Select or manage resource snapshots
              </a>
            </div>
            {state.uncertain && (
              <p>
                A write is unconfirmed. Use Load latest result below; entered
                content is retained.
              </p>
            )}
            {state.blocked && (
              <p>
                Saving is paused after a conflict. Load the latest result,
                compare it, then explicitly choose its version before saving
                again.
              </p>
            )}
            {state.editId && (
              <p className="break-words text-sm">Draft ID: {state.editId}</p>
            )}
            <p>
              Maximum 64 KiB of content. Title: 200 characters. Sections and
              activity tasks: 4,000 each. Up to 30 objectives (1,000 each),
              materials (500 each), and activities. Draft timings: 0–1,440 whole
              minutes; blanks are allowed.
            </p>
            <fieldset disabled={busy} className="space-y-4">
              <legend className="sr-only">Editable lesson content</legend>
              {textField("Title", form.title, (v) => change({ title: v }), 200)}
              {minutes("Total duration (minutes)", form.durationMinutes, (v) =>
                change({ durationMinutes: v }),
              )}
              {textField(
                "Learning objectives (one per line)",
                form.learningObjectives?.join("\n"),
                (v) =>
                  change({ learningObjectives: v === "" ? [] : v.split("\n") }),
                30029,
              )}
              {textField(
                "Materials (one per line; empty means no additional materials)",
                form.materials?.join("\n"),
                (v) => change({ materials: v === "" ? [] : v.split("\n") }),
                15029,
              )}
              {textField(
                "Lesson introduction (editable)",
                form.introduction?.text,
                (v) =>
                  change({ introduction: { ...form.introduction, text: v } }),
                4000,
                "lesson-introduction",
              )}
              {minutes(
                "Introduction duration (minutes)",
                form.introduction?.durationMinutes,
                (v) =>
                  change({
                    introduction: { ...form.introduction, durationMinutes: v },
                  }),
              )}
              <fieldset className="space-y-4">
                <legend className="font-semibold">Activities</legend>
                {(form.activities ?? []).map((activity, index) => {
                  const update = (patch: Partial<typeof activity>) =>
                    change({
                      activities: form.activities!.map((a, i) =>
                        i === index ? { ...a, ...patch } : a,
                      ),
                    });
                  return (
                    <fieldset
                      key={index}
                      className="space-y-3 rounded-lg border p-3"
                    >
                      <legend>Activity {index + 1}</legend>
                      {textField("Teacher tasks", activity.teacherTasks, (v) =>
                        update({ teacherTasks: v }),
                      )}
                      {textField("Learner tasks", activity.learnerTasks, (v) =>
                        update({ learnerTasks: v }),
                      )}
                      {minutes(
                        "Activity duration (minutes)",
                        activity.durationMinutes,
                        (v) => update({ durationMinutes: v }),
                      )}
                      <button
                        className={button}
                        type="button"
                        onClick={() =>
                          change({
                            activities: form.activities!.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                      >
                        Remove activity {index + 1}
                      </button>
                    </fieldset>
                  );
                })}
                <button
                  className={button}
                  type="button"
                  disabled={(form.activities?.length ?? 0) >= 30}
                  onClick={() =>
                    change({ activities: [...(form.activities ?? []), {}] })
                  }
                >
                  Add activity
                </button>
              </fieldset>
              {textField("Assessment", form.assessment?.text, (v) =>
                change({ assessment: { ...form.assessment, text: v } }),
              )}
              {minutes(
                "Assessment duration (minutes)",
                form.assessment?.durationMinutes,
                (v) =>
                  change({
                    assessment: { ...form.assessment, durationMinutes: v },
                  }),
              )}
              {textField(
                "Differentiation: learner support",
                form.differentiation?.learnerSupport,
                (v) =>
                  change({
                    differentiation: {
                      ...form.differentiation,
                      learnerSupport: v,
                    },
                  }),
              )}
              {textField(
                "Differentiation: extension activities",
                form.differentiation?.extensionActivities,
                (v) =>
                  change({
                    differentiation: {
                      ...form.differentiation,
                      extensionActivities: v,
                    },
                  }),
              )}
            </fieldset>
          </form>
          <button
            className={button}
            disabled={busy || !!state.uncertain}
            onClick={store.close}
          >
            Close editor and discard unsaved text
          </button>
          <section
            aria-labelledby="draft-sources-heading"
            className="space-y-3 border-t pt-5"
          >
            <h3 id="draft-sources-heading" className="text-xl font-semibold">
              Selected resource snapshots (saved separately)
            </h3>
            <p>
              Up to five resources. Selections save separately and retain your
              entered lesson text. Ordinary content saves preserve these
              snapshots, including after resource edits or retirement. Refresh
              explicitly replaces one snapshot with its latest active version.
            </p>
            {!state.saved?.sources.length && (
              <p>
                No resources selected. Save the draft, browse the available
                active resources below, then select one. Remove and refresh
                controls appear for each selected snapshot.
              </p>
            )}
            {state.saved?.sources.map((s) => (
              <article
                key={s.resourceId}
                className="space-y-2 rounded-lg border p-3"
              >
                <h4 className="font-semibold break-words">
                  {s.snapshot.title} · Selected version {s.resourceVersion}
                </h4>
                <p className="text-sm">
                  Read-only retained source snapshot. Write your own lesson
                  content in the editor above.
                </p>
                <p className="whitespace-pre-wrap break-words">
                  {s.snapshot.sourceReference}
                </p>
                <details>
                  <summary>Read retained resource text</summary>
                  <p className="whitespace-pre-wrap break-words">
                    {s.snapshot.contentText}
                  </p>
                </details>
                <div className="flex flex-wrap gap-3">
                  <button
                    className={button}
                    disabled={locked}
                    onClick={() => void store.source(s.resourceId, "remove")}
                  >
                    Remove selection
                  </button>
                  <button
                    className={button}
                    disabled={locked}
                    onClick={() => void store.source(s.resourceId, "refresh")}
                  >
                    Refresh from latest active resource
                  </button>
                </div>
              </article>
            ))}
            {!state.editId ? (
              <p>Save the draft first to select resources.</p>
            ) : (
              <>
                <h4 className="font-semibold">
                  Available active resources (read-only)
                </h4>
                <p>
                  Read the source material, then choose Select latest active
                  resource to attach a trusted snapshot to this draft. Resource
                  text is separate from your editable lesson.
                </p>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void store.resources()}
                >
                  Browse active resources
                </button>
                <ul aria-label="Active resources for selection">
                  {state.resourceItems.map((r) => (
                    <li key={r.id}>
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() => void store.resource(r.id)}
                      >
                        {r.title} · Version {r.version}
                      </button>
                    </li>
                  ))}
                </ul>
                {state.resourceNext && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => void store.resources(state.resourceNext!)}
                  >
                    Next resources page
                  </button>
                )}
                {state.resourceDetail && (
                  <article className="space-y-2 border p-3">
                    <h4 className="font-semibold break-words">
                      {state.resourceDetail.title}
                    </h4>
                    <p className="whitespace-pre-wrap break-words">
                      {state.resourceDetail.sourceReference}
                    </p>
                    <p className="whitespace-pre-wrap break-words">
                      {state.resourceDetail.contentText}
                    </p>
                    <button
                      className={button}
                      disabled={
                        locked ||
                        (state.saved?.sources.length ?? 0) >= 5 ||
                        state.saved?.sources.some(
                          (s) => s.resourceId === state.resourceDetail!.id,
                        )
                      }
                      onClick={() =>
                        void store.source(state.resourceDetail!.id, "select")
                      }
                    >
                      Select latest active resource
                    </button>
                  </article>
                )}
              </>
            )}
          </section>
          <div className="space-y-3 border-t pt-5">
            <p>
              After a conflict or uncertain write, load the saved result and
              compare it with your entered text. This never changes your text or
              base version. An uncertain creation may already exist: inspect all
              relevant draft pages before creating again.
            </p>
            <button
              className={button}
              disabled={busy}
              onClick={() => void store.reconcile()}
            >
              Load latest result (keep entered text and version)
            </button>
            {state.latest && (
              <article className="space-y-2">
                <h3 className="font-semibold">
                  Latest saved result · Version {state.latest.version}
                </h3>
                <p className="break-words">ID: {state.latest.id}</p>
                <pre className="whitespace-pre-wrap break-words text-sm">
                  {JSON.stringify(state.latest.content, null, 2)}
                </pre>
                <p>
                  Selections:{" "}
                  {state.latest.sources
                    .map(
                      (s) =>
                        `${s.snapshot.title} (version ${s.resourceVersion})`,
                    )
                    .join(", ") || "None"}
                </p>
                <details>
                  <summary>Compare full saved source snapshots</summary>
                  <pre className="whitespace-pre-wrap break-words text-sm">
                    {JSON.stringify(state.latest.sources, null, 2)}
                  </pre>
                </details>
                <button
                  className={button}
                  disabled={busy || !!state.uncertain}
                  onClick={store.adoptLatest}
                >
                  Use displayed draft, version, and selections with my entered
                  text
                </button>
              </article>
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
            {state.uncertain?.type === "create" &&
              state.creationListChecked && (
                <div className="space-y-2">
                  <p>
                    Inspect possible saved drafts and check every relevant list
                    page before creating again. If none matches, you can
                    explicitly allow a new create; it may duplicate a creation
                    whose result was lost.
                  </p>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={store.confirmCreationNotFound}
                  >
                    I found no matching draft; allow a new create
                  </button>
                </div>
              )}
          </div>
        </>
      )}
    </section>
  );
}
