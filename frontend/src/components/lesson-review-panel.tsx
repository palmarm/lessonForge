"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAuth } from "./auth-provider";
import { useWorkspaceProtection } from "./workspace-navigation";
import { Button, Input, LabeledTextarea } from "./ui-controls";
import { createReviewApi, lessonUuid } from "@/lib/lesson-review-api";
import type { Decision, RevisionDetail } from "@/lib/lesson-review-api";
import {
  createReviewState,
  initialReviewState,
} from "@/lib/lesson-review-state";
import type { ReviewStore } from "@/lib/lesson-review-state";

function RevisionContent({ detail }: { detail: RevisionDetail }) {
  const { revision, workflow } = detail,
    content = revision.content;
  const section = (
    title: string,
    text: string | undefined,
    minutes?: number,
  ) => (
    <section className="space-y-2">
      <h3 className="section-title">
        {title}
        {minutes !== undefined ? ` · ${minutes} minutes` : ""}
      </h3>
      <p className="whitespace-pre-wrap break-words">{text}</p>
    </section>
  );
  return (
    <article
      className="workspace-panel min-w-0 space-y-6"
      aria-label={`Immutable revision ${revision.number}`}
    >
      <h2 className="section-title">
        Revision {revision.number}: {content.title}
      </h2>
      <p className="feedback">
        Immutable submitted content. This is separate from any later editable
        draft or current resource text.
      </p>
      <dl className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold">Lesson ID</dt>
          <dd>{workflow.lessonId}</dd>
        </div>
        <div>
          <dt className="font-semibold">Viewed revision ID</dt>
          <dd>{revision.id}</dd>
        </div>
        <div>
          <dt className="font-semibold">Current revision ID</dt>
          <dd>{workflow.currentRevisionId}</dd>
        </div>
        <div>
          <dt className="font-semibold">Current lesson state / version</dt>
          <dd>
            {workflow.state} · Version {workflow.version}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Submitted</dt>
          <dd>
            <time dateTime={revision.submittedAt}>{revision.submittedAt}</time>
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Origin</dt>
          <dd>{revision.generationOrigin}</dd>
        </div>
      </dl>
      <p>
        {content.subject} · {content.grade} · {content.durationMinutes} total
        minutes
      </p>
      <section>
        <h3 className="section-title">Learning objectives</h3>
        <ul className="list-disc space-y-2 pl-5">
          {content.learningObjectives?.map((text, i) => (
            <li className="whitespace-pre-wrap" key={i}>
              {text}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="section-title">Materials</h3>
        {content.materials?.length ? (
          <ul className="list-disc pl-5">
            {content.materials.map((text, i) => (
              <li className="whitespace-pre-wrap" key={i}>
                {text}
              </li>
            ))}
          </ul>
        ) : (
          <p>No additional materials required.</p>
        )}
      </section>
      {section(
        "Introduction",
        content.introduction?.text,
        content.introduction?.durationMinutes,
      )}
      <section className="space-y-4">
        <h3 className="section-title">Activities</h3>
        {content.activities?.map((activity, i) => (
          <section
            key={i}
            className="space-y-2 border-l-2 border-neutral-300 pl-4"
          >
            <h4 className="font-semibold">
              Activity {i + 1} · {activity.durationMinutes} minutes
            </h4>
            <p className="whitespace-pre-wrap">
              Teacher tasks: {activity.teacherTasks}
            </p>
            <p className="whitespace-pre-wrap">
              Learner tasks: {activity.learnerTasks}
            </p>
          </section>
        ))}
      </section>
      {section(
        "Assessment",
        content.assessment?.text,
        content.assessment?.durationMinutes,
      )}
      {section("Learner support", content.differentiation?.learnerSupport)}
      {section(
        "Extension activities",
        content.differentiation?.extensionActivities,
      )}
      <section className="space-y-4">
        <h3 className="section-title">Historical source snapshots</h3>
        <p>
          Retained at selection time. These may differ from updated or retired
          resources.
        </p>
        {revision.sources.map((source) => (
          <section
            key={source.resourceId}
            className="min-w-0 space-y-2 rounded-md border border-neutral-300 bg-neutral-50 p-4"
          >
            <h4 className="font-semibold">
              {source.snapshot.title} · Selected version{" "}
              {source.resourceVersion}
            </h4>
            <p className="text-sm">
              {source.resourceId} · {source.snapshot.subject} ·{" "}
              {source.snapshot.grade}
            </p>
            <p className="whitespace-pre-wrap">
              {source.snapshot.sourceReference}
            </p>
            <details>
              <summary>Read historical resource text</summary>
              <p className="whitespace-pre-wrap break-words">
                {source.snapshot.contentText}
              </p>
            </details>
          </section>
        ))}
      </section>
      <section className="space-y-2">
        <h3 className="section-title">Review of this exact revision</h3>
        {revision.review ? (
          <>
            <p className="font-semibold">
              {revision.review.decision === "APPROVE"
                ? "Approved"
                : "Changes requested"}
            </p>
            <p className="whitespace-pre-wrap">
              {revision.review.feedback ?? "No approval comments."}
            </p>
            <p className="text-sm">Reviewer ID: {revision.review.reviewerId}</p>
            <p className="text-sm">
              Review ID: {revision.review.id} ·{" "}
              <time dateTime={revision.review.decidedAt}>
                {revision.review.decidedAt}
              </time>
            </p>
          </>
        ) : (
          <p>
            Awaiting administrator review. No decision is recorded in this
            response.
          </p>
        )}
      </section>
    </article>
  );
}

export function WorkflowView({
  store,
  paused,
  admin,
  historyView = true,
}: {
  store: ReviewStore;
  paused: boolean;
  admin: boolean;
  historyView?: boolean;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => initialReviewState,
  );
  const pathname = usePathname();
  const [enteredId, setEnteredId] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const focus = useRef<HTMLHeadingElement>(null),
    comments = useRef<HTMLTextAreaElement>(null);
  const requestedPath = useRef<string | null>(null);
  const busy = paused || !!state.pending;
  const locked = busy || !!state.confirmation || !!state.uncertain;
  useLayoutEffect(() => {
    store.activate();
    return store.dispose;
  }, [store]);
  useLayoutEffect(() => {
    store.pause(paused);
  }, [store, paused]);
  useWorkspaceProtection(() => {
    const current = store.getSnapshot();
    return {
      dirty: !!current.comments,
      blocked: current.pending === "write" || !!current.uncertain,
      paused,
    };
  });
  useEffect(() => {
    const routeId = pathname.startsWith("/history/")
      ? pathname.slice("/history/".length)
      : null;
    if (
      !paused &&
      routeId &&
      lessonUuid.test(routeId) &&
      requestedPath.current !== pathname &&
      !state.pending &&
      !state.uncertain &&
      !state.confirmation
    ) {
      requestedPath.current = pathname;
      void store.history(routeId);
    }
  }, [
    pathname,
    paused,
    state.lessonId,
    state.pending,
    state.uncertain,
    state.confirmation,
    store,
  ]);
  useEffect(() => {
    if (state.confirmation || state.error || state.uncertain || state.notice) {
      focus.current?.focus();
      focus.current?.scrollIntoView({ block: "start" });
    }
  }, [state.confirmation, state.error, state.uncertain, state.notice]);
  const choose = (lessonId: string, revisionId: string) => {
    const different =
      state.selected?.workflow.lessonId !== lessonId ||
      state.selected?.revision.id !== revisionId;
    const discard =
      !different ||
      !state.comments ||
      window.confirm(
        "Discard entered comments for the previous revision and open this exact revision?",
      );
    if (discard) {
      setCommentError(null);
      void store.detail(lessonId, revisionId, true);
    }
  };
  const prepare = (decision: Decision) => {
    const error =
      state.comments.length > 4000 || state.comments.includes("\0")
        ? "Use at most 4,000 UTF-16 units and no NUL characters."
        : decision === "REQUEST_CHANGES" && !state.comments.trim()
          ? "Enter nonblank comments to request changes."
          : null;
    setCommentError(error);
    if (error) comments.current?.focus();
    else store.prepareReview(decision);
  };
  const actionable =
    state.selected?.workflow.state === "SUBMITTED" &&
    state.selected.workflow.currentRevisionId === state.selected.revision.id &&
    !state.selected.revision.review;
  const showResult =
    historyView ||
    !!state.notice ||
    !!state.uncertain ||
    !!state.confirmation ||
    !!state.error ||
    state.blocked;
  if (!showResult) return null;
  return (
    <section
      className="min-w-0 space-y-6"
      aria-label={
        admin
          ? "Administrator review workspace"
          : "Submission and history workspace"
      }
      aria-busy={!!state.pending}
    >
      <h2 ref={focus} tabIndex={-1} className="section-title">
        {admin
          ? "Review submissions"
          : historyView
            ? "Revision history"
            : "Submission"}
      </h2>
      {paused && (
        <p role="status">
          Workflow controls are paused while your session is unconfirmed.
          Entered work is retained.
        </p>
      )}
      <p role="status" aria-live="polite" aria-atomic="true">
        {state.pending === "write"
          ? "Sending decision or submission… Do not retry or leave until its result is known."
          : state.pending === "read"
            ? "Loading workflow…"
            : state.notice}
      </p>
      {state.error && (
        <p role="alert" className="feedback">
          {state.error}
        </p>
      )}
      <fieldset disabled={paused} className="min-w-0 space-y-6">
        <legend className="sr-only">
          {admin ? "Administrator review actions" : "Teacher workflow actions"}
        </legend>
        {historyView && !admin && (
          <form
            className="workspace-panel space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (lessonUuid.test(enteredId))
                void store.history(enteredId.toLowerCase());
            }}
          >
            <label htmlFor="history-lesson-id" className="block font-semibold">
              Owned lesson ID
            </label>
            <Input
              id="history-lesson-id"
              value={enteredId}
              onChange={(event) => setEnteredId(event.target.value)}
              required
              pattern={lessonUuid.source}
              aria-describedby="history-id-help"
            />
            <p id="history-id-help">
              Open a known lesson ID. The API lists editable drafts only; it
              does not list every submitted lesson. Keep the history URL for
              later visits.
            </p>
            <Button type="submit" disabled={locked}>
              Open lesson history
            </Button>
          </form>
        )}
        {historyView && admin && (
          <section className="space-y-3" aria-label="Pending queue">
            <p>
              Current unreviewed submissions only. Pages are ordered by lesson
              UUID, not submission time. No other filters are supported.
            </p>
            <Button disabled={locked} onClick={() => void store.queue()}>
              Reload pending queue
            </Button>
            {state.queue && (
              <>
                <ul className="grid gap-4">
                  {state.queue.items.map(({ workflow, revision }) => (
                    <li
                      className="workspace-panel space-y-3"
                      key={workflow.lessonId}
                    >
                      <h3 className="font-semibold">
                        {revision.title} · Revision {revision.number}
                      </h3>
                      <p className="text-sm">
                        Lesson {workflow.lessonId} · Version {workflow.version}
                      </p>
                      <Button
                        disabled={locked}
                        onClick={() => choose(workflow.lessonId, revision.id)}
                      >
                        Inspect submitted revision {revision.number}
                      </Button>
                    </li>
                  ))}
                </ul>
                {!state.queue.items.length && (
                  <p>No pending submissions on this page.</p>
                )}
                {state.queue.nextAfter && (
                  <Button
                    disabled={locked}
                    onClick={() => void store.queue(state.queue!.nextAfter!)}
                  >
                    Next queue page
                  </Button>
                )}
              </>
            )}
          </section>
        )}
        {historyView && state.lessonId && (
          <section className="space-y-3" aria-label="Lesson revision history">
            <p className="text-sm">Lesson ID: {state.lessonId}</p>
            {!admin && (
              <Link className="text-link" href={`/history/${state.lessonId}`}>
                History URL for this lesson
              </Link>
            )}
            <Button
              disabled={locked}
              onClick={() => void store.history(state.lessonId!)}
            >
              Reload revision history
            </Button>
            {state.history && (
              <>
                <p>
                  Current state {state.history.workflow.state} · Version{" "}
                  {state.history.workflow.version}. Viewing history never adopts
                  this version into an editor. Pages follow revision UUID order;
                  revision numbers show chronology.
                </p>
                <ul className="grid gap-3">
                  {state.history.items.map((revision) => (
                    <li className="workspace-panel space-y-2" key={revision.id}>
                      <h3 className="font-semibold">
                        Revision {revision.number}: {revision.title}
                      </h3>
                      <p>
                        {revision.submittedAt} · {revision.generationOrigin} ·{" "}
                        {revision.review?.decision ?? "Awaiting review"}
                      </p>
                      <Button
                        disabled={locked}
                        onClick={() => choose(state.lessonId!, revision.id)}
                      >
                        Read revision {revision.number}
                      </Button>
                    </li>
                  ))}
                </ul>
                {!state.history.items.length && (
                  <p>No submitted revisions on this page.</p>
                )}
                {state.history.nextAfter && (
                  <Button
                    disabled={locked}
                    onClick={() =>
                      void store.history(
                        state.lessonId!,
                        state.history!.nextAfter!,
                      )
                    }
                  >
                    Next history page
                  </Button>
                )}
              </>
            )}
          </section>
        )}
        {state.confirmation && (
          <section
            className="feedback space-y-3"
            aria-label="Workflow confirmation"
          >
            <h3 className="section-title">
              {state.confirmation.kind === "submit"
                ? "Confirm submission"
                : state.confirmation.decision === "APPROVE"
                  ? "Confirm approval"
                  : "Confirm requested changes"}
            </h3>
            <p>
              Lesson {state.confirmation.lessonId} · Expected lesson version{" "}
              {state.confirmation.version}
            </p>
            {state.confirmation.kind === "submit" ? (
              <p>
                Only the saved draft is submitted as revision{" "}
                {state.confirmation.baseline + 1}. Its content and retained
                sources become immutable. Editing is locked until an
                administrator requests changes.
              </p>
            ) : (
              <>
                <p>
                  Exact submitted revision ID: {state.confirmation.revisionId}.
                  This final decision cannot be edited or revoked.
                </p>
                <p>
                  {state.confirmation.decision === "APPROVE"
                    ? "Approval closes editing and makes this exact revision eligible for the approved library."
                    : "Requested changes create a new editable draft for the owner while preserving this submission and review."}
                </p>
                <p className="whitespace-pre-wrap">
                  Comments: {state.confirmation.feedback || "None"}
                </p>
              </>
            )}
            <div className="flex flex-wrap gap-3">
              <Button disabled={busy} onClick={() => void store.confirm()}>
                {state.confirmation.kind === "submit"
                  ? "Confirm submit saved revision"
                  : "Confirm record decision"}
              </Button>
              <Button disabled={busy} onClick={store.cancelConfirmation}>
                Cancel confirmation
              </Button>
            </div>
          </section>
        )}
        {(state.uncertain || state.blocked) && (
          <section
            className="feedback space-y-3"
            aria-label="Workflow recovery"
          >
            <h3 className="section-title">
              {state.uncertain
                ? "Write outcome uncertain"
                : "Workflow conflict"}
            </h3>
            <p>
              Reads never retry a write or adopt a version. Missing results do
              not prove failure. Keep entered work and inspect the exact
              historical outcome.
            </p>
            <Button
              disabled={busy || !!state.confirmation}
              onClick={() => void store.recover()}
            >
              Recover exact outcome
            </Button>
            {state.uncertain && state.recovered && (
              <Button disabled={busy} onClick={store.acknowledgeRecovery}>
                Acknowledge recorded outcome
              </Button>
            )}
            {!state.uncertain && state.compared && admin && (
              <Button disabled={busy} onClick={store.acceptComparison}>
                Accept displayed revision and version
              </Button>
            )}
            {!state.uncertain && !admin && (
              <Button disabled={busy} onClick={store.clearSubmissionConflict}>
                Return to explicit draft reconciliation
              </Button>
            )}
          </section>
        )}
        {state.selected && <RevisionContent detail={state.selected} />}
        {admin && state.selected && (
          <section
            className="workspace-panel space-y-4"
            aria-label="Review decision"
          >
            <h2 className="section-title">
              Decision for revision {state.selected.revision.number}
            </h2>
            <p>
              Target: {state.selected.revision.id} · Viewed lesson version{" "}
              {state.selected.workflow.version}
            </p>
            {!actionable && (
              <p>
                This viewed revision is historical or already reviewed. No
                decision is available.
              </p>
            )}
            <LabeledTextarea
              ref={comments}
              label="Review comments"
              value={state.comments}
              maxLength={4000}
              rows={5}
              disabled={busy || !!state.confirmation}
              aria-describedby="review-comments-help review-comments-error"
              aria-invalid={commentError ? true : undefined}
              onChange={(event) => {
                setCommentError(null);
                store.comments(event.target.value);
              }}
            />
            <p id="review-comments-help">
              Required for requested changes; optional for approval. Maximum
              4,000 UTF-16 units. Comments are trimmed by the backend. Entered
              comments are kept through recoverable failures.
            </p>
            <p
              id="review-comments-error"
              role={commentError ? "alert" : undefined}
            >
              {commentError}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={locked || state.blocked || !actionable}
                onClick={() => prepare("APPROVE")}
              >
                Approve exact revision
              </Button>
              <Button
                disabled={locked || state.blocked || !actionable}
                onClick={() => prepare("REQUEST_CHANGES")}
              >
                Request changes
              </Button>
              <Button
                disabled={busy || !!state.confirmation}
                onClick={() => {
                  if (window.confirm("Discard entered review comments?")) {
                    store.comments("");
                    setCommentError(null);
                  }
                }}
              >
                Discard entered comments
              </Button>
            </div>
          </section>
        )}
        {!admin && state.selected && (
          <div className="flex flex-wrap gap-3">
            <Link
              className="text-link"
              href={`/history/${state.selected.workflow.lessonId}`}
            >
              Open this lesson history
            </Link>
            {state.selected.workflow.state === "CHANGES_REQUESTED" && (
              <Link className="text-link" href="/drafts">
                Return to My drafts to reopen the editable draft
              </Link>
            )}
          </div>
        )}
      </fieldset>
    </section>
  );
}

export function AdministratorReviewsPanel() {
  const auth = useAuth();
  if (!auth.identity || auth.identity.user.role !== "ADMIN") return null;
  return (
    <AdministratorWorkspace
      key={`${auth.identity.user.id}:${auth.identity.expiresAt}`}
      actor={auth.identity.user}
      paused={auth.status !== "authenticated" || auth.pending !== null}
      sessionEnded={auth.endSession}
    />
  );
}
function AdministratorWorkspace({
  actor,
  paused,
  sessionEnded,
}: {
  actor: { id: string; role: "TEACHER" | "ADMIN" };
  paused: boolean;
  sessionEnded: () => void;
}) {
  const [store] = useState(() =>
    createReviewState(
      createReviewApi(process.env.NEXT_PUBLIC_API_BASE_URL),
      actor,
      sessionEnded,
    ),
  );
  return <WorkflowView store={store} paused={paused} admin />;
}
