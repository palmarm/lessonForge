# LessonForge backend

NestJS with TypeScript and ESM. The current `GET /` endpoint returns
`LessonForge API` at `http://localhost:3001`.

From `backend/`, run `npm run start:dev` for development. The startup source is
`src/main.ts`; the starter endpoint uses `src/app.controller.ts` and
`src/app.service.ts`.

The optional shell `PORT` override must be a decimal integer from 1 to 65535:

```bash
PORT=3002 npm run start:dev
```

`PORT` defaults to 3001. `.env.example` documents it; environment files are not
loaded automatically.

Verification commands:

```bash
npm run lint
./node_modules/.bin/tsc --noEmit
npm run build
npm test
npm run test:e2e
```

End-to-end tests require permission to bind a local port.

See the [root README](../README.md) for Node.js selection, installation, frontend
commands, and project scope. PostgreSQL, Prisma, authentication, lesson workflows,
AI, deployment, and CI are deferred.
