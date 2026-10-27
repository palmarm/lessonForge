# Frontend UI documentation

This directory is the home for frontend integration and design documentation.
Keep approved design handoffs, phased integration records, UI verification notes,
and related implementation decisions here.

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
