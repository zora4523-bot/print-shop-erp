-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderPackagingMode" ADD VALUE 'UNPACKED';
ALTER TYPE "OrderPackagingMode" ADD VALUE 'BOX_RED_CARD';
ALTER TYPE "OrderPackagingMode" ADD VALUE 'BOX_RED_CARD_MIXED';
ALTER TYPE "OrderPackagingMode" ADD VALUE 'BOX_TACTILE';
ALTER TYPE "OrderPackagingMode" ADD VALUE 'BOX_TACTILE_MIXED';

-- AlterEnum
ALTER TYPE "CustomerPriceCalculationType" ADD VALUE 'PER_BOX';


ALTER TYPE "PieceworkRateUnit" ADD VALUE 'PER_BOX';
