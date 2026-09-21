import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { buildBlankPaperPreflight, type PreflightNode, type PreflightProduct, type PreflightRule } from '../../lib/price/blank-paper-preflight';
import type { BlankPaperIdentity } from '../../lib/price/blank-paper-cell';

/** No environment fallback: the operator must explicitly select a target database. */
export function preflightConnectionString(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== '--database-url' || !args[1]?.trim()) {
    throw new Error('请显式指定目标库：tsx scripts/maintenance/preflight-blank-paper-specs.ts --database-url <目标库连接串>');
  }
  const url = new URL(args[1]);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.pathname.slice(1)) {
    throw new Error('请显式提供包含数据库名的 PostgreSQL 连接串');
  }
  return args[1];
}

export async function readBlankPaperPreflight(client: Pick<Client, 'query'>) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const metadata = await client.query<{ database: string; capturedAt: string }>(
      'SELECT current_database() AS database, CURRENT_TIMESTAMP::text AS "capturedAt"',
    );
    const papers = await client.query<BlankPaperIdentity>(
      'SELECT id, name, specification FROM "Material" WHERE category = \'PAPER\' ORDER BY id',
    );
    const products = await client.query<PreflightProduct>(
      'SELECT id, category, "categoryNodeId", specification, "paperType", "paperMaterialId", weight, "isActive" FROM "Product" ORDER BY id',
    );
    const nodes = await client.query<PreflightNode>(
      'SELECT id, path, "legacyCategory", "isActive" FROM "ProductCategoryNode" ORDER BY id',
    );
    const rules = await client.query<PreflightRule>(`
      SELECT r.id, r."priceBookId", r."productId", r."triggerCondition"
      FROM "CustomerPriceRule" r JOIN "CustomerPriceBook" b ON b.id = r."priceBookId"
      WHERE r."isActive" AND b."isActive" AND b.purpose = 'PROCESSING'
        AND b."settlementType" = 'EXTERNAL_SALES' AND r."exclusiveGroup" = 'STOCK_BASE'
        AND b."effectiveFrom" <= CURRENT_TIMESTAMP
        AND (b."effectiveTo" IS NULL OR b."effectiveTo" > CURRENT_TIMESTAMP)
      ORDER BY r.id
    `);
    const report = { ...metadata.rows[0], ...buildBlankPaperPreflight({
      papers: papers.rows, products: products.rows, nodes: nodes.rows, rules: rules.rows,
    }) };
    await client.query('ROLLBACK');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const connectionString = preflightConnectionString(process.argv.slice(2));
  const client = new Client({ connectionString });
  try {
    await client.connect();
    process.stdout.write(`${JSON.stringify(await readBlankPaperPreflight(client), null, 2)}\n`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Connection errors may embed the supplied URI. Never print the original error.
    process.stderr.write('只读预检失败；请检查 --database-url、连接权限和数据库结构。未执行写入。\n');
    process.exitCode = 1;
  });
}
