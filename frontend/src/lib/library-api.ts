import { AuthApiError, createCredentialedRequest } from "./api-request.ts";
import { contentShape, sourceShape } from "./lessons-api.ts";
import type {
  Revision,
  RevisionSummary,
  Workflow,
} from "./lesson-review-api.ts";

export type LibrarySummary = {
  workflow: Workflow & { state: "APPROVED"; currentRevisionId: string };
  revision: Omit<RevisionSummary, "review">;
  approvedAt: string;
};
export type LibraryDetail = Omit<LibrarySummary, "revision"> & {
  revision: Omit<Revision, "review">;
};
export type CopyIntent = {
  key: string;
  source: { lessonId: string; revisionId: string; expectedVersion: number };
};
export type CopyReceipt = CopyIntent & { destinationLessonId: string };
export type LibraryPage = { items: LibrarySummary[]; nextAfter: string | null };
export type LibraryApi = {
  browse: (after?: string, signal?: AbortSignal) => Promise<LibraryPage>;
  detail: (
    lesson: string,
    revision: string,
    signal?: AbortSignal,
  ) => Promise<LibraryDetail>;
  copy: (intent: CopyIntent, signal?: AbortSignal) => Promise<CopyReceipt>;
  lookup: (
    intent: CopyIntent,
    signal?: AbortSignal,
  ) => Promise<CopyReceipt | null>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const copyKey =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const identifier = (v: unknown): v is string =>
  typeof v === "string" && uuid.test(v);
const integer = (v: unknown) =>
  Number.isInteger(v) && (v as number) > 0 && (v as number) <= 2147483647;
const date = (v: unknown) =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const invalid = () =>
  new AuthApiError(
    "invalid-response",
    "Unexpected library response. A copy may have completed; check its status or retry the same copy with its retained key.",
  );
function id(v: string) {
  const normalized = v.toLowerCase();
  if (!uuid.test(normalized))
    throw new AuthApiError("rejected", "Invalid library identifier.");
  return normalized;
}
function entry(v: unknown, detailed: boolean): LibrarySummary | LibraryDetail {
  if (
    !record(v) ||
    !exact(v, ["workflow", "revision", "approvedAt"]) ||
    !date(v.approvedAt)
  )
    throw invalid();
  const w = v.workflow,
    r = v.revision;
  if (
    !record(w) ||
    !exact(w, ["lessonId", "version", "state", "currentRevisionId"]) ||
    !identifier(w.lessonId) ||
    !integer(w.version) ||
    w.state !== "APPROVED" ||
    !identifier(w.currentRevisionId) ||
    !record(r) ||
    !exact(r, [
      "id",
      "number",
      "generationOrigin",
      "submittedAt",
      ...(detailed ? ["content", "sources"] : ["title"]),
    ]) ||
    !identifier(r.id) ||
    r.id !== w.currentRevisionId ||
    !integer(r.number) ||
    !["MANUAL", "AI_ASSISTED"].includes(r.generationOrigin as string) ||
    !date(r.submittedAt)
  )
    throw invalid();
  if (detailed) {
    if (
      !contentShape(r.content) ||
      !r.content.title?.trim() ||
      !sourceShape(r.sources) ||
      !r.sources.length ||
      r.sources.some(
        (s, i, a) =>
          !identifier(s.resourceId) ||
          (i > 0 && s.resourceId <= a[i - 1].resourceId),
      )
    )
      throw invalid();
  } else if (
    typeof r.title !== "string" ||
    !r.title.trim() ||
    r.title.length > 200 ||
    r.title.includes("\0")
  )
    throw invalid();
  return v as LibrarySummary | LibraryDetail;
}
export function validateCopyReceipt(
  v: unknown,
  intent: CopyIntent,
): CopyReceipt {
  if (!record(v) || !exact(v, ["operation"]) || !record(v.operation))
    throw invalid();
  const o = v.operation,
    s = o.source;
  if (
    !exact(o, ["key", "source", "destinationLessonId"]) ||
    o.key !== intent.key ||
    !copyKey.test(o.key as string) ||
    !identifier(o.destinationLessonId) ||
    o.destinationLessonId === intent.source.lessonId ||
    !record(s) ||
    !exact(s, ["lessonId", "revisionId", "expectedVersion"]) ||
    s.lessonId !== intent.source.lessonId ||
    s.revisionId !== intent.source.revisionId ||
    s.expectedVersion !== intent.source.expectedVersion
  )
    throw invalid();
  return o as CopyReceipt;
}
export function createLibraryApi(
  base: string | undefined,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15000,
): LibraryApi {
  const request = createCredentialedRequest(base, fetcher, timeoutMs);
  const messages = {
    400: "The library request was rejected. Keep the original copy key and parameters.",
    403: "This account cannot perform this library action. Check your session and role.",
    404: "This exact approved revision is unavailable to this account.",
    409: "Copy conflict. The original key and source version are retained. Check copy status; this conflict does not authorize a new version or key.",
  };
  async function json(r: Response, statuses: number[]): Promise<unknown> {
    if (
      !statuses.includes(r.status) ||
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
  function retained(intent: CopyIntent) {
    if (
      !copyKey.test(intent.key) ||
      !identifier(intent.source.lessonId) ||
      !identifier(intent.source.revisionId) ||
      !integer(intent.source.expectedVersion)
    )
      throw invalid();
  }
  return {
    browse: (after, signal) =>
      request(
        `/library/approved?limit=20${after ? `&after=${id(after)}` : ""}`,
        undefined,
        async (r) => {
          const v = await json(r, [200]);
          if (
            !record(v) ||
            !exact(v, ["items", "nextAfter"]) ||
            !Array.isArray(v.items) ||
            v.items.length > 20 ||
            (v.nextAfter !== null && !identifier(v.nextAfter))
          )
            throw invalid();
          const items = v.items.map(
            (item) => entry(item, false) as LibrarySummary,
          );
          if (
            items.some(
              (item, i) =>
                item.workflow.lessonId <=
                (i ? items[i - 1].workflow.lessonId : after ? id(after) : ""),
            ) ||
            (v.nextAfter !== null &&
              (items.length !== 20 ||
                v.nextAfter !== items.at(-1)?.workflow.lessonId))
          )
            throw invalid();
          return { items, nextAfter: v.nextAfter as string | null };
        },
        signal,
        { messages },
      ),
    detail: (lesson, revision, signal) =>
      request(
        `/library/approved/${id(lesson)}/revisions/${id(revision)}`,
        undefined,
        async (r) => {
          const detail = entry(await json(r, [200]), true) as LibraryDetail;
          if (
            detail.workflow.lessonId !== id(lesson) ||
            detail.revision.id !== id(revision)
          )
            throw invalid();
          return detail;
        },
        signal,
        { messages },
      ),
    copy: (intent, signal) => {
      retained(intent);
      return request(
        `/lessons/${intent.source.lessonId}/revisions/${intent.source.revisionId}/copy`,
        {
          operationKey: intent.key,
          expectedVersion: intent.source.expectedVersion,
        },
        async (r) => validateCopyReceipt(await json(r, [200, 201]), intent),
        signal,
        { messages },
      );
    },
    lookup: async (intent, signal) => {
      retained(intent);
      // Do not parse a 404 body or interpret it as proof that a write failed.
      return request(
        `/library/copy-operations/${intent.key}`,
        undefined,
        async (r) =>
          r.status === 404
            ? null
            : validateCopyReceipt(await json(r, [200]), intent),
        signal,
        { messages, allowNotFound: true },
      );
    },
  };
}
