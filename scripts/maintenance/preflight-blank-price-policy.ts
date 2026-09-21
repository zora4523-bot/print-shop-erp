import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { preflightConnectionString } from './preflight-blank-paper-specs';
import { postgresDatabaseIdentity } from '../lib/e2e-environment';
import { buildBlankPricePolicyPreflight, type BlankPricePreflightInput } from '../lib/blank-price-policy-preflight';

/** All SELECTs run before migration and after migration; JSON projection tolerates added BOM columns. */
export async function readBlankPricePolicyPreflight(client: Pick<Client, 'query'>) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const meta = await client.query<{ database: string; capturedAt: Date }>('SELECT current_database() AS database, CURRENT_TIMESTAMP AS "capturedAt"');
    const papers = await client.query<BlankPricePreflightInput['papers'][number]>(`SELECT id,name,specification,"isActive","outOfStock" FROM "Material" WHERE category='PAPER' ORDER BY id`);
    const books = await client.query<BlankPricePreflightInput['books'][number]>(`SELECT id,version,"isActive","effectiveFrom"::text,"effectiveTo"::text,notes FROM "CustomerPriceBook" WHERE purpose='PROCESSING' AND "settlementType"='EXTERNAL_SALES' ORDER BY id`);
    const rules = await client.query<BlankPricePreflightInput['rules'][number]>(`SELECT r.id,r."priceBookId",r."productId",r.amount::text,r."isActive",r.kind,r."calculationType",r."triggerCondition", CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('code',p.code,'paperType',p."paperType",'weight',p.weight,'specification',p.specification) END AS product FROM "CustomerPriceRule" r LEFT JOIN "Product" p ON p.id=r."productId" WHERE r."exclusiveGroup"='STOCK_BASE' ORDER BY r.id`);
    const items = await client.query<BlankPricePreflightInput['items'][number]>(`SELECT i.id,i."orderId",i."pricingRoute",i."paperType",i."paperWeightGsm",i.specification,i."actualWidthMm"::text,i."actualHeightMm"::text,i.quantity,i."unitPrice"::text,i."fixedFee"::text,i.subtotal::text,i."pricingSnapshot" FROM "OrderItem" i JOIN "Order" o ON o.id=i."orderId" WHERE i."pricingRoute"='STOCK_BLANK' AND o.status IN ('SUBMITTED','PENDING_FACTORY','CONFIRMED','ON_HOLD','RELEASED','FOILING','PACKING','SCHEDULING','IN_PRODUCTION') ORDER BY i.id`);
    const products = await client.query<BlankPricePreflightInput['bom']['products'][number]>(`SELECT id,"paperMaterialId","paperType",weight,specification,"categoryNodeId" FROM "Product" WHERE category='BLANK_STOCK' ORDER BY id`);
    const nodes = await client.query<BlankPricePreflightInput['bom']['nodes'][number]>(`SELECT id,"isActive","legacyCategory" FROM "ProductCategoryNode" ORDER BY id`);
    const bomRows = await client.query<{ data: BlankPricePreflightInput['bom']['boms'][number] }>(`SELECT to_jsonb(b) || jsonb_build_object('items',COALESCE((SELECT jsonb_agg(jsonb_build_object('materialId',i."materialId",'quantity',i.quantity::text,'sortOrder',i."sortOrder",'remark',i.remark) ORDER BY i."materialId") FROM "BillOfMaterialItem" i WHERE i."bomId"=b.id),'[]'::jsonb)) AS data FROM "BillOfMaterial" b ORDER BY b.id`);
    const setting = await client.query<{ value: unknown }>(`SELECT value FROM "Setting" WHERE key='blank_stock_bom_category_node_id'`);
    const foreignKeys = await client.query<{ tableName: string; definition: string }>(`SELECT conrelid::regclass::text AS "tableName", pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND confrelid='"Product"'::regclass ORDER BY conrelid::regclass::text, conname`);
    const referencedProducts = await client.query<{ id: string; orderItems: number; priceRules: number; boms: number; priceTiers: number }>(`SELECT p.id,(SELECT COUNT(*)::int FROM "OrderItem" i WHERE i."productId"=p.id) AS "orderItems",(SELECT COUNT(*)::int FROM "CustomerPriceRule" r WHERE r."productId"=p.id) AS "priceRules",(SELECT COUNT(*)::int FROM "BillOfMaterial" b WHERE b."productId"=p.id) AS boms,(SELECT COUNT(*)::int FROM "PriceTier" t WHERE t."productId"=p.id) AS "priceTiers" FROM "Product" p WHERE p.category='BLANK_STOCK' ORDER BY p.id`);
    const boms = bomRows.rows.map(({ data }) => ({ ...data, blankPaperMaterialId: data.blankPaperMaterialId ?? null, blankSpecificationKey: data.blankSpecificationKey ?? null }));
    const report = buildBlankPricePolicyPreflight({ at: meta.rows[0]!.capturedAt, papers: papers.rows,
      books: books.rows, rules: rules.rows, items: items.rows,
      bom: { papers: papers.rows, products: products.rows, nodes: nodes.rows, boms,
        existingSetting: setting.rows[0]?.value, migratedTargetIds: boms.filter((bom) => bom.blankPaperMaterialId).map((bom) => bom.id) },
    });
    await client.query('ROLLBACK');
    return { ...meta.rows[0], ...report, productReferences: { foreignKeys: foreignKeys.rows,
      products: referencedProducts.rows.length,
      referencedCount: referencedProducts.rows.filter((row) => row.orderItems + row.priceRules + row.boms + row.priceTiers > 0).length,
      zeroKnownRelationalReferenceIds: referencedProducts.rows.filter((row) => row.orderItems + row.priceRules + row.boms + row.priceTiers === 0).map((row) => row.id) } };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

async function main() {
  const connectionString = preflightConnectionString(process.argv.slice(2));
  const target = postgresDatabaseIdentity(connectionString);
  if (!target) throw new Error('invalid target');
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const report = await readBlankPricePolicyPreflight(client);
    if (report.database !== target.databaseName) throw new Error('target mismatch');
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write('空白封单价切换只读预检失败，请检查显式目标库和结构；未执行写入。\n'); process.exitCode = 1; });
}
