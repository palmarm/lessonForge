# LessonForge frontend

Next.js with TypeScript and Tailwind CSS. The current page displays the
LessonForge heading at `http://localhost:3000`.

From `frontend/`, run `npm run dev` for development. The page source is
`src/app/page.tsx`; browser metadata is in `src/app/layout.tsx`.

Verification commands:

```bash
npm run lint
npm run typecheck
npm run build
```

`typecheck` generates Next.js route types before running TypeScript.
The existing Google Fonts integration needs network access on an uncached build.

See the [root README](../README.md) for Node.js selection, installation, backend
commands, and project scope. Lesson workflows, authentication, and AI are deferred;
NestJS will own business rules and private integrations. Hosting and CI are deferred.
