# Lesson submission, history and administrator review

## Contract map before implementation

Preparation: `feat/frontend-lesson-review`, clean working tree and empty index.
No branch operations or cleanup. Authority: [workflow API](../lesson-review.md),
[draft contracts](../teacher-drafts.md) and the existing authenticated persistent
workspaces/navigation guard. Backend code and schemas stay unchanged.

| Screen/action | Contract and permission | Frontend behavior |
|---|---|---|
| My drafts: prepare submission | Owned TEACHER editable DRAFT/CHANGES_REQUESTED; existing saved draft detail plus `GET /lessons/:id/revisions` and, when present, exact current revision detail | Require saved/clean/reconciled work. Retain saved content, origin, snapshots, expected lesson version and baseline revision number. Preparation reads never save or adopt versions. |
| Confirm submission | `POST /lessons/:id/submit`, exactly `{ expectedVersion }`, 201 | Explain saved-only content, immutable snapshot and locked editing until requested changes. One accepted click, no retries. Show authoritative result; a new revision needs review. |
| Teacher history `/history`, `/history/:lessonId` | Owner-only history/detail reads; no all-submitted-lessons list exists | Open a known lesson ID, page UUID-ascending history, explicitly select a revision. Display exact immutable content, source snapshots and review. Keep revision number separate from UUID pagination order. |
| Pending review `/admin/reviews` | ADMIN `GET /reviews/pending?limit=20&after=...` | Only supported pending queue and cursor pagination; no invented filters, search, ownership fields or ordering. Read exact detail before deciding. |
| Administrator revision detail | `GET /lessons/:id/revisions/:revisionId` | Show immutable content, origin, IDs/number, timestamps, full retained sources, review and current workflow metadata. No editable teacher draft. |
| Approve / request changes | ADMIN exact revision route; `{ expectedVersion, decision, feedback }`, 201 | Only current SUBMITTED/unreviewed revision is actionable. Required nonblank feedback for REQUEST_CHANGES, optional on approval; 4,000 raw UTF-16 units, NUL rejected. Confirmation names exact lesson/revision/version and consequence. Retain comments on recoverable failures. |
| Changes requested | Existing teacher draft APIs become editable | Explicitly return to My drafts and open/reconcile the server draft. Never adopt a workflow version into the editor automatically. No withdrawal, reopening approval, decision editing, library/copy, AI or notifications. |

All calls reuse credentialed no-store/CSRF transport and deadlines. Runtime response
validation checks exact envelopes, identities, revision targets, states, versions,
ordered pages and snapshots. History/queue pages use server cursors, not time order
or locally inferred next pages. Historical data never fetches current resources.

## Recovery and boundaries

Submission preparation holds a separate workflow lock on draft operations; dirty
content, draft uncertainty, pending saves/sources and conflicts cannot submit.
Confirmation and reads do not modify the draft's base version or saved selections.
Draft dirty state and workflow pending/uncertain state remain separate.

Lost submission responses retain the confirmed candidate and baseline number.
Explicit reconciliation starts history at page one, follows server cursors and
loads baseline number + 1 exactly. Compare immutable content/origin and sources
keyed by resource ID. A later review or resubmission changes current workflow
metadata but cannot replace that historical outcome. Matching history requires
explicit acknowledgement before leaving recovery. Missing/different results or
failed reads cannot establish failure and cannot unlock another submission.

Lost review responses reconcile only the originally targeted revision. Show its
winning decision/reviewer and distinguish a matching decision from a competing
decision; explicit acknowledgement is required. No review means the outcome is
still uncertain. Reads alone never retry a write, adopt a version or unlock it.
After a definite 409, fresh comparison and explicit acceptance are required before
another decision; comments remain associated with their target. Errors use safe
messages; only confirmed 401 ends the session.

API gaps: no teacher endpoint lists every previously submitted lesson; use known-ID
history URLs, including after reload. There is no operation-status/idempotency
endpoint: an absent candidate/review cannot prove an in-flight request failed.
Do not fabricate a safe no-match outcome or add a backend route. Backend 400 errors
contain no field-specific diagnostics; show contract guidance beside fields and
an actionable submission summary, never invented server field errors. NestJS
remains authoritative for completeness, timing sums, permissions and transitions.

Temporary auth uncertainty pauses controls, invalidates/aborts old reads and makes
interrupted writes uncertain while retaining work. Confirmed identity/role/session
replacement disposes all workspace state. Persistent stores and existing navigation
protection retain pending/uncertain recovery and protect unsaved comments/text.

## Verification and manual checklist

Implementation results and a numbered manual checklist will be recorded here.
Mocked request/state and intercepted Chromium evidence must remain separate from
live NestJS/database, manual assistive-technology and deployment evidence.
