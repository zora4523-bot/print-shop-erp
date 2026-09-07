-- The management-workflow foundation migration used ordinary PostgreSQL
-- strings containing backslash+n. With standard_conforming_strings enabled,
-- those defaults render literal "\n" in WeCom instead of line breaks.
-- Repair only the five exact historical defaults. Administrator-edited
-- templates, activation switches, routing, and already-correct defaults stay
-- unchanged. Dollar-quoted literals keep the matching independent of the
-- session's standard_conforming_strings setting.
WITH historical_defaults (event_type, legacy_template) AS (
  VALUES
    (
      'ORDER_SUBMITTED',
      $template$**新工单提交**\n工单号：{orderNo}\n{summary}\n{deepLink}$template$
    ),
    (
      'ORDER_CHANGE_REQUESTED',
      $template$**工单变更/取消申请**\n工单号：{orderNo}\n{summary}\n{deepLink}$template$
    ),
    (
      'PRODUCTION_PROGRESS_ANOMALY',
      $template$⚠️ **报工进度异常**\n工单号：{orderNo}\n{summary}\n{deepLink}$template$
    ),
    (
      'PRODUCTION_STAGNANT',
      $template$⏳ **生产停滞**\n工单号：{orderNo}\n{summary}\n{deepLink}$template$
    ),
    (
      'PENDING_FACTORY_BACKLOG',
      $template$📋 **待确认积压**\n工单号：{orderNo}\n{summary}\n{deepLink}$template$
    )
)
UPDATE "NotificationRule" AS rule
SET
  "messageTemplate" = replace(defaults.legacy_template, chr(92) || 'n', chr(10)),
  "updatedAt" = CURRENT_TIMESTAMP
FROM historical_defaults AS defaults
WHERE rule."eventType" = defaults.event_type
  AND rule."messageTemplate" = defaults.legacy_template;
