-- 功能切换性能审查（2026-10-01）第二批：两个只增不减的列表按 createdAt 倒序取页。
-- 实测：后台任务账本 30 万行取最近 100 条 53 ms（全表扫描 + 排序）→ 0.03 ms；
-- 外协单列表改为分页后由 (createdAt, id) 倒序索引支撑翻页。

-- CreateIndex
CREATE INDEX "BackgroundJob_createdAt_idx" ON "BackgroundJob"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "OutsourceOrder_createdAt_id_idx" ON "OutsourceOrder"("createdAt" DESC, "id" DESC);
