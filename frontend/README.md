# LessonForge frontend

Next.js with TypeScript and Tailwind CSS. The page at `http://localhost:3000`
provides an accessible teacher/admin login form and displays the signed-in
account's name/role with logout. NestJS owns authentication and authorization.

Copy `.env.example` to ignored `.env.local` if it does not already exist:

```bash
cp -n .env.example .env.local
```

This creates public configuration only: `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001`.
Use an exact HTTP loopback or HTTPS origin, without a path, trailing slash,
credentials, query, or fragment. The value is embedded at build time; restart
development or rebuild after changing it. Keep frontend/API browser hostnames
consistent with the backend's explicit origin configuration.

From `frontend/`, run `npm run dev` for development. The page source is
`src/app/page.tsx`; browser metadata is in `src/app/layout.tsx`.

Verification commands:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`typecheck` generates Next.js route types before running TypeScript.
`npm test` uses Node 24's built-in runner with native TypeScript stripping and
mocked fetch to verify API contracts, safe errors, identity restoration, logout
failure/retry, and stale responses. It requires no extra packages or database.
The existing Google Fonts integration needs network access on an uncached build.

See the [development setup guide](../docs/development-setup.md) for Node.js
selection, installation, and backend commands, and the [root README](../README.md)
for project scope. [Frontend authentication verification](../docs/frontend-authentication-verification.md)
contains exact startup instructions, test results, and the pending manual browser
checklist. Server Components render a public shell; a Client Component restores
identity through `/auth/me`. Passwords are cleared on submission and no
credentials or identity are persisted in browser storage. Role display does not
grant permissions. Requests abort after a shared 15-second deadline covering
headers and complete response reading. Timeouts offer retry/session reconciliation;
login is never automatically retried and uncertain logout preserves identity.
Lesson workflows, AI, and hosting are deferred.
See the [CI guide](../docs/ci.md) for the implemented checks and pending workflow-run
verification.
