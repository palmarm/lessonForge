# Match the repository's .nvmrc. All stages use the same Debian/glibc base.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY nest-cli.json tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY src ./src
# Installation may download packages/Prisma tooling; generation and compilation
# must work without a database, credentials, or network access.
RUN --network=none npm run build

# Deriving this stage from build keeps installation/build/pruning sequential.
FROM build AS production-dependencies
# Prisma CLI is also an optional peer of @prisma/client. Omitting dev alone
# retains it and its tooling subtree; the Node API needs neither optional peers
# nor pg's Cloudflare-only optional adapter. Argon2 ships its addon in-package.
RUN npm prune --omit=dev --omit=optional

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3001
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
USER node
# Check the final filesystem and native/WASM dependencies without connecting to
# a database. The random password and hash exist only in this process's memory.
RUN --network=none node --input-type=module -e '\
    import { randomBytes } from "node:crypto"; \
    import { existsSync } from "node:fs"; \
    import { PrismaClient } from "./dist/generated/prisma/client.js"; \
    import { PrismaPg } from "@prisma/adapter-pg"; \
    import * as argon2 from "argon2"; \
    import "@prisma/client/runtime/query_compiler_fast_bg.postgresql.mjs"; \
    import { wasm } from "@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.mjs"; \
    if (process.getuid() === 0) throw new Error("Runtime must be non-root"); \
    if (existsSync("node_modules/prisma") || existsSync(".env")) throw new Error("Runtime contains build tooling or an environment file"); \
    if (typeof PrismaClient !== "function" || typeof PrismaPg !== "function") throw new Error("Prisma runtime missing"); \
    await WebAssembly.compile(Buffer.from(wasm, "base64")); \
    const password = randomBytes(32).toString("hex"); \
    const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }); \
    if (!await argon2.verify(hash, password)) throw new Error("Argon2 verification failed"); \
    console.log("Non-root Prisma/WASM and Argon2 runtime checks passed");'
EXPOSE 3001
STOPSIGNAL SIGTERM
CMD ["node", "dist/main.js"]
