import { AuthApiError } from "./api-request.ts";
import type {
  DraftContent,
  Lesson,
  LessonPage,
  LessonsApi,
} from "./lessons-api.ts";
import type {
  Resource,
  ResourceSummary,
  ResourcesApi,
} from "./resources-api.ts";
type Write = {
  type: "create" | "save" | "select" | "remove" | "refresh";
  targetId: string | null;
};
export type LessonState = LessonPage & {
  form: DraftContent | null;
  editId: string | null;
  baseVersion: number | null;
  saved: Lesson | null;
  latest: Lesson | null;
  pending: "read" | "write" | null;
  error: string | null;
  notice: string | null;
  uncertain: Write | null;
  reconciled: boolean;
  creationListChecked: boolean;
  blocked: boolean;
  resourceItems: ResourceSummary[];
  resourceNext: string | null;
  resourceDetail: Resource | null;
};
export const initialLessonState: LessonState = {
  items: [],
  nextAfter: null,
  form: null,
  editId: null,
  baseVersion: null,
  saved: null,
  latest: null,
  pending: null,
  error: null,
  notice: null,
  uncertain: null,
  reconciled: false,
  creationListChecked: false,
  blocked: false,
  resourceItems: [],
  resourceNext: null,
  resourceDetail: null,
};
export function hasUnsavedLessonContent(
  state: Pick<LessonState, "form" | "saved">,
): boolean {
  if (!state.form) return false;
  if (!state.saved) return true;
  // JSONB may return keys in a different order; omitted optional values serialize away.
  const json = (content: DraftContent) =>
    JSON.stringify(content, (_key, value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
          )
        : value,
    );
  return json(state.form) !== json(state.saved.content);
}
export function createLessonsState(
  api: LessonsApi,
  sessionEnded: () => void = () => {},
  resources?: ResourcesApi,
) {
  let state = initialLessonState;
  let generation = 0,
    alive = true,
    paused = false;
  let controller: AbortController | undefined;
  let activeWrite: Write | null = null;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<LessonState>) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  const idle = () => alive && !paused && !state.pending;
  async function run(
    operation: Write | null,
    request: (signal: AbortSignal) => Promise<Partial<LessonState>>,
    reconciling = false,
  ) {
    if (!idle() || (operation && (state.uncertain || state.blocked))) return;
    const current = ++generation;
    activeWrite = operation;
    controller = new AbortController();
    update({
      pending: operation ? "write" : "read",
      error: null,
      notice: null,
      ...(reconciling || (!operation && state.uncertain)
        ? { reconciled: false, latest: null, creationListChecked: false }
        : {}),
    });
    try {
      const patch = await request(controller.signal);
      if (!alive || paused || current !== generation) return;
      update({ ...patch, pending: null });
      activeWrite = null;
    } catch (error) {
      if (!alive || paused || current !== generation) return;
      const reason =
        error instanceof AuthApiError ? error.reason : "unavailable";
      const uncertain =
        operation &&
        ["unavailable", "cancelled", "invalid-response"].includes(reason);
      update({
        pending: null,
        error:
          error instanceof AuthApiError
            ? error.message
            : "Lesson request failed. Reconcile before continuing.",
        ...(operation && reason === "conflict" ? { blocked: true } : {}),
        ...(uncertain
          ? {
              uncertain: operation,
              reconciled: false,
              notice:
                "The write may have completed. Load the latest result; no write was retried.",
            }
          : {}),
      });
      activeWrite = null;
      if (reason === "unauthenticated") sessionEnded();
    }
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
      activeWrite = null;
      state = initialLessonState;
    },
    // Authentication uncertainty invalidates pending responses but retains entered work.
    pause: (value: boolean) => {
      if (paused === value) return;
      paused = value;
      if (value) {
        generation++;
        controller?.abort();
        update({
          pending: null,
          reconciled: false,
          latest: null,
          creationListChecked: false,
          ...(activeWrite
            ? {
                uncertain: activeWrite,
                reconciled: false,
                notice:
                  "Session changed during a write. Reconcile its result before continuing.",
              }
            : {}),
        });
        activeWrite = null;
      }
    },
    list: (after?: string) =>
      run(null, async (signal) => ({
        ...(await api.list(after, signal)),
        creationListChecked: state.uncertain?.type === "create",
      })),
    resources: (after?: string) =>
      run(null, async (signal) => {
        if (!resources) return {};
        const page = await resources.list(after, signal);
        if (page.items.some((r) => r.retiredAt))
          throw new AuthApiError(
            "invalid-response",
            "Unexpected resource visibility. Check your session.",
          );
        return { resourceItems: page.items, resourceNext: page.nextAfter };
      }),
    resource: (id: string) =>
      run(null, async (signal) => {
        if (!resources) return {};
        const resourceDetail = await resources.detail(id, signal);
        if (resourceDetail.retiredAt)
          throw new AuthApiError(
            "invalid-response",
            "Resource is no longer active.",
          );
        return { resourceDetail };
      }),
    create: () => {
      if (idle() && !state.form && !state.uncertain)
        update({
          form: { subject: "Mathematics", grade: "Grade 4" },
          editId: null,
          baseVersion: null,
          saved: null,
          latest: null,
          blocked: false,
          error: null,
        });
    },
    view: (id: string) => {
      if (state.form || state.uncertain) return Promise.resolve();
      return run(null, async (signal) => {
        const saved = await api.detail(id, signal);
        return {
          saved,
          form: structuredClone(saved.content),
          editId: id,
          baseVersion: saved.version,
          latest: null,
          blocked: false,
        };
      });
    },
    field: (content: DraftContent) => {
      if (idle() && state.form) update({ form: structuredClone(content) });
    },
    close: () => {
      if (idle() && !state.uncertain)
        update({
          form: null,
          editId: null,
          baseVersion: null,
          saved: null,
          latest: null,
          blocked: false,
        });
    },
    save: () => {
      const { form, editId, baseVersion } = state;
      if (!form) return Promise.resolve();
      return run(
        { type: editId ? "save" : "create", targetId: editId },
        async (signal) => {
          const saved = editId
            ? await api.save(editId, baseVersion!, form, signal)
            : await api.create(form, signal);
          return {
            saved,
            editId: saved.id,
            baseVersion: saved.version,
            latest: null,
            notice: "Draft saved. No submitted revision was created.",
          };
        },
      );
    },
    source: (resourceId: string, action: "select" | "remove" | "refresh") => {
      const { editId, baseVersion } = state;
      if (!editId || !state.form) return Promise.resolve();
      return run({ type: action, targetId: editId }, async (signal) => {
        const saved = await api.source(
          editId,
          baseVersion!,
          resourceId,
          action,
          signal,
        );
        return {
          saved,
          baseVersion: saved.version,
          latest: null,
          notice:
            "Resource selection saved. Entered lesson text is retained; save it separately.",
        };
      });
    },
    reconcile: () => {
      const target = state.uncertain?.targetId ?? state.editId;
      return run(
        null,
        async (signal) =>
          target
            ? {
                latest: await api.detail(target, signal),
                reconciled: !!state.uncertain,
              }
            : {
                ...(await api.list(undefined, signal)),
                reconciled: false,
                creationListChecked: state.uncertain?.type === "create",
              },
        true,
      );
    },
    inspectCreation: (id: string) => {
      if (state.uncertain?.type !== "create") return Promise.resolve();
      return run(
        null,
        async (signal) => {
          const latest = await api.detail(id, signal);
          if (latest.id !== id)
            throw new AuthApiError(
              "invalid-response",
              "Unexpected draft candidate. Inspect the intended draft again.",
            );
          return { latest, reconciled: true };
        },
        true,
      );
    },
    acknowledge: () => {
      if (idle() && state.uncertain && state.reconciled)
        update({
          uncertain: null,
          reconciled: false,
          creationListChecked: false,
          notice:
            "Result checked. Choose explicitly whether to adopt the displayed draft/version or create again.",
        });
    },
    confirmCreationNotFound: () => {
      if (
        idle() &&
        state.uncertain?.type === "create" &&
        state.creationListChecked
      )
        update({
          uncertain: null,
          creationListChecked: false,
          notice:
            "You confirmed no matching draft after checking the list. Entered text is retained. A deliberate new create may duplicate an earlier creation; nothing has been retried.",
        });
    },
    adoptLatest: () => {
      if (
        idle() &&
        !state.uncertain &&
        state.latest &&
        state.form &&
        (!state.editId || state.editId === state.latest.id)
      )
        update({
          saved: state.latest,
          editId: state.latest.id,
          baseVersion: state.latest.version,
          blocked: false,
          notice:
            "Displayed version and selections adopted explicitly. Your entered lesson text is retained.",
        });
    },
  };
}
