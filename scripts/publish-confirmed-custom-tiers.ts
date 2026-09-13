import { loadEnvConfig } from '@next/env';
import release from '../config/customer-price-books/custom-tiers-20260913.json';

// Explicit CLI release: no price constants are consulted by runtime quotation.
loadEnvConfig(process.cwd());

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply' && !arg.startsWith('--actor='))) {
    throw new Error('参数仅支持 --apply 和 --actor=<管理员用户名>');
  }
  const apply = args.includes('--apply');
  const username = args.find(arg => arg.startsWith('--actor='))?.slice(8).trim();
  const { db } = await import('../lib/db');
  const admin = await import('../lib/price/customer-price-book-admin');
  try {
    const versions = await admin.listCustomerPriceBookVersionsAndDrafts();
    const current = versions.find(book => book.purpose === 'PROCESSING' && book.status === 'CURRENT');
    if (!current) throw new Error('当前加工费价目版本不存在');
    const book = await db.customerPriceBook.findUniqueOrThrow({ where: { id: current.id } });
    const notes = book.notes as Record<string, unknown> | null;
    if (notes?.ruleVersion === release.version) {
      console.log(JSON.stringify({ status: 'ALREADY_PUBLISHED', id: book.id, version: book.version }));
      return;
    }
    const draft = versions.find(book => book.purpose === 'PROCESSING' && book.status === 'DRAFT');
    console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'PREVIEW', currentVersion: current.version,
      draftVersion: draft?.version ?? null, ...release }, null, 2));
    if (!apply) return;
    if (!username) throw new Error('--apply 必须指定 --actor=<管理员用户名>');
    const actor = await db.user.findUnique({ where: { username }, select: {
      id: true, username: true, role: true, displayName: true, isActive: true,
    } });
    if (!actor?.isActive || actor.role !== 'ADMIN') throw new Error('需要有效的管理员账号');
    const target = draft ?? await admin.createCustomerPriceBookDraft({
      purpose: 'PROCESSING', changeReason: '按确认报价表补齐200个档，采用达到档位取价',
    }, actor);
    const snapshot = await db.customerPriceBook.findUniqueOrThrow({ where: { id: target.id } });
    const prepared = await admin.prepareConfirmedCustomTierDraft({
      priceBookId: target.id, expectedDraftUpdatedAt: snapshot.updatedAt,
    }, actor);
    const published = await admin.publishCustomerPriceBookDraft({
      priceBookId: prepared.id, expectedDraftUpdatedAt: prepared.updatedAt,
      confirmedHighRisk: true, publishNote: '2026-09-13 用户确认：按达到档位取价，补齐200个档并保留三位小数单价',
    }, actor);
    console.log(JSON.stringify({ status: 'PUBLISHED', ...published }));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '专版阶梯更新失败');
  process.exitCode = 1;
});
