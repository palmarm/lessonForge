BEGIN;

-- The destination row is also the durable successful operation record.
-- Existing lessons (including older copy fixtures) keep both fields NULL.
ALTER TABLE "Lesson"
  ADD COLUMN "copyOperationKey" UUID,
  ADD COLUMN "copySourceVersion" INTEGER;

CREATE UNIQUE INDEX "Lesson_ownerId_copyOperationKey_key"
  ON "Lesson"("ownerId", "copyOperationKey");

ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_copy_operation_check" CHECK (
  ("copyOperationKey" IS NULL AND "copySourceVersion" IS NULL)
  OR ("copyOperationKey" IS NOT NULL AND "copySourceVersion" IS NOT NULL
      AND "copySourceVersion" > 0 AND "copiedFromRevisionId" IS NOT NULL
      AND "copyOperationKey"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);

-- Extend the existing write-once protection without editing applied migrations.
CREATE OR REPLACE FUNCTION "protect_lesson_identity"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."copyOperationKey" IS NOT NULL AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Successful copy destination identity is write-once.'
      USING ERRCODE = '23514', CONSTRAINT = 'Lesson_copy_destination_identity';
  END IF;
  IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId"
    OR NEW."copiedFromRevisionId" IS DISTINCT FROM OLD."copiedFromRevisionId"
    OR NEW."copyOperationKey" IS DISTINCT FROM OLD."copyOperationKey"
    OR NEW."copySourceVersion" IS DISTINCT FROM OLD."copySourceVersion" THEN
    RAISE EXCEPTION 'Lesson ownership and copy operation are write-once.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Successful keys must never become reusable through deleting their mapping.
CREATE FUNCTION "retain_copy_operation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."copyOperationKey" IS NOT NULL THEN
    RAISE EXCEPTION 'Successful copy operations must be retained.'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "Lesson_copy_operation_retained"
  BEFORE DELETE ON "Lesson"
  FOR EACH ROW EXECUTE FUNCTION "retain_copy_operation"();

COMMIT;
