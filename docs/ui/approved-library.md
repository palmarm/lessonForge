# Approved library frontend handoff

Backend authority: [approved-library contracts](../approved-library.md). This is an
integration handoff only; no frontend implementation is included in this increment.
Keep permission, eligibility, snapshot and idempotency rules in NestJS.

| Action | Backend contract | Required client handling |
|---|---|---|
| Browse | TEACHER/ADMIN `GET /library/approved?limit=20&after=...` | UUID-ordered cursor pages, not chronological approval order. No search/filter API is implied. |
| Read | `GET /library/approved/:lessonId/revisions/:revisionId` | Render exact approved content, generation origin and retained citations/snapshots as text. Do not load another teacher's history or mutable draft. |
| Intentional copy | TEACHER `POST /lessons/:lessonId/revisions/:revisionId/copy` with `{ operationKey, expectedVersion }` | Generate one lowercase UUIDv4 per intentional action. Retain key, source IDs and source workflow version before sending. Administrator has browse controls only. |
| Created/replayed | 201 first creation; 200 matching replay; both `{ operation }` | Validate receipt matches key and original normalized source/preconditions. Record its destinationLessonId. Receipt contains no draft/state and never promises current editability. |
| Recover uncertain result | TEACHER `GET /library/copy-operations/:operationKey` | Exact actor-scoped receipt. No candidate list or title/content matching. A 404 can precede an in-flight commit. |
| Retry same operation | Repeat original copy POST with same key/parameters | Safe against duplicate destinations, including after timeout/abort/invalid success or 503. Never replace key or update expectedVersion during automatic recovery. A new key is another intentional copy. |
| Open destination | Owned `GET /lessons/:id/revisions`, then draft or revision detail | History gives current workflow, including empty history for a new draft. Load editable detail for DRAFT/CHANGES_REQUESTED; submitted/approved content through history/detail. Reconcile state races. |
| Key mismatch/stale source | Sanitized 409 | Preserve operation identity; inspect/recover deliberately. Do not silently rebase the operation onto another source revision/version. |

The receipt is exactly:

```text
{ operation: {
    key,
    source: { lessonId, revisionId, expectedVersion },
    destinationLessonId
} }
```

Generate keys with `crypto.randomUUID()`. Canonical lowercase version 4 and an RFC
variant nibble 8/9/a/b are required. Owner IDs and current draft content are absent
from the receipt. Shared library responses also omit author identities, reviewer
identities and review feedback; existing owner/admin history permissions remain.

Retain an uncertain operation across supported recovery paths **before** issuing
its POST. Losing the key loses exact operation lookup; do not compensate by
automatically generating another copy. This handoff does not add browser storage;
the frontend implementation must explicitly choose how long recovery survives
reload/navigation and make that limitation clear. Account changes must isolate
pending keys/results with the existing authenticated workspace handling. Pause on
unconfirmed authentication and ignore stale responses after identity changes.
Every replay/recovery requires fresh valid authentication and teacher authorization.

Do not replace local unsaved destination edits with source content after recovery.
A copy can already be edited, submitted or approved when recovered. Fetch current
authorized state, explicitly reconcile conflicts and retain the original provenance.
Copying preserves AI_ASSISTED origin where present but never transfers approval.
Older/retired source snapshots remain readable/submittable and are not refreshed.

Pending frontend verification: actual browse/read/copy/recovery UI, retained-key
lifetime, lost-response and account-switch behavior, current destination reads,
rendered interactions/accessibility, browser/HTTPS checks and live manual acceptance.
Backend evidence is separately recorded in the API guide; it is not browser evidence.
