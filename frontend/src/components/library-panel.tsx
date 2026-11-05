"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAuth } from "./auth-provider";
import { useDraftWorkspace } from "./draft-workspace";
import {
  useWorkspaceNavigation,
  useWorkspaceProtection,
} from "./workspace-navigation";
import { Button } from "./ui-controls";
import { RevisionContent } from "./lesson-review-panel";
import { createLibraryApi } from "@/lib/library-api";
import { createLibraryState, initialLibraryState } from "@/lib/library-state";
import { createLessonsApi } from "@/lib/lessons-api";
import { createReviewApi } from "@/lib/lesson-review-api";

export function LibraryPanel() {
  const auth = useAuth();
  if (!auth.identity) return null;
  return (
    <LibraryWorkspace
      key={`${auth.identity.user.id}:${auth.identity.user.role}:${auth.identity.expiresAt}`}
      role={auth.identity.user.role}
      paused={auth.status !== "authenticated" || auth.pending !== null}
      sessionEnded={auth.endSession}
    />
  );
}
function LibraryWorkspace({
  role,
  paused,
  sessionEnded,
}: {
  role: "TEACHER" | "ADMIN";
  paused: boolean;
  sessionEnded: () => void;
}) {
  const [store] = useState(() =>
    createLibraryState(
      createLibraryApi(process.env.NEXT_PUBLIC_API_BASE_URL),
      role,
      createReviewApi(process.env.NEXT_PUBLIC_API_BASE_URL),
      createLessonsApi(process.env.NEXT_PUBLIC_API_BASE_URL),
      sessionEnded,
    ),
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => initialLibraryState,
  );
  const drafts = useDraftWorkspace();
  const pathname = usePathname(),
    router = useRouter();
  const navigation = useWorkspaceNavigation();
  const visible = pathname === "/library";
  const busy = paused || state.pending;
  const unresolved = state.operations.some((o) => !o.receipt);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const [editorMessage, setEditorMessage] = useState<string | null>(null);
  useLayoutEffect(() => {
    store.activate();
    return store.dispose;
  }, [store]);
  useLayoutEffect(() => {
    store.pause(paused);
  }, [store, paused]);
  useWorkspaceProtection(() => ({
    dirty: false,
    blocked: false,
    paused,
    unresolvedCopy: store.getSnapshot().operations.some((o) => !o.receipt),
  }));
  useEffect(() => {
    if (visible && !paused && !state.page && !state.pending && !state.error)
      void store.browse();
  }, [visible, paused, state.page, state.pending, state.error, store]);
  useEffect(() => {
    if (visible && state.detail) detailHeading.current?.focus();
  }, [visible, state.detail]);
  return (
    <>
      {unresolved && (
        <p role="status" className="feedback">
          A copy is unresolved. Its key survives navigation in this
          authenticated workspace only. Reloading, closing this tab or ending
          the session loses the recovery key; no browser storage is used.
          {!visible && (
            <>
              {" "}
              <Link className="text-link" href="/library">
                Return to Library copy recovery
              </Link>
            </>
          )}
        </p>
      )}
      <section
        hidden={!visible}
        className="min-w-0 space-y-6"
        aria-label="Approved library workspace"
        aria-busy={state.pending}
      >
        <p>
          Browse exact approved revisions. Pages use lesson ID cursor order, not
          approval dates. Each page is a fresh snapshot; restart to see new
          approvals before your cursor.
        </p>
        {paused && (
          <p role="status" className="feedback">
            Library controls are paused while your session is unconfirmed. Check
            session again before recovering a copy.
          </p>
        )}
        {state.error && (
          <p role="alert" className="feedback">
            {state.error}
          </p>
        )}
        {state.notice && <p role="status">{state.notice}</p>}
        {state.pending && <p role="status">Loading library request…</p>}
        <fieldset disabled={busy} className="min-w-0 space-y-6">
          <legend className="sr-only">Approved library controls</legend>
          <Button onClick={() => void store.browse()}>
            Restart library browsing
          </Button>
          <ul aria-label="Approved lessons" className="grid gap-4">
            {state.page?.items.map((item) => (
              <li
                key={item.workflow.lessonId}
                className="workspace-panel space-y-3"
              >
                <h2 className="section-title">{item.revision.title}</h2>
                <p>
                  Revision {item.revision.number} ·{" "}
                  {item.revision.generationOrigin} · Approved {item.approvedAt}
                </p>
                <Button
                  onClick={() =>
                    void store.detail(item.workflow.lessonId, item.revision.id)
                  }
                  aria-label={`Read approved revision: ${item.revision.title}`}
                >
                  Read approved revision
                </Button>
              </li>
            ))}
          </ul>
          {state.page && !state.page.items.length && (
            <p>No approved lessons on this page.</p>
          )}
          {state.page?.nextAfter && (
            <Button onClick={() => void store.browse(state.page!.nextAfter!)}>
              Next library page
            </Button>
          )}
          {state.detail && (
            <section className="space-y-4" aria-label="Exact approved revision">
              <h2 ref={detailHeading} tabIndex={-1} className="section-title">
                Exact approved revision
              </h2>
              <p>
                Approved {state.detail.approvedAt}. Citations and snapshots are
                retained text; they may refer to older or retired resources.
              </p>
              <RevisionContent detail={state.detail} />
              {role === "TEACHER" && (
                <>
                  <p>
                    A copy becomes your independent draft with its original
                    generation origin and snapshots. It needs its own submission
                    and review.
                  </p>
                  <Button
                    disabled={unresolved}
                    onClick={() => void store.copy()}
                  >
                    Copy to my drafts
                  </Button>
                  {state.operations.some((o) => !!o.receipt) && (
                    <p>
                      Choosing Copy to my drafts again intentionally creates
                      another draft with a new key.
                    </p>
                  )}
                </>
              )}
            </section>
          )}
          {role === "TEACHER" &&
            state.operations.map((o) => (
              <section
                key={o.intent.key}
                className="workspace-panel min-w-0 space-y-3 break-words"
                aria-label={`Copy operation ${o.intent.key}`}
              >
                <h2 className="section-title">
                  {o.receipt ? "Copy destination confirmed" : "Copy recovery"}
                </h2>
                <dl className="text-sm">
                  <dt>Operation key</dt>
                  <dd>{o.intent.key}</dd>
                  <dt>Source lesson ID</dt>
                  <dd>{o.intent.source.lessonId}</dd>
                  <dt>Exact source revision ID</dt>
                  <dd>{o.intent.source.revisionId}</dd>
                  <dt>Original expected version</dt>
                  <dd>{o.intent.source.expectedVersion}</dd>
                  {o.receipt && (
                    <>
                      <dt>Destination lesson ID</dt>
                      <dd>{o.receipt.destinationLessonId}</dd>
                    </>
                  )}
                </dl>
                <p role="status">{o.message}</p>
                {!o.receipt ? (
                  <div className="flex flex-wrap gap-3">
                    <Button onClick={() => void store.check(o.intent.key)}>
                      Check copy status
                    </Button>
                    <Button onClick={() => void store.retry(o.intent.key)}>
                      Retry same copy
                    </Button>
                  </div>
                ) : (
                  <Button
                    onClick={() => {
                      setEditorMessage(null);
                      void store.inspectDestination(o.intent.key);
                    }}
                  >
                    Read current destination
                  </Button>
                )}
              </section>
            ))}
          {state.destination && (
            <section
              className="space-y-4"
              aria-label="Current copy destination"
            >
              <h2 className="section-title">
                Current destination · {state.destination.workflow.state} ·
                Version {state.destination.workflow.version}
              </h2>
              <p>
                Destination {state.destination.workflow.lessonId}. The receipt
                proves identity only. Reads do not overwrite any open editor.
              </p>
              {state.destination.revision && (
                <RevisionContent detail={state.destination.revision} />
              )}
              {state.destination.draft && (
                <>
                  <p>
                    Editable destination: {state.destination.draft.title}.
                    Origin: {state.destination.draft.generationOrigin}.
                  </p>
                  <Button
                    onClick={() => {
                      const draft = store.getSnapshot().destination?.draft;
                      if (!draft || !navigation.requestLeave()) return;
                      if (drafts.openLibraryDestination(draft)) {
                        setEditorMessage(null);
                        router.push("/drafts");
                      } else
                        setEditorMessage(
                          "Your open draft or pending workflow is retained. Return to My drafts to save or explicitly close it, then read this destination again. No entered text was replaced.",
                        );
                    }}
                  >
                    Open destination in My drafts
                  </Button>
                  <Link className="text-link" href="/drafts">
                    Return to existing draft editor
                  </Link>
                </>
              )}
              {editorMessage && (
                <p role="alert" className="feedback">
                  {editorMessage}
                </p>
              )}
            </section>
          )}
        </fieldset>
      </section>
    </>
  );
}
