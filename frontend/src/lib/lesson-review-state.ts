import { AuthApiError } from "./api-request.ts";
import { hasUnsavedLessonContent } from "./lessons-state.ts";
import type { createLessonsState } from "./lessons-state.ts";
import type { Lesson } from "./lessons-api.ts";
import type {
  Decision,
  HistoryPage,
  QueuePage,
  ReviewApi,
  RevisionDetail,
} from "./lesson-review-api.ts";

type DraftStore = ReturnType<typeof createLessonsState>;
type SubmitAttempt = {
  kind: "submit";
  lessonId: string;
  version: number;
  baseline: number;
  candidate: Lesson;
};
type ReviewAttempt = {
  kind: "review";
  lessonId: string;
  revisionId: string;
  version: number;
  decision: Decision;
  feedback: string;
};
export type WorkflowAttempt = SubmitAttempt | ReviewAttempt;
export type ReviewState = {
  lessonId: string | null;
  history: HistoryPage | null;
  queue: QueuePage | null;
  selected: RevisionDetail | null;
  comments: string;
  pending: "read" | "write" | null;
  confirmation: WorkflowAttempt | null;
  uncertain: WorkflowAttempt | null;
  blocked: boolean;
  compared: boolean;
  recovered: boolean;
  error: string | null;
  notice: string | null;
};
export const initialReviewState: ReviewState = {
  lessonId: null,
  history: null,
  queue: null,
  selected: null,
  comments: "",
  pending: null,
  confirmation: null,
  uncertain: null,
  blocked: false,
  compared: false,
  recovered: false,
  error: null,
  notice: null,
};
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
const sources = (value: Lesson["sources"]) =>
  [...value].sort((a, b) => a.resourceId.localeCompare(b.resourceId));
function matches(attempt: SubmitAttempt, result: RevisionDetail) {
  return (
    result.workflow.lessonId === attempt.lessonId &&
    result.revision.number === attempt.baseline + 1 &&
    result.revision.generationOrigin === attempt.candidate.generationOrigin &&
    canonical(result.revision.content) ===
      canonical(attempt.candidate.content) &&
    canonical(sources(result.revision.sources)) ===
      canonical(sources(attempt.candidate.sources))
  );
}
const unexpected = () =>
  new AuthApiError(
    "invalid-response",
    "The response did not identify the expected saved outcome. Recover the exact historical result; nothing was retried.",
  );
export function createReviewState(
  api: ReviewApi,
  actor: { id: string; role: "TEACHER" | "ADMIN" },
  sessionEnded: () => void = () => {},
  drafts?: DraftStore,
) {
  let state = initialReviewState;
  let alive = true,
    paused = false,
    generation = 0;
  let controller: AbortController | undefined;
  let activeWrite: WorkflowAttempt | null = null;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ReviewState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const idle = () => alive && !paused && !state.pending;
  const releaseDraft = () => {
    if (!state.uncertain && !state.confirmation && state.pending !== "write")
      drafts?.setWorkflowLock(false);
  };
  async function run(
    request: (signal: AbortSignal) => Promise<Partial<ReviewState>>,
    attempt?: WorkflowAttempt,
    accepted?: () => void,
  ) {
    if (!idle()) return;
    const current = ++generation;
    controller = new AbortController();
    activeWrite = attempt ?? null;
    update({
      pending: attempt ? "write" : "read",
      error: null,
      notice: null,
      compared: false,
      recovered: false,
    });
    try {
      const patch = await request(controller.signal);
      if (!alive || paused || current !== generation) return;
      activeWrite = null;
      update({ ...patch, pending: null });
      accepted?.();
      releaseDraft();
    } catch (error) {
      if (!alive || paused || current !== generation) return;
      activeWrite = null;
      const reason =
        error instanceof AuthApiError ? error.reason : "unavailable";
      const uncertain =
        attempt &&
        ["unavailable", "cancelled", "invalid-response"].includes(reason);
      if (attempt?.kind === "submit" && reason === "conflict")
        drafts?.submissionConflict();
      update({
        pending: null,
        confirmation: null,
        error:
          error instanceof AuthApiError
            ? error.message
            : "Workflow request failed. Read the exact result before continuing.",
        ...(uncertain
          ? {
              uncertain: attempt,
              notice:
                "The write may have completed. Use Recover exact outcome; do not retry automatically.",
            }
          : {}),
        ...(attempt && reason === "conflict" ? { blocked: true } : {}),
      });
      releaseDraft();
      if (reason === "unauthenticated") sessionEnded();
    }
  }
  const canRead = () => idle() && !state.confirmation;
  const canChangeTarget = () => canRead() && !state.uncertain;
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    activate: () => {
      alive = true;
    },
    dispose: () => {
      alive = false;
      generation++;
      controller?.abort();
      activeWrite = null;
      drafts?.setWorkflowLock(false);
      state = initialReviewState;
    },
    pause: (value: boolean) => {
      if (paused === value) return;
      paused = value;
      if (value) {
        generation++;
        controller?.abort();
        update({
          pending: null,
          confirmation: null,
          compared: false,
          recovered: false,
          ...(activeWrite
            ? {
                uncertain: activeWrite,
                notice:
                  "Session became unconfirmed during a write. Recover its exact result after checking session.",
              }
            : {}),
        });
        activeWrite = null;
        releaseDraft();
      }
    },
    comments: (comments: string) => {
      if (idle() && !state.confirmation) update({ comments });
    },
    queue: (after?: string) => {
      if (!canChangeTarget() || actor.role !== "ADMIN")
        return Promise.resolve();
      return run(async (signal) => ({
        queue: await api.pending(after, signal),
      }));
    },
    history: (lessonId: string, after?: string) => {
      if (!canChangeTarget()) return Promise.resolve();
      const different = state.lessonId !== lessonId;
      if (different && state.comments) return Promise.resolve();
      return run(async (signal) => ({
        history: await api.history(lessonId, after, signal),
        lessonId,
        ...(different ? { selected: null } : {}),
      }));
    },
    detail: (lessonId: string, revisionId: string, discardComments = false) => {
      if (!canChangeTarget()) return Promise.resolve();
      const different =
        state.selected?.workflow.lessonId !== lessonId ||
        state.selected?.revision.id !== revisionId;
      if (different && state.comments && !discardComments)
        return Promise.resolve();
      return run(async (signal) => ({
        selected: await api.detail(lessonId, revisionId, signal),
        lessonId,
        ...(different ? { comments: "", blocked: false } : {}),
      }));
    },
    prepareSubmission: () => {
      if (
        !idle() ||
        state.uncertain ||
        state.blocked ||
        state.confirmation ||
        actor.role !== "TEACHER" ||
        !drafts
      )
        return Promise.resolve();
      const draft = drafts.getSnapshot();
      if (
        draft.pending ||
        draft.uncertain ||
        draft.blocked ||
        draft.workflowLocked ||
        !draft.saved ||
        draft.baseVersion !== draft.saved.version ||
        hasUnsavedLessonContent(draft)
      ) {
        update({
          error:
            "Save and reconcile this draft before submission. Unsaved text is never submitted.",
        });
        return Promise.resolve();
      }
      const candidate = structuredClone(draft.saved);
      drafts.setWorkflowLock(true);
      return run(async (signal) => {
        const history = await api.history(candidate.id, undefined, signal);
        if (
          history.workflow.version !== candidate.version ||
          !["DRAFT", "CHANGES_REQUESTED"].includes(history.workflow.state)
        )
          throw new AuthApiError(
            "conflict",
            "The saved draft changed. Reconcile the draft before preparing submission again.",
          );
        let baseline = 0;
        if (history.workflow.currentRevisionId) {
          const current = await api.detail(
            candidate.id,
            history.workflow.currentRevisionId,
            signal,
          );
          if (
            current.workflow.version !== candidate.version ||
            current.workflow.currentRevisionId !==
              history.workflow.currentRevisionId
          )
            throw new AuthApiError(
              "conflict",
              "The current revision changed. Reconcile before submitting.",
            );
          baseline = current.revision.number;
        }
        return {
          history,
          selected: null,
          lessonId: candidate.id,
          confirmation: {
            kind: "submit",
            lessonId: candidate.id,
            version: candidate.version,
            baseline,
            candidate,
          },
        };
      });
    },
    prepareReview: (decision: Decision) => {
      if (
        !idle() ||
        actor.role !== "ADMIN" ||
        state.uncertain ||
        state.blocked ||
        state.confirmation
      )
        return;
      const selected = state.selected;
      if (
        !selected ||
        selected.workflow.state !== "SUBMITTED" ||
        selected.workflow.currentRevisionId !== selected.revision.id ||
        selected.revision.review
      )
        return;
      if (
        state.comments.length > 4000 ||
        state.comments.includes("\0") ||
        (decision === "REQUEST_CHANGES" && !state.comments.trim())
      ) {
        update({
          error:
            "Changes require nonblank comments. Comments must be at most 4,000 UTF-16 units and cannot contain NUL.",
        });
        return;
      }
      update({
        confirmation: {
          kind: "review",
          lessonId: selected.workflow.lessonId,
          revisionId: selected.revision.id,
          version: selected.workflow.version,
          decision,
          feedback: state.comments,
        },
        error: null,
        notice: null,
      });
    },
    cancelConfirmation: () => {
      if (idle()) {
        update({ confirmation: null });
        releaseDraft();
      }
    },
    confirm: () => {
      const attempt = state.confirmation;
      if (!idle() || !attempt || state.uncertain || state.blocked)
        return Promise.resolve();
      return run(
        async (signal) => {
          const selected =
            attempt.kind === "submit"
              ? await api.submit(attempt.lessonId, attempt.version, signal)
              : await api.review(
                  attempt.lessonId,
                  attempt.revisionId,
                  attempt.version,
                  attempt.decision,
                  attempt.feedback,
                  signal,
                );
          if (
            attempt.kind === "submit"
              ? !matches(attempt, selected)
              : selected.revision.review?.reviewerId !== actor.id ||
                selected.revision.review?.feedback !==
                  (attempt.feedback.trim() || null)
          )
            throw unexpected();
          return {
            selected,
            lessonId: attempt.lessonId,
            confirmation: null,
            blocked: false,
            ...(attempt.kind === "review" ? { comments: "" } : {}),
            notice:
              attempt.kind === "submit"
                ? `Revision ${selected.revision.number} submitted. Editing is locked while awaiting review.`
                : `Decision recorded for revision ${selected.revision.number}. ${selected.workflow.state === "APPROVED" ? "This exact revision is approved." : "An editable draft is available to its owner."}`,
          };
        },
        attempt,
        () => {
          if (attempt.kind === "submit")
            drafts?.submissionFinished(attempt.lessonId);
        },
      );
    },
    recover: () => {
      if (!canRead()) return Promise.resolve();
      const attempt = state.uncertain;
      if (attempt?.kind === "submit")
        return run(async (signal) => {
          let cursor: string | undefined;
          const visited = new Set<string>();
          do {
            const history = await api.history(attempt.lessonId, cursor, signal);
            const candidate = history.items.find(
              (revision) => revision.number === attempt.baseline + 1,
            );
            if (candidate) {
              const selected = await api.detail(
                attempt.lessonId,
                candidate.id,
                signal,
              );
              const recovered = matches(attempt, selected);
              return {
                history,
                selected,
                recovered,
                notice: recovered
                  ? "Matching submitted snapshot found, even if it was later reviewed or resubmitted. Inspect it, then acknowledge recovery."
                  : "That revision contains a different snapshot. This read cannot confirm your submission; keep the write uncertain.",
              };
            }
            cursor = history.nextAfter ?? undefined;
            if (cursor && visited.has(cursor)) throw unexpected();
            if (cursor) visited.add(cursor);
          } while (cursor);
          return {
            notice:
              "No matching revision is visible. The request may still be in flight; absence does not prove failure. Submission remains uncertain.",
          };
        });
      const selected = state.selected;
      const lessonId = attempt?.lessonId ?? selected?.workflow.lessonId;
      const revisionId =
        attempt?.kind === "review" ? attempt.revisionId : selected?.revision.id;
      if (!lessonId || !revisionId) return Promise.resolve();
      return run(async (signal) => {
        const result = await api.detail(lessonId, revisionId, signal);
        const review = result.revision.review;
        const matching =
          attempt?.kind === "review" &&
          review?.reviewerId === actor.id &&
          review?.decision === attempt.decision &&
          review.feedback === (attempt.feedback.trim() || null);
        return {
          selected: result,
          compared: !attempt,
          recovered: !!attempt && !!review,
          notice: attempt
            ? review
              ? matching
                ? "Your matching decision is recorded. Inspect it, then acknowledge recovery."
                : "A competing decision is recorded for this revision. Inspect the winning decision, then acknowledge the conflict."
              : "No decision is visible. It may still be in flight; review remains uncertain."
            : "Exact revision reloaded. Accept this comparison explicitly before another decision.",
        };
      });
    },
    acceptComparison: () => {
      if (idle() && !state.uncertain && state.compared)
        update({
          blocked: false,
          compared: false,
          notice:
            "Displayed revision and version accepted explicitly. Comments are retained; any next decision needs a new confirmation.",
        });
    },
    acknowledgeRecovery: () => {
      if (!idle() || !state.uncertain || !state.recovered) return;
      const attempt = state.uncertain;
      if (attempt.kind === "submit")
        drafts?.submissionFinished(attempt.lessonId);
      update({
        uncertain: null,
        recovered: false,
        blocked: false,
        notice: "Recorded outcome acknowledged. No write was retried.",
      });
      releaseDraft();
    },
    clearSubmissionConflict: () => {
      if (idle() && !state.uncertain && actor.role === "TEACHER") {
        update({ blocked: false });
        releaseDraft();
      }
    },
  };
}
export type ReviewStore = ReturnType<typeof createReviewState>;
