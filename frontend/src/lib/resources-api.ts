import { AuthApiError, createCredentialedRequest } from "./api-request.ts";

export type ResourceContent = {
  title: string;
  subject: "Mathematics";
  grade: "Grade 4";
  sourceReference: string;
  contentText: string;
};
export type ResourceSummary = {
  id: string;
  title: string;
  subject: "Mathematics";
  grade: "Grade 4";
  retiredAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type Resource = ResourceSummary & ResourceContent;
export type ResourcePage = {
  items: ResourceSummary[];
  nextAfter: string | null;
};
export type ResourcesApi = {
  list: (after?: string, signal?: AbortSignal) => Promise<ResourcePage>;
  detail: (id: string, signal?: AbortSignal) => Promise<Resource>;
  create: (content: ResourceContent, signal?: AbortSignal) => Promise<Resource>;
  edit: (
    id: string,
    version: number,
    content: ResourceContent,
    signal?: AbortSignal,
  ) => Promise<Resource>;
  retire: (
    id: string,
    version: number,
    signal?: AbortSignal,
  ) => Promise<Resource>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const summaryKeys = [
  "id",
  "title",
  "subject",
  "grade",
  "retiredAt",
  "version",
  "createdAt",
  "updatedAt",
];
const invalid = () =>
  new AuthApiError(
    "invalid-response",
    "Unexpected resource response. Reload resources to reconcile before trying again.",
  );
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const date = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max && !v.includes("\0");
function id(value: string) {
  if (!uuid.test(value))
    throw new AuthApiError("rejected", "Invalid resource identifier.");
  return value.toLowerCase();
}
function validate(value: unknown, detail: true): Resource;
function validate(value: unknown, detail: false): ResourceSummary;
function validate(value: unknown, detail: boolean): ResourceSummary | Resource {
  if (
    !record(value) ||
    !exact(
      value,
      detail ? [...summaryKeys, "sourceReference", "contentText"] : summaryKeys,
    ) ||
    typeof value.id !== "string" ||
    !uuid.test(value.id) ||
    !text(value.title, 200) ||
    value.subject !== "Mathematics" ||
    value.grade !== "Grade 4" ||
    !Number.isInteger(value.version) ||
    (value.version as number) < 1 ||
    (value.version as number) > 2147483647 ||
    !date(value.createdAt) ||
    !date(value.updatedAt) ||
    (value.retiredAt !== null && !date(value.retiredAt)) ||
    (detail &&
      (!text(value.sourceReference, 1000) || !text(value.contentText, 20000)))
  )
    throw invalid();
  return value as Resource;
}
export function createResourcesApi(
  base: string | undefined,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15000,
): ResourcesApi {
  const request = createCredentialedRequest(base, fetcher, timeoutMs);
  const messages = {
    400: "Check required fields, Grade 4 Mathematics, and the displayed text limits.",
    404: "Resource is unavailable or no longer visible. Reload the list.",
    409: "Resource changed or is retired. Load the latest record before deciding how to proceed. Your entered text is retained.",
    413: "Resource request is too large. Shorten the text within the displayed limits.",
  };
  async function json(response: Response, status: number): Promise<unknown> {
    if (
      response.status !== status ||
      response.headers
        .get("Content-Type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      throw invalid();
    try {
      return await response.json();
    } catch {
      throw invalid();
    }
  }
  const content = (v: ResourceContent): ResourceContent => ({
    title: v.title,
    subject: v.subject,
    grade: v.grade,
    sourceReference: v.sourceReference,
    contentText: v.contentText,
  });
  const detail =
    (status: number, expectedId?: string) => async (r: Response) => {
      const result = validate(await json(r, status), true);
      if (expectedId && result.id !== expectedId) throw invalid();
      return result;
    };
  return {
    list: (after, signal) =>
      request(
        `/resources?limit=20${after ? `&after=${id(after)}` : ""}`,
        undefined,
        async (r) => {
          const page = await json(r, 200);
          if (
            !record(page) ||
            !exact(page, ["items", "nextAfter"]) ||
            !Array.isArray(page.items) ||
            page.items.length > 20 ||
            (page.nextAfter !== null &&
              (typeof page.nextAfter !== "string" ||
                !uuid.test(page.nextAfter)))
          )
            throw invalid();
          const items = page.items.map((v) => validate(v, false));
          if (
            items.some(
              (v, i) => v.id <= (i ? items[i - 1].id : (after ?? "")),
            ) ||
            (page.nextAfter !== null &&
              (items.length !== 20 || page.nextAfter !== items.at(-1)?.id))
          )
            throw invalid();
          return { items, nextAfter: page.nextAfter as string | null };
        },
        signal,
        { messages },
      ),
    detail: (key, signal) => {
      const keyId = id(key);
      return request(
        `/resources/${keyId}`,
        undefined,
        detail(200, keyId),
        signal,
        { messages },
      );
    },
    create: (value, signal) =>
      request("/resources", content(value), detail(201), signal, { messages }),
    edit: (key, version, value, signal) => {
      const keyId = id(key);
      return request(
        `/resources/${keyId}`,
        { ...content(value), expectedVersion: version },
        detail(200, keyId),
        signal,
        { method: "PUT", messages },
      );
    },
    retire: (key, version, signal) => {
      const keyId = id(key);
      return request(
        `/resources/${keyId}/retire`,
        { expectedVersion: version },
        detail(200, keyId),
        signal,
        { messages },
      );
    },
  };
}
