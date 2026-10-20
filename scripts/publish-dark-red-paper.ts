import { loadEnvConfig } from '@next/env';
import Decimal from 'decimal.js';
import { DARK_RED_PAPER_RELEASE as release } from '../lib/price/dark-red-paper-release';
import { canonicalizeCreateOrderPaperFact } from '../lib/price/create-order/canonical-facts';

loadEnvConfig(process.cwd());

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply' && !arg.startsWith('--actor=')) ||
      args.filter(arg => arg === '--apply').length > 1 ||
      args.filter(arg => arg.startsWith('--actor=')).length > 1) {
    throw new Error('参数仅支持 --apply 和 --actor=<管理员用户名>，每项只能指定一次');
  }
  const apply = args.includes('--apply');
  const username = args.find(arg => arg.startsWith('--actor='))?.slice(8).trim();
  const { db } = await import('../lib/db');
  const admin = await import('../lib/price/customer-price-book-admin');
  const { readPublishedCreateOrderPriceSnapshot } =
    await import('../lib/order/create-order-published-rule-adapter');
  try {
    const actor = username ? await db.user.findUnique({
      where: { username },
      select: { id: true, username: true, role: true, displayName: true, isActive: true },
    }) : null;
    if (apply && (!actor?.isActive || actor.role !== 'ADMIN')) {
      throw new Error('--apply 必须指定启用的管理员：--actor=<管理员用户名>');
    }
    const snapshot = await db.$transaction(tx => readPublishedCreateOrderPriceSnapshot(tx));
    const paper = canonicalizeCreateOrderPaperFact(release.paperType)!;
    const surcharge = snapshot.full.paperSurcharges.find(row =>
      row.paperType === paper.paperType && row.paperWeightGsm === paper.paperWeightGsm);
    if (surcharge) {
      if (surcharge.unitSurcharge === null || !new Decimal(surcharge.unitSurcharge).eq(release.unitSurcharge)) {
        throw new Error('当前暗红专版加价与发布清单不同，请先核对');
      }
      process.stdout.write(`${JSON.stringify({
        status: 'ALREADY_PUBLISHED', ...snapshot.priceVersion.processing,
      })}\n`);
      return;
    }
    const versions = await admin.listCustomerPriceBookVersionsAndDrafts();
    if (versions.some(book => book.purpose === 'PROCESSING' && book.status === 'SCHEDULED')) {
      throw new Error('已有待生效加工费版本，请先处理其生效安排');
    }
    const draft = versions.find(book => book.purpose === 'PROCESSING' && book.status === 'DRAFT');
    if (!apply) {
      process.stdout.write(`${JSON.stringify({
        status: 'PREVIEW', currentVersion: snapshot.priceVersion.processing.version,
        draftVersion: draft?.version ?? null, release,
      }, null, 2)}\n`);
      return;
    }
    if (!actor) throw new Error('缺少管理员账号');
    const target = draft ?? await admin.createCustomerPriceBookDraft({
      purpose: 'PROCESSING', changeReason: '160g暗红珠光纸专版烫金每个加价0.03元',
    }, actor);
    const fresh = await db.customerPriceBook.findUniqueOrThrow({ where: { id: target.id } });
    const prepared = await admin.prepareConfirmedDarkRedPaperDraft({
      priceBookId: target.id, expectedDraftUpdatedAt: fresh.updatedAt,
    }, actor);
    const published = await admin.publishCustomerPriceBookDraft({
      priceBookId: prepared.id, expectedDraftUpdatedAt: prepared.updatedAt,
      confirmedHighRisk: true, publishNote: release.source,
    }, actor);
    process.stdout.write(`${JSON.stringify({ status: 'PUBLISHED', ...published })}\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : '暗红专版价格发布失败'}\n`);
  process.exitCode = 1;
});
