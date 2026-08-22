-- 早期 seed 把角色称呼写进了管理员的 displayName，导致角色合并后
-- 顶栏和欢迎语仍显示“老板/车间主管”。仅清理两个精确默认值，避免
-- 误改“王老板”等真实姓名或昵称。
UPDATE "User"
SET
  "displayName" = '管理员',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "role" = 'ADMIN'::"Role"
  AND "displayName" IN ('老板', '车间主管');
