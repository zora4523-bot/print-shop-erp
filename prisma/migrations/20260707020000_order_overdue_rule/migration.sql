-- ORDER_OVERDUE 事件规则行（第 11 条，业主 2026-07-07 新增）。
-- 生产库升级不重跑 seed（部署规范只允许首次部署 seed），规则行必须
-- 由 migration 补齐；否则 notify() 静默早退、/owner/notifications
-- 也看不到该事件。与 seed 同款默认：未启用 + 空 channel，业主配好
-- webhook 后在推送配置页启用。
INSERT INTO "NotificationRule" (
  "id", "eventType", "channelIds", "messageTemplate", "isActive",
  "createdAt", "updatedAt"
) VALUES (
  'rule_order_overdue_v1',
  'ORDER_OVERDUE',
  '{}',
  E'🚚 **交期逾期**\n工单：{orderNo}\n客户：{customerRef}\n承诺交期：{promisedDate}\n已逾期：{daysOverdue} 天\n当前状态：{status}',
  false,
  NOW(),
  NOW()
)
ON CONFLICT ("eventType") DO NOTHING;
