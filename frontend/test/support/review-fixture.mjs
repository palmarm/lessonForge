import { createLessonsState } from "../../src/lib/lessons-state.ts";
import { createReviewState } from "../../src/lib/lesson-review-state.ts";

export const lessonId = "11111111-1111-4111-8111-111111111111";
export const revisionId = "22222222-2222-4222-8222-222222222222";
export const resourceId = "33333333-3333-4333-8333-333333333333";
export const actorId = "44444444-4444-4444-8444-444444444444";
export const otherId = "55555555-5555-4555-8555-555555555555";
export const stamp = "2026-10-28T00:00:00.000Z";
export const content = {
  title: "Fractions lesson", subject: "Mathematics", grade: "Grade 4", durationMinutes: 3,
  learningObjectives: ["Recognize halves"], materials: [],
  introduction: { text: "Share equally.", durationMinutes: 1 },
  activities: [{ teacherTasks: "Model halves.", learnerTasks: "Fold paper.", durationMinutes: 1 }],
  assessment: { text: "Identify one half.", durationMinutes: 1 },
  differentiation: { learnerSupport: "Use a model.", extensionActivities: "Find quarters." },
};
export const source = { resourceId, resourceVersion: 1, snapshot: { title: "Original fractions source", subject: "Mathematics", grade: "Grade 4", sourceReference: "Original sample citation", contentText: "Historical equal parts text." } };
export const saved = { id: lessonId, title: content.title, version: 4, state: "DRAFT", createdAt: stamp, updatedAt: stamp, content, generationOrigin: "MANUAL", sources: [source] };
export const submitted = { workflow: { lessonId, version: 5, state: "SUBMITTED", currentRevisionId: revisionId }, revision: { id: revisionId, number: 1, content, generationOrigin: "MANUAL", submittedAt: stamp, sources: [source], review: null } };
export const review = { id: otherId, reviewerId: actorId, decision: "APPROVE", feedback: null, decidedAt: stamp };
export const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
export function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export function fixture(role = "TEACHER") {
  const f = { saved: structuredClone(saved), current: { lessonId, version: 4, state: "DRAFT", currentRevisionId: null }, revisions: [], calls: [], ended: 0 };
  const draftApi = {
    list: async () => ({ items: [], nextAfter: null }),
    detail: async () => structuredClone(f.saved),
    create: async (value) => ({ ...f.saved, content: value }),
    save: async (id, version, value) => { f.calls.push(["save", id, version]); f.saved = { ...f.saved, version: version + 1, content: structuredClone(value), title: value.title ?? "" }; f.current.version = version + 1; return structuredClone(f.saved); },
    source: async () => { f.calls.push(["source"]); return structuredClone(f.saved); },
  };
  const api = {
    history: async (id, after) => { f.calls.push(["history", id, after]); return { workflow: structuredClone(f.current), items: f.revisions.filter((r) => !after || r.id > after).map(({ content, sources, ...r }) => { void sources; return { ...structuredClone(r), title: content.title }; }).sort((a, b) => a.id.localeCompare(b.id)), nextAfter: null }; },
    detail: async (id, revision) => { f.calls.push(["detail", id, revision]); return { workflow: structuredClone(f.current), revision: structuredClone(f.revisions.find((r) => r.id === revision) ?? submitted.revision) }; },
    pending: async () => ({ items: [], nextAfter: null }),
    submit: async (id, version) => { f.calls.push(["submit", id, version]); const result = structuredClone(submitted); result.workflow.version = version + 1; result.revision.content = structuredClone(f.saved.content); result.revision.sources = structuredClone(f.saved.sources); f.current = result.workflow; f.revisions.push(result.revision); return structuredClone(result); },
    review: async (id, revision, version, decision, feedback) => { f.calls.push(["review", id, revision, version, decision, feedback]); const result = { workflow: { lessonId: id, version: version + 1, state: decision === "APPROVE" ? "APPROVED" : "CHANGES_REQUESTED", currentRevisionId: revision }, revision: { ...structuredClone(submitted.revision), review: { ...review, decision, feedback: feedback.trim() || null } } }; f.current = result.workflow; f.revisions = [result.revision]; return structuredClone(result); },
  };
  f.api = api;
  f.drafts = createLessonsState(draftApi);
  f.store = createReviewState(api, { id: actorId, role }, () => { f.ended++; }, role === "TEACHER" ? f.drafts : undefined);
  return f;
}
