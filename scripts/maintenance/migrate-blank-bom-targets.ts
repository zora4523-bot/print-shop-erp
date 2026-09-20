import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import {
  BLANK_BOM_CATEGORY_SETTING_KEY, planBlankBomMigration,
  type MigrationBom, type MigrationNode, type MigrationPaper, type MigrationProduct,
} from '../../lib/bom/blank-target-migration';

export function parseBlankBomMigrationArgs(args: readonly string[]) {
  const options = { databaseUrl: '', apply: false, defaultCategoryId: undefined as string | undefined };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--apply' && !options.apply) options.apply = true;
    else if (arg === '--database-url' && !options.databaseUrl) options.databaseUrl = args[++index] ?? '';
    else if (arg === '--default-category-id' && options.defaultCategoryId === undefined) {
      const value = args[++index];
      if (!value) throw new Error('须提供默认分类 ID');
      options.defaultCategoryId = value;
    }
    else throw new Error('参数无效');
  }
  const url = new URL(options.databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.pathname.slice(1)) throw new Error('须显式指定目标 PostgreSQL 数据库');
  if (options.defaultCategoryId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(options.defaultCategoryId)) throw new Error('分类 ID 无效');
  return options;
}

export async function migrateBlankBomTargets(client: Pick<Client, 'query'>, options: ReturnType<typeof parseBlankBomMigrationArgs>) {
  await client.query(options.apply ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    if (options.apply) {
      await client.query("SET LOCAL lock_timeout = '15s'");
      // Lock every source/target before planning; a reviewed source cannot change
      // between the uniqueness preflight and the deterministic copy.
      await client.query('LOCK TABLE "BillOfMaterial", "BillOfMaterialItem", "Product", "Material", "ProductCategoryNode", "Setting", "BusinessAuditLog" IN SHARE ROW EXCLUSIVE MODE');
    }
    const papers = await client.query<MigrationPaper>('SELECT id, name, specification FROM "Material" WHERE category = \'PAPER\' ORDER BY id');
    const products = await client.query<MigrationProduct>('SELECT id, "paperMaterialId", "paperType", weight, specification, "categoryNodeId" FROM "Product" WHERE category = \'BLANK_STOCK\' ORDER BY id');
    const nodes = await client.query<MigrationNode>('SELECT id, "isActive", "legacyCategory" FROM "ProductCategoryNode" ORDER BY id');
    const boms = await client.query<MigrationBom>(`SELECT b.*, COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'materialId', i."materialId", 'quantity', i.quantity::text, 'sortOrder', i."sortOrder", 'remark', i.remark
    ) ORDER BY i."sortOrder", i.id) FROM "BillOfMaterialItem" i WHERE i."bomId" = b.id), '[]'::jsonb) AS items FROM "BillOfMaterial" b ORDER BY b.id`);
    const settings = await client.query<{ value: unknown }>('SELECT value FROM "Setting" WHERE key = $1', [BLANK_BOM_CATEGORY_SETTING_KEY]);
    const audits = await client.query<{ entityId: string }>('SELECT "entityId" FROM "BusinessAuditLog" WHERE action = \'MIGRATE_BLANK_BOM_TARGET\'');
    const plan = planBlankBomMigration({ papers: papers.rows, products: products.rows, nodes: nodes.rows, boms: boms.rows,
      existingSetting: settings.rows[0]?.value, selectedDefaultCategoryId: options.defaultCategoryId, migratedTargetIds: audits.rows.map((row) => row.entityId) });
    if (options.apply && plan.ready) {
      if (plan.defaultCategoryId && settings.rows[0]?.value !== plan.defaultCategoryId) {
        await client.query(`INSERT INTO "Setting" (id, key, value, remark, "updatedAt") VALUES ($1, $2, $3::jsonb, $4, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`,
        ['blank_bom_default_category', BLANK_BOM_CATEGORY_SETTING_KEY, JSON.stringify(plan.defaultCategoryId), '空白封生产用料默认分类，不用于销售准入']);
        await client.query(`INSERT INTO "BusinessAuditLog" (id, action, "entityType", "entityId", "after")
          VALUES ($1, 'MIGRATE_BLANK_BOM_DEFAULT_CATEGORY', 'Setting', $2, $3::jsonb)`,
        ['audit_blank_bom_default_category', BLANK_BOM_CATEGORY_SETTING_KEY, JSON.stringify({ value: plan.defaultCategoryId, sourceCategoryIds: plan.categorySourceIds })]);
      }
      for (const copy of plan.copies) {
        await client.query(`INSERT INTO "BillOfMaterial" (id, "blankPaperMaterialId", "blankSpecificationKey", name, version, "baseQuantity", "isActive", "updatedAt")
          VALUES ($1, $2, $3, $4, $5, $6, true, NOW())`, [copy.id, copy.paperId, copy.specificationKey, copy.source.name, copy.source.version, copy.source.baseQuantity]);
        for (const [index, item] of copy.source.items.entries()) {
          await client.query(`INSERT INTO "BillOfMaterialItem" (id, "bomId", "materialId", quantity, "sortOrder", remark, "updatedAt")
            VALUES ($1, $2, $3, $4::numeric, $5, $6, NOW())`, [`${copy.id}_${index}`, copy.id, item.materialId, item.quantity, item.sortOrder, item.remark]);
        }
        const verified = await client.query<{ same: boolean }>(`SELECT
          t.name = s.name AND t.version = s.version AND t."baseQuantity" = s."baseQuantity" AND
          t."isActive" = s."isActive" AND t."productId" IS NULL AND t."categoryNodeId" IS NULL AND
          t."blankPaperMaterialId" = $3 AND t."blankSpecificationKey" = $4 AND NOT EXISTS (
            (SELECT "materialId", quantity, "sortOrder", remark FROM "BillOfMaterialItem" WHERE "bomId" = $1
             EXCEPT SELECT "materialId", quantity, "sortOrder", remark FROM "BillOfMaterialItem" WHERE "bomId" = $2)
            UNION ALL
            (SELECT "materialId", quantity, "sortOrder", remark FROM "BillOfMaterialItem" WHERE "bomId" = $2
             EXCEPT SELECT "materialId", quantity, "sortOrder", remark FROM "BillOfMaterialItem" WHERE "bomId" = $1)
          ) AS same FROM "BillOfMaterial" t CROSS JOIN "BillOfMaterial" s WHERE t.id = $1 AND s.id = $2`,
        [copy.id, copy.source.id, copy.paperId, copy.specificationKey]);
        if (verified.rows[0]?.same !== true) throw new Error('迁移前后用料不一致');
        await client.query(`INSERT INTO "BusinessAuditLog" (id, action, "entityType", "entityId", "before", "after")
          VALUES ($1, 'MIGRATE_BLANK_BOM_TARGET', 'BillOfMaterial', $2, $3::jsonb, $4::jsonb)`,
        [`audit_${copy.id}`, copy.id, JSON.stringify(copy.source), JSON.stringify({ paperId: copy.paperId, specificationKey: copy.specificationKey, productIds: copy.productIds, quantitiesVerified: true })]);
      }
      await client.query('COMMIT');
    } else await client.query('ROLLBACK');
    return { ...plan, applied: options.apply && plan.ready };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

async function main() {
  const options = parseBlankBomMigrationArgs(process.argv.slice(2));
  const client = new Client({ connectionString: options.databaseUrl });
  try {
    await client.connect();
    const report = await migrateBlankBomTargets(client, options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ready) process.exitCode = 1;
  } finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  // Never expose connection strings or PostgreSQL error fields in CLI output.
  process.stderr.write('空白封用料预检或迁移失败，事务已回滚。请检查显式目标库、参数及前向迁移状态。\n');
  process.exitCode = 1;
});
