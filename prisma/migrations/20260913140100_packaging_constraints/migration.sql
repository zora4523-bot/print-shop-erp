BEGIN;
ALTER TABLE "OrderPackagingGroup" DROP CONSTRAINT "OrderPackagingGroup_actual_bag_count_positive_check";
ALTER TABLE "OrderPackagingGroup" ADD CONSTRAINT "OrderPackagingGroup_count_by_mode_check" CHECK (
  ("mode" = 'UNPACKED' AND "actualBagCount" = 0 AND "unitPrice" = 0 AND "subtotal" = 0 AND ("suggestedSubtotal" IS NULL OR "suggestedSubtotal" = 0))
  OR ("mode" <> 'UNPACKED' AND "actualBagCount" > 0));
ALTER TABLE "ProductionOperation" DROP CONSTRAINT "ProductionOperation_unit_check";
ALTER TABLE "ProductionOperation" ADD CONSTRAINT "ProductionOperation_unit_check" CHECK (
  ("operationType" = 'PARTIAL' AND "unit" = 'PER_PASS') OR ("operationType" = 'FULL' AND "unit" = 'PER_PIECE') OR ("operationType" = 'PACKING' AND "unit" IN ('PER_BAG', 'PER_BOX')));
CREATE OR REPLACE FUNCTION "check_order_packaging_group_mode"()
RETURNS TRIGGER AS $$
DECLARE
  target_group_id TEXT;
  target_order_id TEXT;
  target_mode "OrderPackagingMode";
  positive_line_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'OrderPackagingGroup' THEN
    target_group_id := COALESCE(NEW."id", OLD."id");
    target_order_id := COALESCE(NEW."orderId", OLD."orderId");
  ELSE
    target_group_id := COALESCE(NEW."packagingGroupId", OLD."packagingGroupId");
    target_order_id := COALESCE(NEW."orderId", OLD."orderId");
  END IF;

  SELECT g."mode", COUNT(l."id")::INTEGER
    INTO target_mode, positive_line_count
  FROM "OrderPackagingGroup" g
  LEFT JOIN "OrderPackagingGroupLine" l
    ON l."orderId" = g."orderId"
   AND l."packagingGroupId" = g."id"
   AND l."unitsPerBag" > 0
  WHERE g."id" = target_group_id AND g."orderId" = target_order_id
  GROUP BY g."mode";

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF target_mode IN ('SINGLE_STYLE', 'BOX_RED_CARD', 'BOX_TACTILE') AND positive_line_count <> 1 THEN
    RAISE EXCEPTION 'SINGLE_STYLE packaging group must contain exactly one style';
  END IF;
  IF target_mode IN ('MIXED_STYLE', 'BOX_RED_CARD_MIXED', 'BOX_TACTILE_MIXED') AND positive_line_count < 2 THEN
    RAISE EXCEPTION 'MIXED_STYLE packaging group must contain at least two styles';
  END IF;
  IF target_mode = 'UNPACKED' AND positive_line_count < 1 THEN
    RAISE EXCEPTION 'UNPACKED must retain its style membership';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;


COMMIT;
