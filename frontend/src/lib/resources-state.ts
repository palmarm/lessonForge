import { AuthApiError } from "./api-request.ts";
import type {
  Resource,
  ResourceContent,
  ResourceSummary,
  ResourcesApi,
} from "./resources-api.ts";

type ResourceWrite =
  | { type: "create"; targetId: null }
  | { type: "edit" | "retire"; targetId: string };

export type ResourceState = {
  items: ResourceSummary[];
  nextAfter: string | null;
  selected: Resource | null;
  form: ResourceContent | null;
  editId: string | null;
  baseVersion: number | null;
  pending: "read" | "write" | null;
  error: string | null;
  notice: string | null;
  uncertain: ResourceWrite | null;
  reconciled: boolean;
};
export const initialResourceState: ResourceState = {
  items: [],
  nextAfter: null,
  selected: null,
  form: null,
  editId: null,
  baseVersion: null,
  pending: null,
  error: null,
  notice: null,
  uncertain: null,
  reconciled: false,
};
export const blankResource = (): ResourceContent => ({
  title: "",
  subject: "Mathematics",
  grade: "Grade 4",
  sourceReference: "",
  contentText: "",
});
const content = (v: ResourceContent): ResourceContent => ({
  title: v.title,
  subject: v.subject,
  grade: v.grade,
  sourceReference: v.sourceReference,
  contentText: v.contentText,
});

export function hasUnsavedResourceContent(state: ResourceState): boolean {
  return (
    state.form !== null &&
    (!state.editId ||
      !state.selected ||
      state.selected.id !== state.editId ||
      JSON.stringify(content(state.form)) !==
        JSON.stringify(content(state.selected)))
  );
}

// One store per authenticated workspace. It never retries a write or rebases edits implicitly.
export function createResourcesState(
  api: ResourcesApi,
  role: "TEACHER" | "ADMIN",
  sessionEnded: () => void = () => {},
) {
  let state = initialResourceState;
  let generation = 0;
  let alive = true;
  let paused = false;
  let activeWrite: ResourceWrite | null = null;
  let controller: AbortController | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ResourceState>) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  async function run(
    operation: ResourceWrite | null,
    request: (signal: AbortSignal) => Promise<Partial<ResourceState>>,
    reconciling = false,
  ) {
    if (
      !alive ||
      paused ||
      state.pending === "write" ||
      (operation && (role !== "ADMIN" || state.pending || state.uncertain))
    )
      return;
    const current = ++generation;
    activeWrite = operation;
    controller?.abort();
    controller = new AbortController();
    update({
      pending: operation ? "write" : "read",
      error: null,
      notice: null,
      ...(reconciling || (!operation && state.uncertain) ? { reconciled: false } : {}),
    });
    try {
      const patch = await request(controller.signal);
      if (!alive || paused || generation !== current) return;
      // Defense against a malformed/misconfigured API leaking retired records into teacher views.
      if (
        role === "TEACHER" &&
        (patch.selected?.retiredAt || patch.items?.some((v) => v.retiredAt))
      )
        throw new AuthApiError(
          "invalid-response",
          "Unexpected resource visibility. Check your session.",
        );
      update({ ...patch, pending: null });
      activeWrite = null;
    } catch (error) {
      if (!alive || paused || generation !== current) return;
      activeWrite = null;
      const uncertain =
        operation !== null &&
        (!(error instanceof AuthApiError) ||
          ["unavailable", "cancelled", "invalid-response"].includes(
            error.reason,
          ));
      update({
        pending: null,
        error:
          error instanceof AuthApiError
            ? error.message
            : "Resource request failed. Reload to reconcile before trying again.",
        ...(uncertain
          ? {
              uncertain: operation,
              reconciled: false,
              notice:
                "The write may have completed. Reload to reconcile; no write has been retried.",
            }
          : {}),
      });
      if (error instanceof AuthApiError && error.reason === "unauthenticated")
        sessionEnded();
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
      state = initialResourceState;
    },
    pause: (value: boolean) => {
      if (paused === value) return;
      paused = value;
      if (value) {
        generation++;
        controller?.abort();
        update({
          pending: null,
          reconciled: false,
          ...(activeWrite
            ? {
                uncertain: activeWrite,
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
        reconciled: state.uncertain?.type === "create",
      })),
    view: (id: string) => {
      if (
        (state.form || state.uncertain) &&
        !(state.uncertain?.type === "create" && state.form)
      )
        return Promise.resolve();
      return run(null, async (signal) => ({
        selected: await api.detail(id, signal),
        reconciled: state.uncertain?.type === "create",
      }));
    },
    reconcile: () => {
      const operation = state.uncertain;
      // A create has no known target. Never infer an uncertain write's target
      // from a list page, the form, or whichever detail happens to be displayed.
      const targetId = operation
        ? operation.targetId
        : (state.editId ?? (!state.form ? state.selected?.id : null));
      return run(
        null,
        async (signal) => {
          if (targetId) {
            const selected = await api.detail(targetId, signal);
            if (selected.id !== targetId)
              throw new AuthApiError(
                "invalid-response",
                "Unexpected resource response. Reload the original resource to reconcile.",
              );
            return { selected, reconciled: operation !== null };
          }
          return {
            ...(await api.list(undefined, signal)),
            reconciled: operation?.type === "create",
          };
        },
        true,
      );
    },
    create: () => {
      if (
        alive &&
        !paused &&
        role === "ADMIN" &&
        !state.pending &&
        !state.uncertain
      )
        update({
          selected: null,
          form: blankResource(),
          editId: null,
          baseVersion: null,
          error: null,
          notice: null,
        });
    },
    edit: () => {
      if (
        alive &&
        !paused &&
        role === "ADMIN" &&
        state.selected &&
        !state.selected.retiredAt &&
        !state.pending &&
        !state.uncertain
      )
        update({
          form: content(state.selected),
          editId: state.selected.id,
          baseVersion: state.selected.version,
          error: null,
          notice: null,
        });
    },
    field: (
      key: "title" | "sourceReference" | "contentText",
      value: string,
    ) => {
      if (alive && !paused && state.form && !state.pending)
        update({ form: { ...state.form, [key]: value } });
    },
    cancel: () => {
      if (alive && !paused && !state.pending && !state.uncertain)
        update({ form: null, editId: null, baseVersion: null, error: null });
    },
    useLatestVersion: () => {
      if (
        alive &&
        !paused &&
        !state.pending &&
        !state.uncertain &&
        state.form &&
        state.editId === state.selected?.id &&
        !state.selected.retiredAt
      )
        update({
          baseVersion: state.selected.version,
          notice:
            "Your text is retained. The next save will use the displayed latest version.",
          error: null,
        });
    },
    acknowledge: () => {
      if (
        alive &&
        !paused &&
        !state.pending &&
        state.uncertain &&
        state.reconciled
      )
        update({
          uncertain: null,
          reconciled: false,
          notice: "Result checked. You may now choose another action.",
        });
    },
    save: () => {
      const { form, editId, baseVersion } = state;
      if (!form) return Promise.resolve();
      return run(
        editId
          ? { type: "edit", targetId: editId }
          : { type: "create", targetId: null },
        async (signal) => {
          const selected = editId
            ? await api.edit(editId, baseVersion!, content(form), signal)
            : await api.create(content(form), signal);
          return {
            selected,
            form: null,
            editId: null,
            baseVersion: null,
            notice: "Resource saved. Reload the list to update browsing.",
          };
        },
      );
    },
    retire: () => {
      const selected = state.selected;
      if (!selected || state.form) return Promise.resolve();
      // Keep the target for reconciliation if the retirement response is uncertain.
      return run({ type: "retire", targetId: selected.id }, async (signal) => {
        const result = await api.retire(selected.id, selected.version, signal);
        return {
          selected: result,
          notice: "Resource retired. Reload the list to update browsing.",
        };
      });
    },
  };
}
