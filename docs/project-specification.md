# LessonForge Project Specification

## 1. Purpose

LessonForge helps teachers create, revise, and submit lesson plans for administrator review.
It is a portfolio and learning project covering full-stack TypeScript,
AI integration, database design, testing, and deployment.

## 2. MVP boundaries

- One fictional school.
- Grade 4 Mathematics.
- A small set of original sample resources about fractions, clearly labeled as
  demonstration material without claiming official curriculum alignment.
- Teacher and administrator accounts created through a setup script.
- No public registration or account-management screens.

The subject, grade, and resource topic are confirmed. Exact resource text can be
prepared during seeding.

## 3. Users and permissions

### Teacher

- Browse curriculum resources.
- Create lessons manually or generate drafts using AI.
- Edit and save their own editable drafts.
- Explicitly refresh a selected resource in their own editable draft to its latest
  active version; NestJS captures the replacement snapshot.
- Submit their own lessons for review.
- Read feedback and create a revision when changes are requested.
- Browse approved lessons and copy one into a new draft.
- Cannot edit another teacher's lesson or approve lessons.

### Administrator

- Create, update, and retire curriculum resources.
- Read submitted lesson revisions.
- Approve submissions or request changes with feedback.
- Browse approved lessons.
- Cannot silently alter submitted or approved lesson content.

Permissions must be enforced by the backend, even when a request bypasses the user interface.

## 4. Main workflow

1. A teacher creates a draft.
2. The teacher writes manually or requests AI generation.
3. The teacher edits and saves the draft.
4. The teacher submits a revision for review.
5. An administrator approves it or requests changes.
6. Approval makes the reviewed revision available in the lesson library.
7. Requested changes allow the teacher to prepare a new revision.
8. An approved lesson can be copied into a separate draft.

Publication means availability in the application's approved lesson library.

## 5. Revision and review rules

- Saving an editable draft does not require a new historical revision for every keystroke.
- Submission preserves an immutable snapshot of the lesson content.
- Submitted content is locked while awaiting review.
- Each review identifies the exact submitted revision.
- A request for changes requires feedback.
- Resubmission preserves the earlier submission and review.
- Approved revisions remain unchanged.
- Copying an approved lesson creates a new lesson owned by the teacher making the copy and records the original lesson reference.
- Conflicting edits or review decisions must not silently overwrite each other.
- Authorization must succeed before a version-conflict response returns current
  lesson content; return only content the caller is permitted to read.
- Retiring or updating a resource must not erase the source information retained with a submitted lesson.
- Retired resources cannot be newly selected. Existing draft selections and copies
  of approved lessons retain their trusted selection-time snapshots and remain
  submittable, including when resources have since changed or been retired.
- Ordinary saves never refresh source snapshots. An explicit teacher refresh uses
  the latest active resource version captured by NestJS; a retired resource cannot
  be refreshed. Submitted snapshots remain immutable.

## 6. Lesson structure

A submitted lesson must contain:

- Title.
- Subject and grade matching Mathematics and Grade 4.
- Duration in whole minutes.
- Learning objectives.
- Materials: a required array of nonblank entries; an empty array is valid and
  means “No additional materials required.”
- Introduction.
- Activities describing teacher and learner tasks.
- Assessment.
- Differentiation: learner support and extension activities.
- Source references identifying the selected curriculum resource.

Drafts may be incomplete while being saved.

Before submission, the backend checks required fields, a positive whole-number
total lesson duration, and valid section timings. Introduction, each activity,
and assessment require positive whole-number durations of at least one minute.
Their sum must equal the total lesson duration.

## 7. AI drafting

The teacher selects a resource and supplies a topic and duration.

The backend:

- Sends the selected material and requirements to the AI provider.
- Requests structured lesson content.
- Validates the result before accepting it as a draft.
- Records AI origin and the selected source information.
- Keeps API credentials on the server.
- Allows teacher editing before submission.

AI must never approve or publish a lesson.

Generation must not silently overwrite saved work.
If generation fails or returns invalid content, the teacher can retry or continue manually while retaining the existing draft.

Source references help reviewers inspect the result.
They do not guarantee factual accuracy.

## 8. Main data entities

- Users: identity, authentication details, and role.
- Curriculum resources: context, source information, and resource text.
- Lessons: owner, workflow status, and current revision reference.
- Lesson revisions: content, revision number, source information, and generation origin.
- Reviews: reviewer, decision, feedback, and submitted revision reference.

The proposed fields, relationships, and constraints are documented in
[the domain schema design](domain-schema.md). Product decisions are confirmed;
Prisma models and initial migration SQL are implemented; development-database
application and the workflow services remain pending. See
[domain verification](domain-schema-verification.md) for the storage checks.

## 9. Acceptance criteria

The MVP is complete when:

1. A teacher can sign in and create, edit, and save a manual draft.
2. Backend checks prevent unauthorized lesson edits and approvals.
3. Incomplete drafts can be saved, but invalid lessons cannot be submitted.
4. Submission preserves content that cannot be edited during review.
5. An administrator can approve or request changes with feedback.
6. A teacher can revise and resubmit while retaining earlier history.
7. Approved lessons appear in the library and can be copied into new drafts.
8. AI generates validated, editable drafts from selected material.
9. AI failures preserve saved work and allow manual continuation.
10. Conflicting requests do not silently overwrite content or decisions.
11. The main workflow works in a deployed application.
12. The repository includes setup instructions, automated checks, and a short demonstration.

## 10. Deferred features

- Semantic search and retrieval-augmented generation.
- Document uploads.
- Student accounts.
- Multiple schools.
- Public registration and account-management screens.
- PDF export.

## 11. Delivery approach

Build the manual workflow before AI integration.

Each milestone should produce a working demonstration and
a Git contribution that the developer can explain independently.
