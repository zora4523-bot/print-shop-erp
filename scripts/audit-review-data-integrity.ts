import 'dotenv/config';

import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL 未设置，无法执行只读数据核查');
}

const client = new Client({ connectionString: databaseUrl });

async function main(): Promise<void> {
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const result = await client.query<{
      paidPayrolls: number;
      paidPayrollsWithAttendanceMismatch: number;
      materialsWithQuantityFacts: number;
      materialsWithBlankUnit: number;
      duplicateBillOrderItems: number;
      billItemsWithOwnershipMismatch: number;
    }>(`
    WITH paid AS (
      SELECT p.id,
             p."workerId",
             p.month,
             p."salaryRuleSnapshot"::jsonb ->> 'workerType' AS "workerType",
             COALESCE(p."dailyDetail"::jsonb, '[]'::jsonb) AS detail
        FROM "HourlyWorkerPayroll" p
       WHERE p."isPaid" = TRUE
    ), detail AS (
      SELECT p.id AS "payrollId",
             item ->> 'date' AS date,
             (item ->> 'normalHours')::numeric AS normal,
             (item ->> 'otHours')::numeric AS ot,
             (item ->> 'spareHours')::numeric AS spare
        FROM paid p
        CROSS JOIN LATERAL jsonb_array_elements(p.detail) item
    ), facts AS (
      SELECT p.id AS "payrollId",
             to_char(a.date, 'YYYY-MM-DD') AS date,
             a."normalHours" AS normal,
             a."otHours" AS ot,
             a."spareHours" AS spare
        FROM paid p
        JOIN "Attendance" a
          ON a."workerId" = p."workerId"
         AND to_char(a.date, 'YYYY-MM') = p.month
         AND a."roleSnapshot"::text = 'WORKER'
         AND a."workerTypeSnapshot"::text = p."workerType"
    ), mismatches AS (
      SELECT d."payrollId"
        FROM detail d
        LEFT JOIN facts f
          ON f."payrollId" = d."payrollId" AND f.date = d.date
       WHERE f.date IS NULL
          OR f.normal IS DISTINCT FROM d.normal
          OR f.ot IS DISTINCT FROM d.ot
          OR f.spare IS DISTINCT FROM d.spare
      UNION
      SELECT f."payrollId"
        FROM facts f
        LEFT JOIN detail d
          ON d."payrollId" = f."payrollId" AND d.date = f.date
       WHERE d.date IS NULL
    ), used_materials AS (
      SELECT m.id
        FROM "Material" m
       WHERE m."currentStock" <> 0
          OR EXISTS (SELECT 1 FROM "MaterialLocationStock" x WHERE x."materialId" = m.id)
          OR EXISTS (SELECT 1 FROM "MaterialTransaction" x WHERE x."materialId" = m.id)
          OR EXISTS (SELECT 1 FROM "BillOfMaterialItem" x WHERE x."materialId" = m.id)
          OR EXISTS (SELECT 1 FROM "PurchaseOrderItem" x WHERE x."materialId" = m.id)
          OR EXISTS (SELECT 1 FROM "PurchaseReceiptItem" x WHERE x."materialId" = m.id)
          OR EXISTS (SELECT 1 FROM "StockTransfer" x WHERE x."materialId" = m.id)
          OR EXISTS (SELECT 1 FROM "InventoryCountItem" x WHERE x."materialId" = m.id)
          OR EXISTS (SELECT 1 FROM "Product" x WHERE x."paperMaterialId" = m.id)
    ), duplicate_bill_orders AS (
      SELECT "orderId"
        FROM "BillItem"
       GROUP BY "orderId"
      HAVING count(*) > 1
    ), bill_ownership_mismatches AS (
      SELECT item.id
        FROM "BillItem" item
        JOIN "Bill" bill ON bill.id = item."billId"
        JOIN "Order" business_order ON business_order.id = item."orderId"
       WHERE business_order."finishedAt" IS NULL
          OR bill."salesUserId" <> business_order."submitterId"
          OR bill.period <> to_char(
            (business_order."finishedAt" AT TIME ZONE 'UTC')
              AT TIME ZONE 'Asia/Shanghai',
            'YYYY-MM'
          )
    )
    SELECT
      (SELECT count(*)::int FROM paid) AS "paidPayrolls",
      (SELECT count(DISTINCT "payrollId")::int FROM mismatches)
        AS "paidPayrollsWithAttendanceMismatch",
      (SELECT count(*)::int FROM used_materials)
        AS "materialsWithQuantityFacts",
      (SELECT count(*)::int FROM "Material" WHERE btrim(unit) = '')
        AS "materialsWithBlankUnit",
      (SELECT count(*)::int FROM duplicate_bill_orders)
        AS "duplicateBillOrderItems",
      (SELECT count(*)::int FROM bill_ownership_mismatches)
        AS "billItemsWithOwnershipMismatch"
    `);
    await client.query('ROLLBACK');

    const audit = result.rows[0];
    if (!audit) throw new Error('只读数据核查未返回结果');
    console.log(JSON.stringify(audit, null, 2));
    if (
      audit.paidPayrollsWithAttendanceMismatch > 0 ||
      audit.duplicateBillOrderItems > 0 ||
      audit.billItemsWithOwnershipMismatch > 0
    ) {
      process.exitCode = 2;
    }
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

void main();
