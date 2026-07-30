-- 录单工艺目录：补齐局部/三色/铜版纸工艺，并把四个低频项稳定排到末尾。
-- Craft.sortOrder 是所有工艺选择器的权威顺序；900+ 同时作为录单页的
-- “低频工艺”分组边界。

INSERT INTO "Craft" (
  "id",
  "name",
  "code",
  "isOutsource",
  "defaultWorkerType",
  "defaultMachineType",
  "sortOrder",
  "isActive",
  "createdAt",
  "updatedAt"
) VALUES
  (
    'craft_flat_foil_partial',
    '局部烫金',
    'FLAT_FOIL_PARTIAL',
    false,
    'MACHINE'::"WorkerType",
    'HAND_PRESS'::"MachineType",
    10,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'craft_flat_foil_triple',
    '专版三色平烫',
    'FLAT_FOIL_TRIPLE',
    false,
    'MACHINE'::"WorkerType",
    'WINDMILL'::"MachineType",
    22,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'craft_coated_color_print',
    '铜版纸纯彩印',
    'COATED_COLOR_PRINT',
    true,
    NULL,
    NULL,
    60,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'craft_coated_color_print_foil',
    '铜版纸彩印+烫金',
    'COATED_COLOR_PRINT_FOIL',
    true,
    NULL,
    'WINDMILL'::"MachineType",
    61,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "isOutsource" = EXCLUDED."isOutsource",
  "defaultWorkerType" = EXCLUDED."defaultWorkerType",
  "defaultMachineType" = EXCLUDED."defaultMachineType",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "Craft"
SET "sortOrder" = CASE "code"
  WHEN 'STOCK_FOIL' THEN 900
  WHEN 'UV' THEN 901
  WHEN 'DIE_CUT' THEN 902
  WHEN 'CLEANING' THEN 903
END,
"updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('STOCK_FOIL', 'UV', 'DIE_CUT', 'CLEANING');
