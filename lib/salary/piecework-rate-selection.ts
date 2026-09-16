import type { Prisma } from '../../generated/prisma/client';
import type { PieceworkOperationType, PieceworkRateUnit } from '../../generated/prisma/enums';
import { PieceworkPricingError } from './piecework-pricing';

export async function resolveReporterPieceworkRate(tx: Prisma.TransactionClient, workerId: string, operationType: PieceworkOperationType, unit: PieceworkRateUnit, at: Date) {
  const books = await tx.pieceworkPriceBook.findMany({
    where: { status: 'PUBLISHED', effectiveFrom: { lte: at }, AND: [
      { OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
      { OR: [{ workerId: null }, { workerId }] },
    ] },
    select: { id: true, workerId: true, useUnifiedRates: true, version: true, ruleSetSha256: true,
      rules: { where: { operationType, unit }, select: { operationType: true, unit: true, amount: true, smallOrderAmount: true, setupAmount: true } },
    },
  });
  const personal = books.filter((b) => b.workerId === workerId);
  const unified = books.filter((b) => b.workerId == null);
  if (personal.length > 1 || unified.length > 1) throw new PieceworkPricingError('PIECEWORK_RATE_UNAVAILABLE', '生效工价存在冲突，请联系管理员核对');
  const policy = personal[0];
  const book = policy && !policy.useUnifiedRates ? policy : unified[0];
  const rule = book?.rules[0];
  if (!book?.ruleSetSha256 || book.rules.length !== 1 || !rule || rule.amount === null || rule.unit !== unit) {
    throw new PieceworkPricingError('PIECEWORK_RATE_UNAVAILABLE', policy && !policy.useUnifiedRates ? '个人工价未配置当前工序，请联系管理员调整账号工价' : '当前工序的统一工价未发布，请联系管理员配置');
  }
  return { book: { ...book, ruleSetSha256: book.ruleSetSha256 }, rule: { ...rule, amount: rule.amount }, policy, key: `${book.id}:${policy?.id ?? 'unified'}`, source: book.workerId ? 'PERSONAL' as const : 'UNIFIED' as const };
}
