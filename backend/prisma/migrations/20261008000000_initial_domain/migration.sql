BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('TEACHER', 'ADMIN');

-- CreateEnum
CREATE TYPE "GenerationOrigin" AS ENUM ('MANUAL', 'AI_ASSISTED');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVE', 'REQUEST_CHANGES');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurriculumResource" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "contentText" TEXT NOT NULL,
    "retiredAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CurriculumResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "draftContent" JSONB,
    "draftGenerationOrigin" "GenerationOrigin",
    "currentRevisionId" UUID,
    "copiedFromRevisionId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonRevision" (
    "id" UUID NOT NULL,
    "lessonId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "generationOrigin" "GenerationOrigin" NOT NULL,
    "submittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "feedback" TEXT,
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionSource" (
    "revisionId" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "resourceVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "RevisionSource_pkey" PRIMARY KEY ("revisionId","resourceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Lesson_ownerId_updatedAt_idx" ON "Lesson"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "Lesson_currentRevisionId_idx" ON "Lesson"("currentRevisionId");

-- CreateIndex
CREATE INDEX "Lesson_copiedFromRevisionId_idx" ON "Lesson"("copiedFromRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonRevision_lessonId_number_key" ON "LessonRevision"("lessonId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "LessonRevision_lessonId_id_key" ON "LessonRevision"("lessonId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Review_revisionId_key" ON "Review"("revisionId");

-- CreateIndex
CREATE INDEX "Review_reviewerId_idx" ON "Review"("reviewerId");

-- CreateIndex
CREATE INDEX "RevisionSource_resourceId_idx" ON "RevisionSource"("resourceId");

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_id_currentRevisionId_fkey" FOREIGN KEY ("id", "currentRevisionId") REFERENCES "LessonRevision"("lessonId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_copiedFromRevisionId_fkey" FOREIGN KEY ("copiedFromRevisionId") REFERENCES "LessonRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LessonRevision" ADD CONSTRAINT "LessonRevision_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "LessonRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RevisionSource" ADD CONSTRAINT "RevisionSource_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "LessonRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RevisionSource" ADD CONSTRAINT "RevisionSource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "CurriculumResource"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Reviewed SQL additions: Prisma does not represent these CHECKs/triggers.
-- All tables and unique indexes precede FKs, including the circular Lesson <->
-- LessonRevision relation. Its default MATCH SIMPLE permits a null current pointer.
ALTER TABLE "User" ADD CONSTRAINT "User_email_canonical_check"
  CHECK ("email" <> '' AND "email" = lower(btrim("email"))
    AND "email" !~ '^[[:space:]]|[[:space:]]$');

ALTER TABLE "CurriculumResource" ADD CONSTRAINT "CurriculumResource_version_positive_check"
  CHECK ("version" > 0);
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_version_positive_check"
  CHECK ("version" > 0);
ALTER TABLE "LessonRevision" ADD CONSTRAINT "LessonRevision_number_positive_check"
  CHECK ("number" > 0);
ALTER TABLE "RevisionSource" ADD CONSTRAINT "RevisionSource_resourceVersion_positive_check"
  CHECK ("resourceVersion" > 0);

ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_draftContent_object_check"
  CHECK ("draftContent" IS NULL OR jsonb_typeof("draftContent") = 'object');
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_draft_origin_pair_check"
  CHECK (("draftContent" IS NULL) = ("draftGenerationOrigin" IS NULL));
ALTER TABLE "LessonRevision" ADD CONSTRAINT "LessonRevision_content_object_check"
  CHECK (jsonb_typeof("content") = 'object');
ALTER TABLE "RevisionSource" ADD CONSTRAINT "RevisionSource_snapshot_object_check"
  CHECK (jsonb_typeof("snapshot") = 'object');
ALTER TABLE "Review" ADD CONSTRAINT "Review_change_request_feedback_check"
  CHECK ("decision" <> 'REQUEST_CHANGES'
    OR ("feedback" IS NOT NULL AND "feedback" ~ '[^[:space:]]'));

CREATE FUNCTION "reject_history_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Submitted history cannot be updated or deleted.'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "LessonRevision_immutable"
  BEFORE UPDATE OR DELETE ON "LessonRevision"
  FOR EACH ROW EXECUTE FUNCTION "reject_history_mutation"();
CREATE TRIGGER "RevisionSource_immutable"
  BEFORE UPDATE OR DELETE ON "RevisionSource"
  FOR EACH ROW EXECUTE FUNCTION "reject_history_mutation"();
CREATE TRIGGER "Review_immutable"
  BEFORE UPDATE OR DELETE ON "Review"
  FOR EACH ROW EXECUTE FUNCTION "reject_history_mutation"();

CREATE FUNCTION "protect_lesson_identity"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId"
    OR NEW."copiedFromRevisionId" IS DISTINCT FROM OLD."copiedFromRevisionId" THEN
    RAISE EXCEPTION 'Lesson ownership and copy provenance are write-once.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Lesson_identity_write_once"
  BEFORE UPDATE ON "Lesson"
  FOR EACH ROW EXECUTE FUNCTION "protect_lesson_identity"();

-- Row immutability does NOT prevent later INSERTs into RevisionSource.
-- NestJS must enforce complete source sets at submission, no later source inserts,
-- role/ownership checks, content/timing validation, lifecycle/version rules,
-- approved-copy eligibility, and trusted selection/refresh snapshots in transactions.

COMMIT;
