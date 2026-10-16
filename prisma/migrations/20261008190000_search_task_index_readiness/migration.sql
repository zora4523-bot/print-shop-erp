-- 生产任务允许同一明细、工艺对应多条记录；预检使用现有普通组合索引。
UPDATE app_ops.search_surface_candidate
SET required_indexes = array_replace(
      required_indexes,
      'public."ProductionTask_orderItemId_craftId_key"',
      'public."ProductionTask_orderItemId_craftId_idx"'
    ),
    updated_at = now()
WHERE surface_key = 'order-search-v1'
  AND 'public."ProductionTask_orderItemId_craftId_key"' = ANY(required_indexes);
