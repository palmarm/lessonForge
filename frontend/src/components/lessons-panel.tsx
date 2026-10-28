"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./auth-provider";
import {
  useWorkspaceNavigation,
  useWorkspaceProtection,
} from "./workspace-navigation";
import { LabeledTextarea } from "./ui-controls";
import { WorkflowView } from "./lesson-review-panel";
import { createReviewApi } from "@/lib/lesson-review-api";
import { createReviewState } from "@/lib/lesson-review-state";
import { createLessonsApi, type DraftContent } from "@/lib/lessons-api";
import { createResourcesApi } from "@/lib/resources-api";
import {
  createLessonsState,
  hasUnsavedLessonContent,
  initialLessonState,
} from "@/lib/lessons-state";

const button = "button";
const input = "field mt-1";

function LessonTextField({
  label,
  value,
  onChange,
  maxLength,
  id: suppliedId,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  maxLength: number;
  id?: string;
}) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return (
    <div className="min-w-0 space-y-1">
      <LabeledTextarea
        id={id}
        label={label}
        className={input}
        value={value ?? ""}
        maxLength={maxLength}
        rows={3}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-hint`} className="text-sm text-neutral-600">
        Optional while drafting; nonblank text is required for submission. Up to{" "}
        {maxLength.toLocaleString("en-US")} characters.
      </p>
    </div>
  );
}

function LessonMinutes({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  const id = useId();
  // Feedback belongs to the current native value. Activity row keys keep
  // browser/component state with that activity when earlier rows are removed.
  const [validation, setValidation] = useState<{
    value: number | undefined;
    message: string;
  } | null>(null);
  const error =
    validation && Object.is(validation.value, value)
      ? validation.message
      : null;
  const syncValidity = useCallback(
    (node: HTMLInputElement | null) => {
      if (node) {
        setValidation(
          node.validity.valid
            ? null
            : { value, message: node.validationMessage },
        );
      }
    },
    [value],
  );
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      <input
        ref={syncValidity}
        id={id}
        className={input}
        type="number"
        min={0}
        max={1440}
        step={1}
        value={value ?? ""}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        aria-invalid={error ? true : undefined}
        onInvalid={(e) =>
          setValidation({ value, message: e.currentTarget.validationMessage })
        }
        onChange={(e) => {
          const next =
            e.target.value === "" ? undefined : Number(e.target.value);
          setValidation(
            e.target.validity.valid
              ? null
              : { value: next, message: e.target.validationMessage },
          );
          onChange(next);
        }}
      />
      <p id={`${id}-hint`} className="text-sm text-neutral-600">
        Drafts allow blank or 0–1,440 whole minutes. Submission requires
        positive whole minutes; section timings must equal the total.
      </p>
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function LessonsPanel() {
  const auth = useAuth();
  if (!auth.identity || auth.identity.user.role !== "TEACHER") return null;
  const paused = auth.status !== "authenticated" || auth.pending !== null;
  return (
    <div className="w-full min-w-0">
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
          sessionEnded={auth.endSession}
          actorId={auth.identity.user.id}
        />
      </fieldset>
    </div>
  );
}
function LessonsWorkspace({
  paused,
  sessionEnded,
  actorId,
}: {
  paused: boolean;
  sessionEnded: () => void;
  actorId: string;
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
  const [reviewStore] = useState(() =>
    createReviewState(
      createReviewApi(process.env.NEXT_PUBLIC_API_BASE_URL),
      { id: actorId, role: "TEACHER" },
      sessionEnded,
      store,
    ),
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
  const busy = !!state.pending || state.workflowLocked;
  const locked = busy || !!state.uncertain || state.blocked;
  const form = state.form;
  const editing = !!form;
  const pathname = usePathname();
  const heading = useRef<HTMLHeadingElement>(null);
  const errorSummary = useRef<HTMLParagraphElement>(null);
  const previousEditing = useRef(false);
  // UI-only row identities: never serialize these into lesson content.
  const [activityKeys, setActivityKeys] = useState<string[]>([]);
  const nextActivityKey = useRef(0);
  const recovery = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    // Opening a disclosure is presentation only; reads/adoption remain explicit.
    if (state.blocked || state.uncertain || state.error) {
      if (recovery.current) recovery.current.open = true;
    }
  }, [state.blocked, state.uncertain, state.error]);
  useEffect(() => {
    if (previousEditing.current !== editing && pathname === "/drafts") {
      heading.current?.focus();
      heading.current?.scrollIntoView({ block: "start" });
    }
    previousEditing.current = editing;
  }, [editing, pathname]);
  useEffect(() => {
    if (state.error && pathname === "/drafts") errorSummary.current?.focus();
  }, [state.error, pathname]);
  const unsaved = hasUnsavedLessonContent(state);
  const navigation = useWorkspaceNavigation();
  useWorkspaceProtection(() => {
    const current = store.getSnapshot();
    return {
      dirty: hasUnsavedLessonContent(current),
      blocked: current.pending === "write" || !!current.uncertain,
      paused,
    };
  });
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
      <LessonTextField
        label={label}
        id={id}
        value={value}
        maxLength={maxLength}
        onChange={onChange}
      />
    );
  }
  function minutes(
    label: string,
    value: number | undefined,
    onChange: (v: number | undefined) => void,
  ) {
    return <LessonMinutes label={label} value={value} onChange={onChange} />;
  }
  function stringArrayField(
    label: string,
    values: string[] | undefined,
    maxLength: number,
    limit: number,
    update: (values: string[]) => void,
  ) {
    const items = values ?? [];
    const hintId = `draft-${label.toLowerCase().replaceAll(" ", "-")}-hint`;
    return (
      <fieldset className="min-w-0 space-y-3" aria-describedby={hintId}>
        <legend className="font-medium">{label}</legend>
        <p id={hintId} className="text-sm text-neutral-600">
          Optional. Up to {limit} entries, {maxLength.toLocaleString("en-US")}{" "}
          characters each. Line breaks and whitespace within each entry are
          kept.
        </p>
        <p className="text-sm text-neutral-600">
          {label === "Materials"
            ? "Submission requires this array, which may be empty. Supplied entries must be nonblank."
            : "Submission requires at least one nonblank learning objective."}
        </p>
        {items.map((value, index) => (
          <div
            key={index}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3"
          >
            <LabeledTextarea
              label={`${label}, item ${index + 1}`}
              className={input}
              value={value}
              maxLength={maxLength}
              rows={2}
              aria-describedby={hintId}
              onChange={(e) =>
                update(
                  items.map((item, i) => (i === index ? e.target.value : item)),
                )
              }
            />
            <button
              className={button}
              type="button"
              aria-label={`Remove ${label.toLowerCase()} item ${index + 1}`}
              onClick={() => update(items.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          className={button}
          type="button"
          disabled={items.length >= limit}
          onClick={() => update([...items, ""])}
        >
          Add {label.toLowerCase()} item
        </button>
        {label === "Materials" && items.length === 0 && (
          <p>
            {values === undefined
              ? "Materials not set."
              : "No additional materials are required."}
          </p>
        )}
        {label === "Materials" && (
          <button
            className={button}
            type="button"
            disabled={busy}
            onClick={() => update([])}
          >
            Use no additional materials
          </button>
        )}
      </fieldset>
    );
  }
  return (
    <>
      <section
        hidden={pathname !== "/drafts"}
        aria-labelledby={form ? "draft-editor-heading" : "drafts-heading"}
        aria-busy={busy}
        className="min-w-0 space-y-6"
      >
        {!form && (
          <h2
            ref={heading}
            tabIndex={-1}
            id="drafts-heading"
            className="section-title"
          >
            My lesson drafts
          </h2>
        )}
        {!form && (
          <p className="body-copy">
            Grade 4 Mathematics · Manual drafts may be incomplete. Saving
            creates no submitted revision. Submit a saved, reconciled draft for
            administrator review.
          </p>
        )}
        {!form && (
          <p className="feedback text-sm">
            No lesson is open. Choose <strong>New manual draft</strong> or{" "}
            <strong>Open draft</strong> below to edit your lesson introduction
            and other sections. After refreshing this page, reopen your saved
            draft from the list. Only saved content can be restored; unsaved
            text is not stored across page refreshes. Reading a curriculum
            resource does not open or create a lesson.
          </p>
        )}
        {(!form || busy || state.notice) && (
          <p role="status" className="text-sm text-neutral-700">
            {busy
              ? state.pending === "write"
                ? "Saving draft…"
                : "Loading…"
              : (state.notice ??
                "Create a draft or open one of your saved drafts.")}
          </p>
        )}
        {state.error && (
          <p ref={errorSummary} tabIndex={-1} role="alert" className="feedback">
            {state.error}
          </p>
        )}
        {(!form || state.uncertain?.type === "create") && (
          <div className="space-y-5">
            {form && (
              <h2 className="section-title">Inspect possible saved drafts</h2>
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
                onClick={() => {
                  setActivityKeys([]);
                  store.create();
                }}
              >
                New manual draft
              </button>
            </div>
            <ul aria-label="My saved drafts" className="grid gap-4">
              {state.items.map((v) => (
                <li
                  key={v.id}
                  className="workspace-panel flex flex-col items-start gap-4 xl:flex-row xl:items-center xl:justify-between"
                >
                  <div className="min-w-0">
                    <h3 className="section-title">
                      {v.title || "Untitled draft"}
                    </h3>
                    <p className="mt-2 text-sm text-neutral-600">
                      Last saved:{" "}
                      <time dateTime={v.updatedAt}>
                        {new Date(v.updatedAt).toLocaleString("en-GB")}
                      </time>{" "}
                      · Version {v.version}
                    </p>
                  </div>
                  <button
                    className={button}
                    aria-label={`${state.uncertain?.type === "create" ? "Inspect possible saved draft" : "Open draft"}: ${v.title || "Untitled draft"} · Saved version ${v.version}`}
                    disabled={
                      busy || (!!form && state.uncertain?.type !== "create")
                    }
                    onClick={() => {
                      if (state.uncertain?.type === "create") {
                        void store.inspectCreation(v.id);
                      } else {
                        setActivityKeys([]);
                        void store.view(v.id);
                      }
                    }}
                  >
                    {state.uncertain?.type === "create"
                      ? "Inspect possible saved draft"
                      : "Open draft"}
                  </button>
                  <Link className="text-link" href={`/history/${v.id}`}>
                    Revision history
                  </Link>
                </li>
              ))}
            </ul>
            {!busy &&
              !state.error &&
              state.listLoaded &&
              !state.items.length && <p>No drafts on this page.</p>}
            {!busy && !state.error && !state.listLoaded && (
              <p>Load drafts to see your saved lessons.</p>
            )}
            {state.nextAfter && (
              <button
                className={button}
                disabled={busy}
                onClick={() => void store.list(state.nextAfter!)}
              >
                Next drafts page
              </button>
            )}
          </div>
        )}
        {form && (
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                ref={heading}
                tabIndex={-1}
                id="draft-editor-heading"
                className="section-title"
              >
                {state.editId
                  ? `Edit draft · based on version ${state.baseVersion}`
                  : "New draft"}
              </h2>
              <button
                className="text-link"
                disabled={busy || !!state.uncertain}
                onClick={() => {
                  if (navigation.requestLeave("discard")) void store.close();
                }}
              >
                Close editor and discard unsaved text
              </button>
            </div>
            <div
              role="region"
              aria-label="Draft save controls"
              className="sticky top-0 z-20 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border border-neutral-400 bg-white p-3 shadow-sm sm:p-4"
            >
              <div className="min-w-0">
                <p
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  className="font-semibold"
                >
                  {state.pending === "write"
                    ? "Saving changes."
                    : paused
                      ? "Session unconfirmed. Draft controls paused."
                      : state.uncertain
                        ? "Write outcome uncertain. Check the saved result."
                        : state.blocked
                          ? "Conflict. Compare before saving again."
                          : state.error
                            ? "Request failed. Your text is retained."
                            : state.workflowLocked
                              ? "Submission workflow holds draft controls. Complete or cancel its confirmation below."
                              : unsaved
                                ? "Unsaved changes."
                                : state.editId
                                  ? `Saved version ${state.baseVersion}.`
                                  : "Not saved yet."}
                </p>
                <p className="text-xs text-neutral-600">
                  {state.saved ? (
                    <>
                      Last saved:{" "}
                      <time dateTime={state.saved.updatedAt}>
                        {new Date(state.saved.updatedAt).toLocaleString(
                          "en-GB",
                        )}
                      </time>
                    </>
                  ) : (
                    "Not yet saved"
                  )}
                </p>
              </div>
              <button
                className={button}
                type="submit"
                form="lesson-content-form"
                aria-label="Save draft content"
                disabled={locked}
              >
                Save draft
              </button>
              <button
                className={button}
                type="button"
                disabled={locked || unsaved || !state.saved}
                onClick={() => void reviewStore.prepareSubmission()}
              >
                Prepare submission
              </button>
              {state.editId && (
                <Link className="text-link" href={`/history/${state.editId}`}>
                  View revision history
                </Link>
              )}
            </div>
            <details className="text-sm">
              <summary className="text-link cursor-pointer font-medium">
                Draft help and limits
              </summary>
              <div className="space-y-3 py-3">
                <p>
                  All fields are optional. Saving creates no submitted revision.
                  Resource selection saves separately; unsaved text is not
                  stored across page refreshes.
                </p>
                {state.editId && (
                  <p className="break-words">Draft ID: {state.editId}</p>
                )}
                <p>
                  Maximum 64 KiB of content. Title: 200 characters. Sections and
                  activity tasks: 4,000 each. Up to 30 objectives (1,000 each),
                  materials (500 each), and activities. Draft timings: 0–1,440
                  whole minutes; blanks are allowed.
                </p>
                <div className="flex flex-wrap gap-3">
                  <a className="text-link" href="#lesson-introduction">
                    Edit introduction
                  </a>
                  <a className="text-link" href="#draft-sources-heading">
                    Select or manage resource snapshots
                  </a>
                </div>
              </div>
            </details>
            <details
              ref={recovery}
              className="min-w-0 rounded-md border border-neutral-300 px-3"
            >
              <summary className="text-link cursor-pointer">
                <h3 id="draft-recovery-heading" className="inline font-medium">
                  Compare saved content and recover
                </h3>
              </summary>
              <section
                aria-labelledby="draft-recovery-heading"
                className="space-y-3 pb-4"
              >
                {state.uncertain && (
                  <p>
                    A write is unconfirmed. Use Load latest result below;
                    entered content is retained.
                  </p>
                )}
                {state.blocked && (
                  <p>
                    Saving is paused after a conflict. Load the latest result,
                    compare it, then explicitly choose its version before saving
                    again.
                  </p>
                )}
                <p>
                  After a conflict or uncertain write, load the saved result and
                  compare it with your entered text. This never changes your
                  text or base version. An uncertain creation may already exist:
                  inspect all relevant draft pages before creating again.
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
                    <h4 className="font-semibold">
                      Latest saved result · Version {state.latest.version}
                    </h4>
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
                      Use displayed draft, version, and selections with my
                      entered text
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
                        Inspect possible saved drafts and check every relevant
                        list page before creating again. If none matches, you
                        can explicitly allow a new create; it may duplicate a
                        creation whose result was lost.
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
              </section>
            </details>
            <div
              className="grid min-w-0 items-start gap-8 xl:grid-cols-[minmax(0,1fr)_300px]"
              data-draft-columns
            >
              <form
                id="lesson-content-form"
                className="min-w-0"
                onSubmit={(e) => {
                  e.preventDefault();
                  void store.save();
                }}
              >
                <fieldset disabled={busy} className="min-w-0 space-y-8">
                  <legend className="section-title mb-2">
                    Lesson content · Editable
                  </legend>
                  <p className="text-sm text-neutral-600">
                    All fields are optional while drafting. Incomplete drafts
                    can be saved; text and whitespace are kept as entered.
                  </p>
                  {textField(
                    "Title",
                    form.title,
                    (v) => change({ title: v }),
                    200,
                  )}
                  <div className="grid min-w-0 gap-5 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="lesson-subject"
                        className="block font-medium"
                      >
                        Subject
                      </label>
                      <select
                        id="lesson-subject"
                        className={input}
                        aria-describedby="lesson-context-hint"
                        value={form.subject ?? ""}
                        onChange={(e) =>
                          change({
                            subject:
                              e.target.value === "" ? undefined : "Mathematics",
                          })
                        }
                      >
                        <option value="">Not set</option>
                        <option value="Mathematics">Mathematics</option>
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="lesson-grade"
                        className="block font-medium"
                      >
                        Grade
                      </label>
                      <select
                        id="lesson-grade"
                        className={input}
                        aria-describedby="lesson-context-hint"
                        value={form.grade ?? ""}
                        onChange={(e) =>
                          change({
                            grade:
                              e.target.value === "" ? undefined : "Grade 4",
                          })
                        }
                      >
                        <option value="">Not set</option>
                        <option value="Grade 4">Grade 4</option>
                      </select>
                    </div>
                  </div>
                  <p
                    id="lesson-context-hint"
                    className="text-sm text-neutral-600"
                  >
                    Optional while drafting; Mathematics and Grade 4 are
                    required for submission. Not set omits that field from the
                    save.
                  </p>
                  {minutes(
                    "Total duration (minutes)",
                    form.durationMinutes,
                    (v) => change({ durationMinutes: v }),
                  )}
                  {stringArrayField(
                    "Learning objectives",
                    form.learningObjectives,
                    1000,
                    30,
                    (learningObjectives) => change({ learningObjectives }),
                  )}
                  {stringArrayField(
                    "Materials",
                    form.materials,
                    500,
                    30,
                    (materials) => change({ materials }),
                  )}
                  <section
                    className="space-y-4 border-t border-neutral-200 pt-6"
                    aria-labelledby="lesson-introduction-heading"
                  >
                    <h3
                      id="lesson-introduction-heading"
                      className="section-title"
                    >
                      Introduction
                    </h3>
                    {textField(
                      "Lesson introduction (editable)",
                      form.introduction?.text,
                      (v) =>
                        change({
                          introduction: { ...form.introduction, text: v },
                        }),
                      4000,
                      "lesson-introduction",
                    )}
                    {minutes(
                      "Introduction duration (minutes)",
                      form.introduction?.durationMinutes,
                      (v) =>
                        change({
                          introduction: {
                            ...form.introduction,
                            durationMinutes: v,
                          },
                        }),
                    )}
                  </section>
                  <section
                    className="space-y-5 border-t border-neutral-200 pt-6"
                    aria-labelledby="lesson-activities-heading"
                  >
                    <h3
                      id="lesson-activities-heading"
                      className="section-title"
                    >
                      Activities
                    </h3>
                    {(form.activities ?? []).map((activity, index) => {
                      const update = (patch: Partial<typeof activity>) =>
                        change({
                          activities: form.activities!.map((a, i) =>
                            i === index ? { ...a, ...patch } : a,
                          ),
                        });
                      return (
                        <fieldset
                          key={activityKeys[index] ?? `initial-${index}`}
                          className="space-y-3 rounded-lg border p-3"
                        >
                          <legend>Activity {index + 1}</legend>
                          {textField(
                            "Teacher tasks",
                            activity.teacherTasks,
                            (v) => update({ teacherTasks: v }),
                          )}
                          {textField(
                            "Learner tasks",
                            activity.learnerTasks,
                            (v) => update({ learnerTasks: v }),
                          )}
                          {minutes(
                            "Activity duration (minutes)",
                            activity.durationMinutes,
                            (v) => update({ durationMinutes: v }),
                          )}
                          <button
                            className={button}
                            type="button"
                            onClick={() => {
                              setActivityKeys(
                                form
                                  .activities!.map(
                                    (_, i) => activityKeys[i] ?? `initial-${i}`,
                                  )
                                  .filter((_, i) => i !== index),
                              );
                              change({
                                activities: form.activities!.filter(
                                  (_, i) => i !== index,
                                ),
                              });
                            }}
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
                      onClick={() => {
                        setActivityKeys([
                          ...(form.activities ?? []).map(
                            (_, i) => activityKeys[i] ?? `initial-${i}`,
                          ),
                          `added-${nextActivityKey.current++}`,
                        ]);
                        change({
                          activities: [...(form.activities ?? []), {}],
                        });
                      }}
                    >
                      Add activity
                    </button>
                  </section>
                  <section
                    className="space-y-4 border-t border-neutral-200 pt-6"
                    aria-labelledby="lesson-assessment-heading"
                  >
                    <h3
                      id="lesson-assessment-heading"
                      className="section-title"
                    >
                      Assessment
                    </h3>
                    {textField("Assessment", form.assessment?.text, (v) =>
                      change({ assessment: { ...form.assessment, text: v } }),
                    )}
                    {minutes(
                      "Assessment duration (minutes)",
                      form.assessment?.durationMinutes,
                      (v) =>
                        change({
                          assessment: {
                            ...form.assessment,
                            durationMinutes: v,
                          },
                        }),
                    )}
                  </section>
                  <section
                    className="space-y-4 border-t border-neutral-200 pt-6"
                    aria-labelledby="lesson-differentiation-heading"
                  >
                    <h3
                      id="lesson-differentiation-heading"
                      className="section-title"
                    >
                      Differentiation
                    </h3>
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
                  </section>
                </fieldset>
              </form>
              <section
                aria-labelledby="draft-sources-heading"
                className="min-w-0 space-y-4 rounded-lg border border-neutral-300 bg-neutral-50 p-4 sm:p-6"
              >
                <h3
                  id="draft-sources-heading"
                  className="section-title scroll-mt-40"
                >
                  Selected resource snapshots (saved separately)
                </h3>
                <p>
                  At least one source is required for submission; up to five
                  resources are allowed. Selections save separately and retain
                  your entered lesson text. Ordinary content saves preserve
                  these snapshots, including after resource edits or retirement.
                  Refresh explicitly replaces one snapshot with its latest
                  active version.
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
                    className="min-w-0 space-y-3 rounded-md border border-neutral-300 bg-white p-4"
                  >
                    <h4 className="font-semibold break-words">
                      {s.snapshot.title} · Selected version {s.resourceVersion}
                    </h4>
                    <p className="text-sm">
                      Read-only retained source snapshot. Write your own lesson
                      content in the editable lesson fields.
                    </p>
                    <p className="text-sm text-neutral-600">
                      {s.snapshot.subject} · {s.snapshot.grade}
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
                        onClick={() =>
                          void store.source(s.resourceId, "remove")
                        }
                      >
                        Remove selection
                      </button>
                      <button
                        className={button}
                        disabled={locked}
                        onClick={() =>
                          void store.source(s.resourceId, "refresh")
                        }
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
                      resource to attach a trusted snapshot to this draft.
                      Resource text is separate from your editable lesson.
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
                        onClick={() =>
                          void store.resources(state.resourceNext!)
                        }
                      >
                        Next resources page
                      </button>
                    )}
                    {state.resourceDetail && (
                      <article className="min-w-0 space-y-3 rounded-md border border-neutral-300 bg-white p-4">
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
                            void store.source(
                              state.resourceDetail!.id,
                              "select",
                            )
                          }
                        >
                          Select latest active resource
                        </button>
                      </article>
                    )}
                  </>
                )}
              </section>
            </div>
          </div>
        )}
      </section>
      <WorkflowView
        store={reviewStore}
        paused={paused}
        admin={false}
        historyView={
          pathname === "/history" || pathname.startsWith("/history/")
        }
      />
    </>
  );
}
