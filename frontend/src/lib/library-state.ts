import { AuthApiError } from "./api-request.ts";
import { copyKey, validateCopyReceipt } from "./library-api.ts";
import type {
  CopyIntent,
  CopyReceipt,
  LibraryApi,
  LibraryDetail,
  LibraryPage,
} from "./library-api.ts";
import type { Lesson, LessonsApi } from "./lessons-api.ts";
import type {
  ReviewApi,
  RevisionDetail,
  Workflow,
} from "./lesson-review-api.ts";

type Operation = {
  intent: CopyIntent;
  receipt: CopyReceipt | null;
  message: string;
};
type Destination = { key: string; workflow: Workflow } & (
  { draft: Lesson; revision: null } | { draft: null; revision: RevisionDetail }
);
export type LibraryState = {
  page: LibraryPage | null;
  detail: LibraryDetail | null;
  operations: Operation[];
  destination: Destination | null;
  pending: boolean;
  error: string | null;
  notice: string | null;
};
export const initialLibraryState: LibraryState = {
  page: null,
  detail: null,
  operations: [],
  destination: null,
  pending: false,
  error: null,
  notice: null,
};
const sameWorkflow = (a: Workflow, b: Workflow) =>
  a.lessonId === b.lessonId &&
  a.version === b.version &&
  a.state === b.state &&
  a.currentRevisionId === b.currentRevisionId;
export function createLibraryState(
  api: LibraryApi,
  role: "TEACHER" | "ADMIN",
  history: ReviewApi,
  drafts: LessonsApi,
  sessionEnded: () => void = () => {},
  newKey: () => string = () => crypto.randomUUID().toLowerCase(),
) {
  let state = initialLibraryState;
  let alive = true,
    paused = false,
    generation = 0;
  let controller: AbortController | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<LibraryState>) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  const idle = () => alive && !paused && !state.pending;
  const operation = (key: string) =>
    state.operations.find((o) => o.intent.key === key);
  function patchOperation(key: string, patch: Partial<Operation>) {
    update({
      operations: state.operations.map((o) =>
        o.intent.key === key ? { ...o, ...patch } : o,
      ),
    });
  }
  async function run(
    request: (signal: AbortSignal) => Promise<Partial<LibraryState>>,
    key?: string,
    failureNotice?: string,
  ) {
    if (!idle()) return;
    const current = ++generation;
    controller = new AbortController();
    update({ pending: true, error: null, notice: null });
    try {
      const patch = await request(controller.signal);
      if (!alive || paused || current !== generation) return;
      update({ ...patch, pending: false });
    } catch (error) {
      if (!alive || paused || current !== generation) return;
      const message =
        error instanceof AuthApiError
          ? error.message
          : "Request failed. Check the exact copy status before continuing.";
      update({ pending: false, error: message, notice: failureNotice ?? null });
      if (key)
        patchOperation(key, {
          message: `${message} The operation remains unresolved. Original key and parameters retained.`,
        });
      if (error instanceof AuthApiError && error.reason === "unauthenticated")
        sessionEnded();
    }
  }
  function resolve(
    intent: CopyIntent,
    receipt: CopyReceipt | null,
  ): Partial<LibraryState> {
    if (receipt) validateCopyReceipt({ operation: receipt }, intent);
    return {
      operations: state.operations.map((o) =>
        o.intent.key === intent.key
          ? {
              ...o,
              receipt,
              message: receipt
                ? "Copy destination confirmed. Read its current workflow before opening it. Approval is not transferred."
                : "No committed receipt found yet (404). The copy is still unresolved; the original request may be in flight. Check again or retry the same copy.",
            }
          : o,
      ),
    };
  }
  function retry(key: string) {
    const o = operation(key);
    if (!idle() || role !== "TEACHER" || !o || o.receipt)
      return Promise.resolve();
    const intent = structuredClone(o.intent);
    return run(
      async (signal) => resolve(intent, await api.copy(intent, signal)),
      key,
    );
  }
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    activate: () => {
      alive = true;
    },
    dispose: () => {
      alive = false;
      generation++;
      controller?.abort();
      state = initialLibraryState;
    },
    pause: (value: boolean) => {
      if (paused === value) return;
      paused = value;
      if (value) {
        generation++;
        controller?.abort();
        update({
          pending: false,
          destination: null,
          notice:
            "Library controls are paused while your session is unconfirmed. Retained copies must be checked after session confirmation.",
        });
      } else
        update({
          notice: state.operations.some((o) => !o.receipt)
            ? "Session confirmed. Check copy status or retry the same copy with its retained key and parameters."
            : null,
        });
    },
    browse: (after?: string) => {
      if (!idle() || (after && after !== state.page?.nextAfter))
        return Promise.resolve();
      return run(async (signal) => ({ page: await api.browse(after, signal) }));
    },
    detail: (lesson: string, revision: string) => {
      if (!idle()) return Promise.resolve();
      // Never keep a previous target actionable if the requested exact read fails.
      update({ detail: null });
      return run(async (signal) => ({
        detail: await api.detail(lesson, revision, signal),
      }));
    },
    copy: () => {
      if (
        !idle() ||
        role !== "TEACHER" ||
        !state.detail ||
        state.operations.some((o) => !o.receipt)
      )
        return Promise.resolve();
      let key: string;
      try {
        key = newKey();
      } catch {
        update({
          error: "A secure copy key could not be generated. No copy was sent.",
        });
        return Promise.resolve();
      }
      if (!copyKey.test(key) || operation(key)) {
        update({
          error:
            "A unique lowercase UUIDv4 copy key is required. No copy was sent.",
        });
        return Promise.resolve();
      }
      const intent = {
        key,
        source: {
          lessonId: state.detail.workflow.lessonId,
          revisionId: state.detail.revision.id,
          expectedVersion: state.detail.workflow.version,
        },
      };
      // Retain synchronously before issuing POST. Navigation never owns this store.
      update({
        operations: [
          ...state.operations,
          {
            intent,
            receipt: null,
            message:
              "Copy outcome unresolved. Keep this session open until the result is confirmed.",
          },
        ],
      });
      return retry(key);
    },
    check: (key: string) => {
      const o = operation(key);
      if (!idle() || role !== "TEACHER" || !o || o.receipt)
        return Promise.resolve();
      const intent = structuredClone(o.intent);
      return run(
        async (signal) => resolve(intent, await api.lookup(intent, signal)),
        key,
      );
    },
    retry,
    inspectDestination: (key: string) => {
      const receipt = operation(key)?.receipt;
      if (!idle() || role !== "TEACHER" || !receipt) return Promise.resolve();
      const id = receipt.destinationLessonId;
      update({ destination: null });
      return run(
        async (signal) => {
          const before = (await history.history(id, undefined, signal))
            .workflow;
          let destination: Destination;
          if (
            before.state === "DRAFT" ||
            before.state === "CHANGES_REQUESTED"
          ) {
            const draft = await drafts.detail(id, signal);
            if (
              draft.id !== id ||
              draft.state !== before.state ||
              draft.version !== before.version
            )
              throw new AuthApiError(
                "conflict",
                "Destination changed between reads. Read current destination again; no editor content was replaced.",
              );
            destination = { key, workflow: before, draft, revision: null };
          } else {
            const revision = await history.detail(
              id,
              before.currentRevisionId!,
              signal,
            );
            if (
              !sameWorkflow(before, revision.workflow) ||
              revision.revision.id !== before.currentRevisionId
            )
              throw new AuthApiError(
                "conflict",
                "Destination workflow changed. Read current destination again; entered edits are retained.",
              );
            destination = { key, workflow: before, draft: null, revision };
          }
          const after = (await history.history(id, undefined, signal)).workflow;
          if (!sameWorkflow(before, after))
            throw new AuthApiError(
              "conflict",
              "Destination changed during inspection. Read current destination again; no version was adopted.",
            );
          return {
            destination,
            notice:
              "Current authorized destination loaded. Later changes still require normal version reconciliation. Existing editor text is retained.",
          };
        },
        undefined,
        "Read current destination again to reconcile its workflow. The copy receipt and any entered editor text are retained.",
      );
    },
  };
}
export type LibraryStore = ReturnType<typeof createLibraryState>;
