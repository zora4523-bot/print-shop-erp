import 'server-only';
import { Prisma } from '@/generated/prisma/client';

/** 免费重做按原单销售归属；管理员创建人不参与销售筛选。 */
export function analyticsSalesWhere(sales: string): Prisma.OrderWhereInput {
  return { OR: [
    { settlementType: 'EXTERNAL_SALES', submitterId: sales },
    { settlementType: 'NO_CHARGE', sourceOrder: { submitterId: sales } },
  ] };
}

/** SQL 调用方统一使用工单别名 o。 */
export function analyticsSalesCondition(sales: string): Prisma.Sql {
  return sales ? Prisma.sql`AND (
    (o."settlementType" = 'EXTERNAL_SALES' AND o."submitterId" = ${sales}) OR
    (o."settlementType" = 'NO_CHARGE' AND EXISTS (
      SELECT 1 FROM "Order" source WHERE source.id = o."sourceOrderId" AND source."submitterId" = ${sales}
    ))
  )` : Prisma.empty;
}
