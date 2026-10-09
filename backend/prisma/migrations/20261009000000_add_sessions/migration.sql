-- Additive migration; do not alter the already-applied domain migration.
BEGIN;
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Session_tokenHash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "Session_expiry_check" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "Session_activity_check" CHECK ("lastSeenAt" >= "createdAt" AND "lastSeenAt" < "expiresAt"),
    CONSTRAINT "Session_revocation_check" CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "Session_lastSeenAt_idx" ON "Session"("lastSeenAt");
CREATE INDEX "Session_revokedAt_idx" ON "Session"("revokedAt");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- Session rows are disposable operational data, not immutable domain history.
-- NestJS owns fixed expiry, monotonic activity, token creation and one-way revocation.
COMMIT;
