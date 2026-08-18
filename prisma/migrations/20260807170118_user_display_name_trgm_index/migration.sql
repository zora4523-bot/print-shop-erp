CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_displayName_trgm_idx"
  ON "User" USING gin ("displayName" gin_trgm_ops);
