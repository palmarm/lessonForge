import { AuthApiError, createCredentialedRequest } from "./api-request.ts";
import { contentShape, sourceShape } from "./lessons-api.ts";
import type { DraftContent, Lesson } from "./lessons-api.ts";

export type Workflow = {
  lessonId: string;
  version: number;
  state: "DRAFT" | "SUBMITTED" | "CHANGES_REQUESTED" | "APPROVED";
  currentRevisionId: string | null;
};
export type Decision = "APPROVE" | "REQUEST_CHANGES";
export type Review = {
  id: string;
  reviewerId: string;
  decision: Decision;
  feedback: string | null;
  decidedAt: string;
};
export type RevisionSummary = {
  id: string;
  number: number;
  title: string;
  generationOrigin: "MANUAL" | "AI_ASSISTED";
  submittedAt: string;
  review: Review | null;
};
export type Revision = Omit<RevisionSummary, "title"> & {
  content: DraftContent;
  sources: Lesson["sources"];
};
export type RevisionDetail = { workflow: Workflow; revision: Revision };
export type HistoryPage = {
  workflow: Workflow;
  items: RevisionSummary[];
  nextAfter: string | null;
};
export type QueuePage = {
  items: { workflow: Workflow; revision: RevisionSummary }[];
  nextAfter: string | null;
};
export type ReviewApi = {
  history: (
    lesson: string,
    after?: string,
    signal?: AbortSignal,
  ) => Promise<HistoryPage>;
  detail: (
    lesson: string,
    revision: string,
    signal?: AbortSignal,
  ) => Promise<RevisionDetail>;
  pending: (after?: string, signal?: AbortSignal) => Promise<QueuePage>;
  submit: (
    lesson: string,
    version: number,
    signal?: AbortSignal,
  ) => Promise<RevisionDetail>;
  review: (
    lesson: string,
    revision: string,
    version: number,
    decision: Decision,
    feedback: string,
    signal?: AbortSignal,
  ) => Promise<RevisionDetail>;
};
export const lessonUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((key) => Object.hasOwn(v, key));
const identifier = (v: unknown): v is string =>
  typeof v === "string" && lessonUuid.test(v) && v === v.toLowerCase();
const integer = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) > 0 && (v as number) <= 2147483647;
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length <= max && !v.includes("\0");
const date = (v: unknown) =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const invalid = () =>
  new AuthApiError(
    "invalid-response",
    "Unexpected workflow response. Check the exact result; an invalid write response does not establish failure.",
  );
function id(value: string) {
  if (!lessonUuid.test(value))
    throw new AuthApiError("rejected", "Enter a valid lesson or revision ID.");
  return value.toLowerCase();
}
function workflow(v: unknown, lesson?: string): Workflow {
  if (
    !record(v) ||
    !exact(v, ["lessonId", "version", "state", "currentRevisionId"]) ||
    !identifier(v.lessonId) ||
    (lesson && v.lessonId !== lesson) ||
    !integer(v.version) ||
    !["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED"].includes(
      v.state as string,
    ) ||
    (v.state === "DRAFT"
      ? v.currentRevisionId !== null
      : !identifier(v.currentRevisionId))
  )
    throw invalid();
  return v as Workflow;
}
function review(v: unknown): Review | null {
  if (v === null) return null;
  if (
    !record(v) ||
    !exact(v, ["id", "reviewerId", "decision", "feedback", "decidedAt"]) ||
    !identifier(v.id) ||
    !identifier(v.reviewerId) ||
    !["APPROVE", "REQUEST_CHANGES"].includes(v.decision as string) ||
    !date(v.decidedAt) ||
    (v.feedback !== null && !text(v.feedback, 4000)) ||
    (v.decision === "REQUEST_CHANGES" &&
      (typeof v.feedback !== "string" || !v.feedback.trim()))
  )
    throw invalid();
  return v as Review;
}
function revision(v: unknown, detailed: true): Revision;
function revision(v: unknown, detailed: false): RevisionSummary;
function revision(v: unknown, detailed: boolean): Revision | RevisionSummary {
  const keys = [
    "id",
    "number",
    "generationOrigin",
    "submittedAt",
    "review",
    ...(detailed ? ["content", "sources"] : ["title"]),
  ];
  if (
    !record(v) ||
    !exact(v, keys) ||
    !identifier(v.id) ||
    !integer(v.number) ||
    !["MANUAL", "AI_ASSISTED"].includes(v.generationOrigin as string) ||
    !date(v.submittedAt)
  )
    throw invalid();
  review(v.review);
  if (detailed) {
    if (
      !contentShape(v.content) ||
      !text(v.content.title, 200) ||
      !v.content.title.trim() ||
      !sourceShape(v.sources) ||
      v.sources.length < 1 ||
      v.sources.some((s, i, a) => i > 0 && s.resourceId <= a[i - 1].resourceId)
    )
      throw invalid();
  } else if (!text(v.title, 200) || !v.title.trim()) throw invalid();
  return v as Revision | RevisionSummary;
}
function coherence(w: Workflow, r: Revision | RevisionSummary) {
  if (w.state === "DRAFT") throw invalid();
  if (
    w.currentRevisionId === r.id &&
    ((w.state === "SUBMITTED" && r.review !== null) ||
      (w.state === "APPROVED" && r.review?.decision !== "APPROVE") ||
      (w.state === "CHANGES_REQUESTED" &&
        r.review?.decision !== "REQUEST_CHANGES"))
  )
    throw invalid();
}
function page(
  v: unknown,
  after: string | undefined,
  key: (item: unknown) => string,
) {
  if (
    !record(v) ||
    !Array.isArray(v.items) ||
    v.items.length > 20 ||
    (v.nextAfter !== null && !identifier(v.nextAfter))
  )
    throw invalid();
  const ids = v.items.map(key);
  if (
    ids.some(
      (value, index) => value <= (index ? ids[index - 1] : (after ?? "")),
    ) ||
    (v.nextAfter !== null && (ids.length !== 20 || v.nextAfter !== ids.at(-1)))
  )
    throw invalid();
}
export function createReviewApi(
  base: string | undefined,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15000,
): ReviewApi {
  const request = createCredentialedRequest(base, fetcher, timeoutMs);
  const messages = {
    400: "Check required lesson fields, Grade 4 Mathematics, materials, sources and section timings, or review comments. The backend rejected validation; entered work is retained.",
    403: "This account cannot perform that action. Check your session and role.",
    404: "This lesson or revision is unavailable to this account. Check the exact IDs.",
    409: "The lesson version or state changed, or this revision was already reviewed. Load and compare the exact result before another action.",
    413: "The request is too large. Shorten comments before trying again.",
  };
  async function json(r: Response, status: number): Promise<unknown> {
    if (
      r.status !== status ||
      r.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
        "application/json"
    )
      throw invalid();
    try {
      return await r.json();
    } catch {
      throw invalid();
    }
  }
  const detail =
    (
      status: number,
      lesson: string,
      target?: string,
      version?: number,
      decision?: Decision,
    ) =>
    async (r: Response): Promise<RevisionDetail> => {
      const v = await json(r, status);
      if (!record(v) || !exact(v, ["workflow", "revision"])) throw invalid();
      const w = workflow(v.workflow, lesson),
        rev = revision(v.revision, true);
      coherence(w, rev);
      if (
        (target && rev.id !== target) ||
        (version !== undefined &&
          (w.version !== version + 1 || w.currentRevisionId !== rev.id)) ||
        (status === 201 &&
          !decision &&
          (w.state !== "SUBMITTED" || rev.review !== null)) ||
        (decision &&
          (rev.review?.decision !== decision ||
            w.state !==
              (decision === "APPROVE" ? "APPROVED" : "CHANGES_REQUESTED")))
      )
        throw invalid();
      return { workflow: w, revision: rev };
    };
  return {
    history: (lesson, after, signal) =>
      request(
        `/lessons/${id(lesson)}/revisions?limit=20${after ? `&after=${id(after)}` : ""}`,
        undefined,
        async (r) => {
          const v = await json(r, 200);
          if (!record(v) || !exact(v, ["workflow", "items", "nextAfter"]))
            throw invalid();
          const w = workflow(v.workflow, id(lesson));
          page(
            v,
            after ? id(after) : undefined,
            (item) => revision(item, false).id,
          );
          const items = (v.items as unknown[]).map((item) =>
            revision(item, false),
          );
          for (const item of items) coherence(w, item);
          if (w.state === "DRAFT" && items.length) throw invalid();
          return {
            workflow: w,
            items,
            nextAfter: v.nextAfter as string | null,
          };
        },
        signal,
        { messages },
      ),
    detail: (lesson, target, signal) =>
      request(
        `/lessons/${id(lesson)}/revisions/${id(target)}`,
        undefined,
        detail(200, id(lesson), id(target)),
        signal,
        { messages },
      ),
    pending: (after, signal) =>
      request(
        `/reviews/pending?limit=20${after ? `&after=${id(after)}` : ""}`,
        undefined,
        async (r) => {
          const v = await json(r, 200);
          if (!record(v) || !exact(v, ["items", "nextAfter"])) throw invalid();
          const item = (value: unknown) => {
            if (!record(value) || !exact(value, ["workflow", "revision"]))
              throw invalid();
            const w = workflow(value.workflow),
              rev = revision(value.revision, false);
            if (
              w.state !== "SUBMITTED" ||
              w.currentRevisionId !== rev.id ||
              rev.review !== null
            )
              throw invalid();
            return { workflow: w, revision: rev };
          };
          page(
            v,
            after ? id(after) : undefined,
            (value) => item(value).workflow.lessonId,
          );
          return {
            items: (v.items as unknown[]).map(item),
            nextAfter: v.nextAfter as string | null,
          };
        },
        signal,
        { messages },
      ),
    submit: (lesson, version, signal) =>
      request(
        `/lessons/${id(lesson)}/submit`,
        { expectedVersion: version },
        detail(201, id(lesson), undefined, version),
        signal,
        { messages },
      ),
    review: (lesson, target, version, decision, feedback, signal) =>
      request(
        `/lessons/${id(lesson)}/revisions/${id(target)}/review`,
        { expectedVersion: version, decision, feedback },
        detail(201, id(lesson), id(target), version, decision),
        signal,
        { messages },
      ),
  };
}
