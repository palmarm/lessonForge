import { AuthApiError, createCredentialedRequest } from "./api-request.ts";
import type { ResourceContent } from "./resources-api.ts";

export type DraftContent = {
  title?: string;
  subject?: "Mathematics";
  grade?: "Grade 4";
  durationMinutes?: number;
  learningObjectives?: string[];
  materials?: string[];
  introduction?: { text?: string; durationMinutes?: number };
  activities?: {
    teacherTasks?: string;
    learnerTasks?: string;
    durationMinutes?: number;
  }[];
  assessment?: { text?: string; durationMinutes?: number };
  differentiation?: { learnerSupport?: string; extensionActivities?: string };
};
export type LessonSummary = {
  id: string;
  title: string;
  version: number;
  state: "DRAFT" | "CHANGES_REQUESTED";
  createdAt: string;
  updatedAt: string;
};
export type Lesson = LessonSummary & {
  content: DraftContent;
  generationOrigin: "MANUAL" | "AI_ASSISTED";
  sources: {
    resourceId: string;
    resourceVersion: number;
    snapshot: ResourceContent;
  }[];
};
export type LessonPage = { items: LessonSummary[]; nextAfter: string | null };
export type LessonsApi = {
  list: (after?: string, signal?: AbortSignal) => Promise<LessonPage>;
  detail: (id: string, signal?: AbortSignal) => Promise<Lesson>;
  create: (content: DraftContent, signal?: AbortSignal) => Promise<Lesson>;
  save: (
    id: string,
    version: number,
    content: DraftContent,
    signal?: AbortSignal,
  ) => Promise<Lesson>;
  source: (
    id: string,
    version: number,
    resourceId: string,
    action: "select" | "remove" | "refresh",
    signal?: AbortSignal,
  ) => Promise<Lesson>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const integer = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 2147483647;
const string = (v: unknown, max: number) =>
  typeof v === "string" && v.length <= max && !v.includes("\0");
const date = (v: unknown) =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const invalid = () =>
  new AuthApiError(
    "invalid-response",
    "Unexpected lesson response. Load the latest result to reconcile; entered text is retained.",
  );
function id(v: string) {
  if (!uuid.test(v)) throw new AuthApiError("rejected", "Invalid identifier.");
  return v.toLowerCase();
}
function contentShape(v: unknown): v is DraftContent {
  if (!record(v) || new TextEncoder().encode(JSON.stringify(v)).length > 65536)
    return false;
  const timing = (v: unknown) =>
    Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1440;
  const section = (v: unknown, keys: string[]) =>
    record(v) &&
    Object.entries(v).every(
      ([k, x]) =>
        keys.includes(k) &&
        (k === "durationMinutes" ? timing(x) : string(x, 4000)),
    );
  return Object.entries(v).every(([k, x]) => {
    switch (k) {
      case "title":
        return string(x, 200);
      case "subject":
        return x === "Mathematics";
      case "grade":
        return x === "Grade 4";
      case "durationMinutes":
        return timing(x);
      case "learningObjectives":
      case "materials":
        return (
          Array.isArray(x) &&
          x.length <= 30 &&
          x.every((y) => string(y, k === "materials" ? 500 : 1000))
        );
      case "introduction":
      case "assessment":
        return section(x, ["text", "durationMinutes"]);
      case "activities":
        return (
          Array.isArray(x) &&
          x.length <= 30 &&
          x.every((y) =>
            section(y, ["teacherTasks", "learnerTasks", "durationMinutes"]),
          )
        );
      case "differentiation":
        return section(x, ["learnerSupport", "extensionActivities"]);
      default:
        return false;
    }
  });
}
const summaryKeys = [
  "id",
  "title",
  "version",
  "state",
  "createdAt",
  "updatedAt",
];
function validate(v: unknown, detailed: true): Lesson;
function validate(v: unknown, detailed: false): LessonSummary;
function validate(v: unknown, detailed: boolean): LessonSummary | Lesson {
  if (
    !record(v) ||
    !exact(
      v,
      detailed
        ? [...summaryKeys, "content", "sources", "generationOrigin"]
        : summaryKeys,
    ) ||
    typeof v.id !== "string" ||
    !uuid.test(v.id) ||
    !string(v.title, 200) ||
    !integer(v.version) ||
    !["DRAFT", "CHANGES_REQUESTED"].includes(v.state as string) ||
    !date(v.createdAt) ||
    !date(v.updatedAt)
  )
    throw invalid();
  if (detailed) {
    if (
      !contentShape(v.content) ||
      !["MANUAL", "AI_ASSISTED"].includes(v.generationOrigin as string) ||
      !Array.isArray(v.sources) ||
      v.sources.length > 5 ||
      v.title !== (v.content.title ?? "")
    )
      throw invalid();
    const ids = new Set();
    for (const s of v.sources) {
      if (
        !record(s) ||
        !exact(s, ["resourceId", "resourceVersion", "snapshot"]) ||
        typeof s.resourceId !== "string" ||
        !uuid.test(s.resourceId) ||
        ids.has(s.resourceId) ||
        !integer(s.resourceVersion) ||
        !record(s.snapshot) ||
        !exact(s.snapshot, [
          "title",
          "subject",
          "grade",
          "sourceReference",
          "contentText",
        ])
      )
        throw invalid();
      const x = s.snapshot;
      if (
        x.subject !== "Mathematics" ||
        x.grade !== "Grade 4" ||
        !string(x.title, 200) ||
        !(x.title as string).trim() ||
        !string(x.sourceReference, 1000) ||
        !(x.sourceReference as string).trim() ||
        !string(x.contentText, 20000) ||
        !(x.contentText as string).trim()
      )
        throw invalid();
      ids.add(s.resourceId);
    }
  }
  return v as Lesson;
}
export function createLessonsApi(
  base: string | undefined,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15000,
): LessonsApi {
  const request = createCredentialedRequest(base, fetcher, timeoutMs);
  const messages = {
    400: "Check draft structure, types, Grade 4 Mathematics, and text limits. Incomplete drafts are allowed.",
    403: "Teacher access is required. Check your session.",
    404: "Draft or resource is unavailable to this account.",
    409: "The version, lesson state, or resource selection changed. Load the latest result and compare before continuing. Your text is retained.",
    413: "Draft request is too large. Shorten the entered content.",
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
    (status: number, key?: string, version?: number) => async (r: Response) => {
      const result = validate(await json(r, status), true);
      if (
        (key && result.id !== key) ||
        (version !== undefined && result.version !== version)
      )
        throw invalid();
      return result;
    };
  return {
    list: (after, signal) =>
      request(
        `/lessons?limit=20${after ? `&after=${id(after)}` : ""}`,
        undefined,
        async (r) => {
          const v = await json(r, 200);
          if (
            !record(v) ||
            !exact(v, ["items", "nextAfter"]) ||
            !Array.isArray(v.items) ||
            v.items.length > 20 ||
            (v.nextAfter !== null &&
              (typeof v.nextAfter !== "string" || !uuid.test(v.nextAfter)))
          )
            throw invalid();
          const items = v.items.map((x) => validate(x, false));
          if (
            items.some(
              (x, i) => x.id <= (i ? items[i - 1].id : (after ?? "")),
            ) ||
            (v.nextAfter !== null &&
              (items.length !== 20 || v.nextAfter !== items.at(-1)?.id))
          )
            throw invalid();
          return { items, nextAfter: v.nextAfter as string | null };
        },
        signal,
        { messages },
      ),
    detail: (key, signal) =>
      request(`/lessons/${id(key)}`, undefined, detail(200, id(key)), signal, {
        messages,
      }),
    create: (content, signal) =>
      request("/lessons", { content }, detail(201, undefined, 1), signal, {
        messages,
      }),
    save: (key, version, content, signal) =>
      request(
        `/lessons/${id(key)}`,
        { expectedVersion: version, content },
        detail(200, id(key), version + 1),
        signal,
        { method: "PUT", messages },
      ),
    source: (key, version, source, action, signal) =>
      request(
        `/lessons/${id(key)}/resources/${id(source)}/${action}`,
        { expectedVersion: version },
        detail(200, id(key), version + 1),
        signal,
        { messages },
      ),
  };
}
