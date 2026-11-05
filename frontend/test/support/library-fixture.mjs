import { createLibraryState } from "../../src/lib/library-state.ts";
import { createLessonsState } from "../../src/lib/lessons-state.ts";
import {
  content,
  source,
  lessonId,
  revisionId,
  otherId,
  stamp,
  saved,
  submitted,
} from "./review-fixture.mjs";
export { lessonId, revisionId, otherId, content, source, stamp };
export const key = "77777777-7777-4777-8777-777777777777";
export const nextKey = "88888888-8888-4888-8888-888888888888";
export const detail = {
  workflow: {
    lessonId,
    version: 6,
    state: "APPROVED",
    currentRevisionId: revisionId,
  },
  revision: {
    id: revisionId,
    number: 1,
    content,
    sources: [source],
    generationOrigin: "AI_ASSISTED",
    submittedAt: stamp,
  },
  approvedAt: stamp,
};
export const summary = {
  ...detail,
  revision: {
    id: revisionId,
    number: 1,
    title: content.title,
    generationOrigin: "AI_ASSISTED",
    submittedAt: stamp,
  },
};
export const intent = {
  key,
  source: { lessonId, revisionId, expectedVersion: 6 },
};
export const receipt = { ...intent, destinationLessonId: otherId };
export const destination = {
  ...saved,
  id: otherId,
  version: 1,
  generationOrigin: "AI_ASSISTED",
};
export function fixture(role = "TEACHER") {
  const f = {
    calls: [],
    ended: 0,
    keys: 0,
    receipt: structuredClone(receipt),
    destination: structuredClone(destination),
    workflow: {
      lessonId: otherId,
      version: 1,
      state: "DRAFT",
      currentRevisionId: null,
    },
  };
  f.api = {
    browse: async (after) => {
      f.calls.push(["browse", after]);
      return { items: [summary], nextAfter: null };
    },
    detail: async (l, r) => {
      f.calls.push(["detail", l, r]);
      return structuredClone(detail);
    },
    copy: async (i) => {
      f.calls.push(["copy", structuredClone(i)]);
      return { ...structuredClone(f.receipt), key: i.key };
    },
    lookup: async (i) => {
      f.calls.push(["lookup", structuredClone(i)]);
      return structuredClone(f.receipt);
    },
  };
  f.history = {
    history: async (id) => {
      f.calls.push(["history", id]);
      return {
        workflow: structuredClone(f.workflow),
        items: [],
        nextAfter: null,
      };
    },
    detail: async (id, revision) => {
      f.calls.push(["revision", id, revision]);
      return {
        workflow: structuredClone(f.workflow),
        revision: { ...submitted.revision, id: revision },
      };
    },
  };
  f.draftApi = {
    detail: async (id) => {
      f.calls.push(["draft", id]);
      return structuredClone(f.destination);
    },
    list: async () => ({ items: [], nextAfter: null }),
  };
  f.drafts = createLessonsState(f.draftApi);
  f.store = createLibraryState(
    f.api,
    role,
    f.history,
    f.draftApi,
    () => f.ended++,
    () => [key, nextKey][f.keys++],
  );
  return f;
}
