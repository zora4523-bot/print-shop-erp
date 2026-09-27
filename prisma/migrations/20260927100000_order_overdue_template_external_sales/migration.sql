-- 2026-09-27：工单“客户名称/简称”自 2026-09-13 起不再录入（DECISIONS 2026-09-27），
-- 交期逾期通知的默认模板改为显示工单归属的外部销售（载荷新增 {externalSalesName}）。
-- 只改仍等于旧默认原文的行，管理员自己改过的模板不覆盖（与 20260902121200 同口径）；
-- 这类模板里的 {customerRef} 仍随载荷发送（缺失时为“未填”），不会原样漏出占位符。
UPDATE "NotificationRule"
   SET "messageTemplate" = E'🚚 **交期逾期**\n工单：{orderNo}\n外部销售：{externalSalesName}\n承诺交期：{promisedDate}\n已逾期：{daysOverdue} 天\n当前状态：{status}',
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "eventType" = 'ORDER_OVERDUE'
   AND "messageTemplate" = E'🚚 **交期逾期**\n工单：{orderNo}\n客户：{customerRef}\n承诺交期：{promisedDate}\n已逾期：{daysOverdue} 天\n当前状态：{status}';
