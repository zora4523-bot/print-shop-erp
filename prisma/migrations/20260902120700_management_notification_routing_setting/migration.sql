-- The five management-workspace events have fixed recipient roles in code.
-- Preserve compatible existing deployments by collecting only real, active
-- NotificationChannel IDs from their legacy NotificationRule bindings. The
-- role switch is enabled only when at least one valid channel was found;
-- otherwise the new route starts fail-closed.
WITH "managementBindings" AS (
  SELECT DISTINCT
    CASE
      WHEN rule."eventType" IN (
        'ORDER_SUBMITTED',
        'ORDER_CHANGE_REQUESTED'
      ) THEN 'factoryConfirmer'
      WHEN rule."eventType" IN (
        'PRODUCTION_PROGRESS_ANOMALY',
        'PRODUCTION_STAGNANT',
        'PENDING_FACTORY_BACKLOG'
      ) THEN 'owner'
    END AS role,
    channel.id AS "channelId"
  FROM "NotificationRule" AS rule
  CROSS JOIN LATERAL unnest(rule."channelIds") AS binding("channelId")
  JOIN "NotificationChannel" AS channel
    ON channel.id = binding."channelId"
   AND channel."isActive" = TRUE
  WHERE rule."eventType" IN (
    'ORDER_SUBMITTED',
    'ORDER_CHANGE_REQUESTED',
    'PRODUCTION_PROGRESS_ANOMALY',
    'PRODUCTION_STAGNANT',
    'PENDING_FACTORY_BACKLOG'
  )
), "roleChannels" AS (
  SELECT
    COALESCE(
      jsonb_agg(DISTINCT "channelId" ORDER BY "channelId")
        FILTER (WHERE role = 'factoryConfirmer'),
      '[]'::jsonb
    ) AS "factoryConfirmerIds",
    COALESCE(
      jsonb_agg(DISTINCT "channelId" ORDER BY "channelId")
        FILTER (WHERE role = 'owner'),
      '[]'::jsonb
    ) AS "ownerIds"
  FROM "managementBindings"
)
INSERT INTO "Setting" ("id", "key", "value", "remark", "updatedAt")
SELECT
  'seed-management-notification-routing-v2',
  'management_notification_routing',
  jsonb_build_object(
    'factoryConfirmer', jsonb_build_object(
      'enabled', jsonb_array_length("factoryConfirmerIds") > 0,
      'channelIds', "factoryConfirmerIds"
    ),
    'owner', jsonb_build_object(
      'enabled', jsonb_array_length("ownerIds") > 0,
      'channelIds', "ownerIds"
    )
  ),
  '管理通知的角色开关与企业微信群路由',
  CURRENT_TIMESTAMP
FROM "roleChannels"
ON CONFLICT ("key") DO NOTHING;
