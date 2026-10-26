# Frontend UI documentation

This directory is the home for frontend integration and design documentation.
Keep approved design handoffs, phased integration records, UI verification notes,
and related implementation decisions here.

- [Frontend design integration — Phases 1 and 2](frontend-design-integration.md) documents
  the shared design foundation, teacher resource UUID browsing, administrator
  resource management/recovery, verification and remaining manual checks.
  Phase 2 independent review found no commit blockers; Phase 3 remains unimplemented.
- [Phase 2 pre-commit review](phase-2-review.md) records the full unstaged diff
  review, the heading hierarchy finding and its correction, targeted checks, and the
  generated-file typecheck investigation. The standard repository typecheck now
  passes; its earlier failure and the narrower isolated pass are recorded separately.
  The heading correction passed two focused teacher/administrator rendered tests,
  lint and the standard repository TypeScript check.
  User-reported browsing, management, navigation and visual/keyboard checks are
  distinguished from agent-run evidence; Phase 1 and full draft/snapshot checks
  remain pending.
- [Phase 1 pre-commit review](phase-1-review.md) records the independent source
  review, R1 correction follow-up, targeted checks, and evidence boundaries.
  R1 is resolved by independent correction verification; real API/database and
  unperformed manual acceptance checks remain pending.
  By user decision, corrected manual Back/Forward checks are deferred until after
  Phase 3. Phase 1 is not fully manually verified.
