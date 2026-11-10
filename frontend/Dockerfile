# Match .nvmrc; keep Linux native dependencies on Debian/glibc in every stage.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
# Next/SWC, Tailwind/Oxide and Sharp use optional platform/native packages.
RUN npm ci --include=dev --include=optional

FROM dependencies AS build
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY src ./src
COPY public ./public
# Public browser configuration, never credentials. Changing it needs a rebuild.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN --network=none test -n "$NEXT_PUBLIC_API_BASE_URL" && npm run build

FROM base AS runtime
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1
# standalone contains server.js, traced dependencies and server output; assets
# are separate Next.js outputs and must be placed relative to that server.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "server.js"]
