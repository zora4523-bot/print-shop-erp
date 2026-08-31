-- The owner notification page reads the newest rows across every status with
-- ORDER BY "lastAttemptAt" DESC, "id" DESC. The existing status-leading index
-- cannot satisfy that global order.
--
-- A failed CREATE INDEX CONCURRENTLY can leave a same-name INVALID index.
-- Remove that artifact before every build so a retry must create a valid index.
-- The DROP is deliberately non-concurrent: on a clean database it is a no-op,
-- and on failed-build recovery it removes only the invalid artifact.
--
-- There is deliberately no IF NOT EXISTS on CREATE. An unexpected same-name
-- object or failed rebuild must keep deployment red instead of recording false
-- success. Do not add BEGIN/COMMIT because CONCURRENTLY cannot run in a
-- transaction block.
DROP INDEX IF EXISTS "NotificationLog_lastAttemptAt_id_idx";

CREATE INDEX CONCURRENTLY "NotificationLog_lastAttemptAt_id_idx"
  ON "NotificationLog"("lastAttemptAt" DESC, "id" DESC);
