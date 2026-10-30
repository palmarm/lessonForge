# Frontend UI documentation

This directory is the home for frontend integration and design documentation.
Keep approved design handoffs, phased integration records, UI verification notes,
and related implementation decisions here.

- [Guided live lesson-review acceptance](lesson-review-live-acceptance.md) records
  actual service-readiness observations, startup guidance and one-at-a-time manual
  results. Startup/sign-in and test 1 await user confirmation; no live pass is claimed.
- [Lesson submission, history and administrator review](lesson-review.md) maps the
  backend contract to teacher and administrator actions, explains explicit
  recovery and API limitations, and records actual verification separately from
  the pending numbered manual checklist.
- [Independent submission/review review](lesson-review-independent-review.md)
  records the full base/checkpoint/unstaged review, the corrected P2 multi-lesson
  history targeting defect (R1 independently verified and resolved), fresh focused
  checks and source-matched reused evidence. Its 2026-10-30 browser-correction
  review found P2 focus-clearance issue C1; its
  [independent correction verification](lesson-review-independent-review.md#c1-independent-verification--2026-10-30)
  now resolves C1 with source-matched evidence and 24 fresh geometry/lifecycle
  probes. Fresh browser execution was blocked by EPERM. R1 stays resolved;
  live API/database and manual checks remain pending.
- [Submission/review browser verification — 2026-10-30](lesson-review-browser-verification.md)
  records the seven reproduced failures, measured diagnoses and corrections,
  intermediate regressions, and earlier passes: 91 complete rendered cases, 12
  focused cases, 135 request/state cases, lint, standard TypeScript and a matching
  production build. All five workflow widths were exercised. Independent review
  verified that earlier evidence but found C1. The fresh C1 correction passed
  all 99 rendered cases (eight new), 20 targeted cases, 135 request/state tests,
  lint, standard TypeScript and a matching build. Independent verification resolves
  C1 using those source/hash-matched results, not a fresh browser rerun.
  Manual and live API/database acceptance remain pending; earlier blocked/failed
  results are retained as history.
- [Frontend design integration — Phases 1–3](frontend-design-integration.md)
  documents the shared design foundation, teacher resource browsing and
  management, draft editor/recovery presentation, verification evidence, the
  numbered three-phase integration checklist, and remaining manual checks.
  Phase 3 records the recovered 2026-10-23 handoff at
  `/home/mariga/design-work/lessonforge-ui/DESIGN_HANDOFF.md`, comparison and
  presentation corrections, intentional production adaptations, and current
  evidence. The earlier missing-reference report is retained as corrected history.
  Earlier handoff-alignment results are retained as history; the correction
  follow-up records fresh frontend checks and separates them from live acceptance.
  The user reports all eight combined manual checks passed as user-performed
  local acceptance, including the previously deferred Phase 1 navigation checks.
  Database inspection and deployment/security, assistive-technology or
  Firefox/WebKit verification are not inferred; unperformed checks remain pending.
- [Phase 3 independent review](phase-3-review.md) records the full diff review
  against `fe02f64`, five independent temporary browser probes and preserved
  application/test hashes. R1 (P2), stale timing errors after activity removal,
  and D1/D2 (normal editor composition and stale returned-list design gaps) are
  corrected with automated tests and user manual acceptance passed. Independent
  re-verification was skipped by user decision. The integration record documents
  the correction implementation and checks; the original independent findings
  and evidence remain historical. Correction checks passed lint, standard
  TypeScript, 97 request/state tests, 74 rendered cases and the Webpack build;
  deployment/security, assistive-technology and other-browser checks remain pending.
- [Phase 2 pre-commit review](phase-2-review.md) records the full unstaged diff
  review, the heading hierarchy finding and its correction, targeted checks, and the
  generated-file typecheck investigation. The standard repository typecheck now
  passes; its earlier failure and the narrower isolated pass are recorded separately.
  The heading correction passed two focused teacher/administrator rendered tests,
  lint and the standard repository TypeScript check.
  User-reported browsing, management, navigation and visual/keyboard checks are
  distinguished from agent-run evidence. Earlier local-manual deferrals are
  superseded by the user-reported combined acceptance closeout.
- [Phase 1 pre-commit review](phase-1-review.md) records the independent source
  review, R1 correction follow-up, targeted checks, and evidence boundaries.
  Phase 1 R1 is resolved by its earlier independent correction verification.
  The formerly deferred Phase 1 navigation checks are now user-reported passes
  within all eight combined local checks. Unperformed deployment/security,
  assistive-technology and other-browser checks remain pending.
