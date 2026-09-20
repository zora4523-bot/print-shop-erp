import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Prisma } from '../../generated/prisma/client';
import type * as Options from '../../lib/order/create-order-options';
import type * as Quote from '../../lib/order/create-order-quote-service';
import type * as Catalog from '../../lib/order/order-item-catalog';
import { comparisonDigest, type PaperComparisonCase, type PaperComparisonCapture } from './paper-spec-comparison';

/** Load the chosen checkout's actual readers, never the collector checkout's implementation. */
export async function loadPaperComparisonReaders(sourceRoot: string) {
  const moduleAt = (name: string) => import(pathToFileURL(resolve(sourceRoot, name)).href);
  const [options, quote, catalog] = await Promise.all([
    moduleAt('lib/order/create-order-options.ts') as Promise<typeof Options>,
    moduleAt('lib/order/create-order-quote-service.ts') as Promise<typeof Quote>,
    moduleAt('lib/order/order-item-catalog.ts') as Promise<typeof Catalog>,
  ]);
  return { readOptions: options.readExternalCreateOrderOptions, calculate: quote.calculateCreateOrderQuoteFromCatalogInTx,
    buildPapers: catalog.buildExternalOrderPapers, weightOptions: catalog.externalOrderWeightOptionsForSelection };
}

export async function capturePaperSpecCompatibility(
  tx: Prisma.TransactionClient,
  readers: Awaited<ReturnType<typeof loadPaperComparisonReaders>>,
  cases: readonly PaperComparisonCase[],
  at: Date,
  revision: string,
): Promise<PaperComparisonCapture> {
  const metadata = await tx.$queryRaw<{ database: string; capturedAt: Date }[]>`SELECT current_database() AS database, CURRENT_TIMESTAMP AS "capturedAt"`;
  // Fingerprint all inputs used by the catalog/facts/price adapters, including inactive rows.
  const tables = await Promise.all([
    tx.product.findMany({ orderBy: { id: 'asc' } }), tx.productCategoryNode.findMany({ orderBy: { id: 'asc' } }),
    tx.material.findMany({ orderBy: { id: 'asc' } }), tx.craft.findMany({ orderBy: { id: 'asc' } }),
    tx.customerPriceBook.findMany({ orderBy: { id: 'asc' } }), tx.customerPriceRule.findMany({ orderBy: { id: 'asc' } }),
    tx.customerChargeCategory.findMany({ orderBy: { id: 'asc' } }),
  ]);
  const options = await readers.readOptions(tx);
  const papers = readers.buildPapers(options.products, options.papers);
  const choices = papers.map((paper) => ({ ...paper, selections: paper.variants.map((variant) => ({
    route: variant.route, specification: variant.specification,
    weights: readers.weightOptions(paper, variant.route, variant.specification),
  })) }));
  const results: PaperComparisonCapture['results'] = [];
  for (const entry of cases) {
    const result = await readers.calculate(tx, { now: at, facts: entry.facts, includeOrderCharges: true });
    if (entry.coverage === 'standard' && result.input.items.some((item) => item.configuration.specification !== 'CATALOG')) {
      throw new Error(`${entry.id}: 标准尺寸未按 CATALOG 判定`);
    }
    if (entry.coverage === 'missing-price' && !result.quote.manualReasons.some((reason) => reason.code.includes('NOT_FOUND'))) {
      throw new Error(`${entry.id}: 未实际覆盖缺价转人工`);
    }
    if (entry.coverage === 'zero-price' || entry.coverage === 'four-decimal') {
      const pattern = entry.coverage === 'zero-price' ? /^0(?:\.0+)?$/ : /\.\d{3}[1-9]$/;
      const hit = result.input.items.some((item) => item.craft === 'PARTIAL' &&
        result.quote.items.some((quoted) => quoted.itemKey === item.itemKey && quoted.unitPrice !== null && pattern.test(quoted.unitPrice) &&
          quoted.lines.some((line) => line.code === 'PARTIAL_BLANK' && line.amount !== null)));
      if (!hit) throw new Error(`${entry.id}: 未实际命中${entry.coverage}空白封单价`);
    }
    results.push({ id: entry.id, input: result.input, quote: result.quote, processing: result.processing });
  }
  return { format: 1, provenance: { revision, database: metadata[0]!.database, capturedAt: metadata[0]!.capturedAt.toISOString() },
    at: at.toISOString(), casesDigest: comparisonDigest(cases), dataDigest: comparisonDigest(tables),
    catalog: { options, papers: choices }, results };
}
