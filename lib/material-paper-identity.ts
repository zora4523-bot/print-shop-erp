import type { Prisma } from '../generated/prisma/client';
import { MaterialCategory, ProductCategory } from '../generated/prisma/enums';
import { catalogPaperIdentityKeys } from './order/catalog-paper-identity';

type PaperIdentityInput = {
  category: MaterialCategory;
  name: string;
  specification: string | null;
};
type IdentityReadClient = Pick<Prisma.TransactionClient, 'material' | 'product' | 'customerPriceRule' | 'billOfMaterial' | 'orderItem'>;

const DUPLICATE_MESSAGE = '同名同克重纸张已存在，请在纸张管理中使用或检查原记录';
const REFERENCED_MESSAGE = '纸张身份仍被产品、价格、用料或历史订单引用，名称、克重或分类不可直接修改';

function identityKeys(paper: PaperIdentityInput | null): Set<string> {
  return paper?.category === MaterialCategory.PAPER ? catalogPaperIdentityKeys(paper) : new Set();
}

function rulePaperIdentityKeys(condition: unknown): Set<string> {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return new Set();
  const paperTypes = (condition as Record<string, unknown>).paperTypes;
  if (!Array.isArray(paperTypes)) return new Set();
  // Reference protection must not disappear because an unrelated condition field is invalid.
  return new Set(paperTypes.flatMap((name) => typeof name === 'string'
    ? [...catalogPaperIdentityKeys({ name, specification: null })] : []));
}

/** Caller holds acquirePriceRuleSnapshotWriteLock for this read and the ensuing mutation.
 * Existing FK protection remains at the update entry point, including empty identities.
 */
export async function paperIdentityMutationError(
  tx: IdentityReadClient,
  next: PaperIdentityInput,
  previous: (PaperIdentityInput & { id: string }) | null = null,
): Promise<string | null> {
  const oldKeys = identityKeys(previous);
  const newKeys = identityKeys(next);
  const removed = [...oldKeys].filter((key) => !newKeys.has(key));
  const added = [...newKeys].filter((key) => !oldKeys.has(key));
  if (!removed.length && !added.length && previous?.category === next.category) return null;
  if (previous && (removed.length || previous.category !== next.category) &&
      await tx.billOfMaterial.count({ where: { blankPaperMaterialId: previous.id } }) > 0) return REFERENCED_MESSAGE;
  if (!oldKeys.size && !newKeys.size) return null;

  const papers = await tx.material.findMany({
    where: { category: MaterialCategory.PAPER, ...(previous ? { id: { not: previous.id } } : {}) },
    select: { name: true, specification: true },
  });
  const remainingKeys = new Set(papers.flatMap((paper) => [...catalogPaperIdentityKeys(paper)]));
  const entersPaper = next.category === MaterialCategory.PAPER && previous?.category !== MaterialCategory.PAPER;
  if ((added.length || entersPaper) && [...newKeys].some((key) => remainingKeys.has(key))) return DUPLICATE_MESSAGE;

  // Removing one duplicate is safe only while another PAPER still represents the identity.
  const protectedKeys = new Set(removed.filter((key) => !remainingKeys.has(key)));
  if (!protectedKeys.size) return null;
  const products = await tx.product.findMany({
    where: { category: { in: [ProductCategory.BLANK_STOCK, ProductCategory.COLOR_PRINT] } },
    select: { paperType: true, weight: true },
  });
  if (products.some((product) => [...catalogPaperIdentityKeys({
    name: product.paperType ?? '',
    specification: product.weight === null ? null : `${product.weight}g`,
  })].some((key) => protectedKeys.has(key)))) return REFERENCED_MESSAGE;

  const rules = await tx.customerPriceRule.findMany({
    select: { triggerCondition: true },
  });
  if (rules.some((rule) => [...rulePaperIdentityKeys(rule.triggerCondition)]
    .some((key) => protectedKeys.has(key)))) return REFERENCED_MESSAGE;

  const historicalItems = await tx.orderItem.findMany({
    where: { paperType: { not: null } }, select: { paperType: true, paperWeightGsm: true },
  });
  return historicalItems.some((item) => [...catalogPaperIdentityKeys({
    name: item.paperType ?? '', specification: item.paperWeightGsm === null ? null : `${item.paperWeightGsm}g`,
  })].some((key) => protectedKeys.has(key))) ? REFERENCED_MESSAGE : null;
}
