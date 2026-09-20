/** Invoked only by the isolated Playwright process, with react-server conditions. */
import { randomUUID } from 'node:crypto';
import { comparisonDigest } from '../../scripts/lib/paper-spec-comparison';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';

async function main() {
  const target = assertActivatedE2eDatabase();
  const { db } = await import('../../lib/db');
  try {
    const identity = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    if (identity[0]?.name !== target.databaseName) throw new Error('Fixture database mismatch');
    const { enableBlankSpecifications } = await import('../../lib/price/enable-blank-specifications');
    const { readPaperSpecifications } = await import('../../lib/price/read-paper-specifications');
    const { listExternalCreateOrderOptions } = await import('../../lib/order/create-order-options');
    const { buildExternalOrderPapers } = await import('../../lib/order/order-item-catalog');
    const actor = await db.user.findUniqueOrThrow({ where: { username: 'e2e-owner' } });
    const command = JSON.parse(process.argv[2]!) as { op: string; paperId?: string; productId?: string; name?: string; kind?: string; ids?: string[] };
    const paperId = command.paperId ?? '';
    if (command.op === 'setup') {
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      // Own classification prerequisite; no dependency on master-data-flow's category creation.
      const node = await db.productCategoryNode.upsert({ where: { path: 'product.blank_stock' }, update: {},
        create: { id: 'cat_blank_stock', path: 'product.blank_stock', name: '空白封', legacyCategory: 'BLANK_STOCK' } });
      const otherNodes = await db.product.count({ where: { category: 'BLANK_STOCK', isActive: true, categoryNodeId: { not: node.id } } });
      if (otherNodes || !node.isActive) throw new Error('Isolated fixture requires one active blank node; reset disposable test data');
      const paper = await db.material.create({ data: { code: `PS-${suffix}`, name: `160g验收纸${suffix}`, specification: '160g', category: 'PAPER', unit: '张' } });
      const product = await db.product.create({ data: { code: `PS-LEGACY-LONG-CODE-${suffix}-OVER-32`, name: paper.name,
        category: 'BLANK_STOCK', categoryNodeId: node.id, specification: '中号封80×115', paperType: paper.name, weight: 160 } });
      return { paperId: paper.id, productId: product.id, name: paper.name, nodeId: node.id };
    }
    if (command.op === 'state') {
      const paper = await db.material.findUniqueOrThrow({ where: { id: paperId } });
      const products = await db.product.findMany({ where: { paperType: { contains: paper.name } }, orderBy: { id: 'asc' } });
      const audits = await db.businessAuditLog.findMany({ where: { entityId: { in: products.map((row) => row.id) } }, orderBy: { id: 'asc' } });
      const prices = await Promise.all([db.customerPriceBook.findMany({ orderBy: { id: 'asc' } }), db.customerPriceRule.findMany({ orderBy: { id: 'asc' } })]);
      return { products, audits, priceDigest: comparisonDigest(prices), view: await readPaperSpecifications(paperId) };
    }
    if (command.op === 'catalog') {
      const options = await listExternalCreateOrderOptions();
      return { options, papers: buildExternalOrderPapers(options.products, options.papers) };
    }
    if (command.op === 'enable') {
      return await enableBlankSpecifications({ paperId, specifications: ['mid'] }, actor);
    }
    if (command.op === 'quote') {
      const { calculateCreateOrderQuoteFromCatalogInTx } = await import('../../lib/order/create-order-quote-service');
      const paper = await db.material.findUniqueOrThrow({ where: { id: paperId } });
      const full = command.kind === 'full';
      const product = await db.product.findUniqueOrThrow({ where: { id: command.productId } });
      const craft = await db.craft.findUniqueOrThrow({ where: { code: full ? 'FLAT_FOIL_SINGLE' : 'FLAT_FOIL_PARTIAL' } });
      const result = await db.$transaction((tx) => calculateCreateOrderQuoteFromCatalogInTx(tx, { now: new Date(), includeOrderCharges: true,
        facts: { items: [{ itemKey: 'item', fig: 1, productId: product.id,
          pricingRoute: full ? 'CUSTOM_SINGLE_FLAT_FOIL' : 'STOCK_BLANK', specification: product.specification,
          actualWidthMm: 80, actualHeightMm: 115, paperType: paper.name, paperWeightGsm: 160,
          quantity: 2000, crafts: [craft.id], frontFoilColors: ['哑金'], backFoilColors: [],
          foilTechnique: 'FLAT', hasLocalFoil: !full, lamination: 'NONE' }],
        packagingGroups: [], isSfCollect: true, shipments: [{ shipmentKey: 'shipment', province: '广东', itemQuantities: { item: 2000 } }] } }));
      return { input: result.input, quote: result.quote, processing: result.processing };
    }
    if (command.op === 'full-product') {
      const node = await db.productCategoryNode.upsert({ where: { path: 'product.custom_flat_foil' }, update: {},
        create: { path: 'product.custom_flat_foil', name: '专版', legacyCategory: 'CUSTOM_FLAT_FOIL' } });
      const product = await db.product.create({ data: { code: `PS-FULL-${randomUUID()}`, name: '专版验收中号', category: 'CUSTOM_FLAT_FOIL',
        categoryNodeId: node.id, specification: '中号封80×115' } });
      return { productId: product.id };
    }
    if (command.op === 'publish-price') {
      const admin = await import('../../lib/price/customer-price-book-admin');
      const versions = await admin.listCustomerPriceBookVersionsAndDrafts();
      if (versions.some((v) => v.purpose === 'PROCESSING' && v.status === 'DRAFT')) throw new Error('Fixture requires no competing processing draft');
      const draft = await admin.createCustomerPriceBookDraft({ purpose: 'PROCESSING', changeReason: '隔离验收启用规格' }, actor);
      const before = await db.customerPriceBook.findUniqueOrThrow({ where: { id: draft.id } });
      await admin.addBlankPaperDraft({ priceBookId: draft.id, expectedUpdatedAt: before.updatedAt.toISOString(),
        paper: { mode: 'existing', id: paperId }, specifications: [{ key: 'mid', amount: command.kind === 'zero' ? '0' : '0.1234' }] }, actor);
      const updated = await db.customerPriceBook.findUniqueOrThrow({ where: { id: draft.id } });
      await admin.publishCustomerPriceBookDraft({ priceBookId: draft.id, expectedDraftUpdatedAt: updated.updatedAt, confirmedHighRisk: true }, actor);
      return { draftId: draft.id };
    }
    if (command.op === 'anomaly') {
      const product = await db.product.findUniqueOrThrow({ where: { id: command.productId } });
      const row = await db.product.create({ data: { name: product.name, category: product.category, categoryNodeId: product.categoryNodeId,
        paperType: product.paperType, weight: product.weight, paperMaterialId: product.paperMaterialId, code: `PS-${randomUUID()}`,
        specification: command.kind === 'duplicate' ? product.specification : command.kind === 'multi' ? '中号封80×115 / 大号封90×165' : '中号封80x115',
        isActive: true } });
      return row;
    }
    if (command.op === 'remove-priced-fixture') {
      const product = await db.product.findUniqueOrThrow({ where: { id: command.productId } });
      const anchor = await db.product.findUniqueOrThrow({ where: { id: command.ids?.[0] } });
      if (!product.code?.startsWith('PS-') || !anchor.code?.startsWith('PS-')) throw new Error('Not an owned fixture');
      // Arrange a legacy text-matched rule whose product reference points elsewhere.
      // This is fixture setup only; runtime operations must not rewrite published rules.
      await db.$transaction(async (tx) => {
        await tx.customerPriceRule.updateMany({ where: { productId: product.id }, data: { productId: anchor.id } });
        await tx.product.delete({ where: { id: product.id } });
      });
      return { removed: product.id };
    }
    if (command.op === 'deactivate-fixture') {
      // Only IDs generated by this spec; bypass is deliberate to arrange legacy fixtures.
      const ids = command.ids ?? [];
      const rows = await db.product.findMany({ where: { id: { in: ids } } });
      if (rows.length !== ids.length || rows.some((row) => !row.code?.startsWith('PS-'))) throw new Error('Not an owned fixture');
      await db.product.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
      return { count: rows.length };
    }
    if (command.op === 'duplicate') {
      const { createProduct, updateProduct } = await import('../../lib/product');
      const product = await db.product.findUniqueOrThrow({ where: { id: command.productId } });
      const input = { code: `PS-${randomUUID().slice(0, 12)}`, name: '重复验收', categoryNodeId: product.categoryNodeId,
        specification: product.specification, paperType: product.paperType, baseUnitPrice: null };
      if (command.kind !== 'move' && command.kind !== 'prepare-move') return await createProduct(input);
      const node = await db.productCategoryNode.create({ data: { path: `ps_${randomUUID().replaceAll('-', '')}`, name: '测试其他类', legacyCategory: 'GENERIC_STOCK' } });
      const row = await db.product.create({ data: { ...input, categoryNodeId: node.id, category: 'GENERIC_STOCK' } });
      if (command.kind === 'prepare-move') return { productId: row.id };
      return await updateProduct(row.id, input);
    }
    throw new Error('Unknown paper specification command');
  } finally { await db.$disconnect(); }
}
main().then((result) => process.stdout.write(`${JSON.stringify({ result })}\n`)).catch((error: unknown) => {
  process.stdout.write(`${JSON.stringify({ error: error instanceof Error ? error.message : 'Fixture failed' })}\n`);
  process.exitCode = 1;
});
