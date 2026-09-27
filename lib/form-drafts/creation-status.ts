import { createBomSchema, createPurchaseOrderSchema } from '@/lib/auth/schemas';
import { db } from '@/lib/db';
import { bomDraftSchema, purchaseDraftSchema, type FormKind } from './model';
import { bomCreationFacts, purchaseCreationFacts } from './creation-facts';
import { creationPayloadHash } from './creation-request';
import { BLANK_SPECIFICATIONS } from '@/lib/price/blank-paper';

export function draftCreationFacts(kind: FormKind, raw: unknown) {
  if (kind === 'purchase-new') {
    const payload = purchaseDraftSchema.safeParse(raw);
    if (!payload.success) return null;
    const parsed = createPurchaseOrderSchema.safeParse(payload.data);
    return parsed.success ? purchaseCreationFacts(parsed.data) : null;
  }
  const payload = bomDraftSchema.safeParse(raw);
  if (!payload.success) return null;
  const parsed = createBomSchema.safeParse({ ...payload.data, items: payload.data.rows.filter((row) => row.materialId || row.quantity || row.remark) });
  return parsed.success ? bomCreationFacts(parsed.data) : null;
}

const labels: Record<string, string> = {
  supplierPartyId: '供应商', materialId: '物料', quantity: '数量', unitCost: '单位成本', expectedDate: '预计到货日', remark: '备注',
  targetType: '适用对象', productId: '其他产品', categoryNodeId: '产品结构分类', blankPaperMaterialId: '纸张',
  blankSpecificationKey: '规格', name: '用料清单名称', version: '版本号', baseQuantity: '基准产量', items: '物料行',
};
const targetLabels: Record<string, string> = { BLANK: '空白封纸张与规格', PRODUCT: '其他产品', CATEGORY: '产品结构分类' };
export type CreationDifference = { label: string; before: string; after: string };

/** Authorized caller only. Resolve display names freshly, never include them in the hash. */
export async function describeCreationDifferences(kind: FormKind, previous: unknown, payloadHash: string, raw: unknown): Promise<CreationDifference[]> {
  const next = draftCreationFacts(kind, raw);
  if (next && creationPayloadHash(next) === payloadHash) return [];
  if (!next || !previous || typeof previous !== 'object' || Array.isArray(previous)) {
    return [{ label: '录入内容', before: '已保存的单据', after: '当前内容尚未填写完整，请查看原单据' }];
  }
  const old = previous as Record<string, unknown>;
  async function describe(key: string, value: unknown): Promise<string> {
    if (value === null || value === undefined || value === '') return '未填写';
    if (key === 'targetType') return targetLabels[String(value)] ?? '未填写';
    if (key === 'blankSpecificationKey') return BLANK_SPECIFICATIONS.find((spec) => spec.key === value)?.specification ?? '原规格已不可用';
    if (key === 'supplierPartyId') return (await db.party.findUnique({ where: { id: String(value) }, select: { name: true } }))?.name ?? '原供应商已不可用';
    if (key === 'materialId' || key === 'blankPaperMaterialId') return (await db.material.findUnique({ where: { id: String(value) }, select: { name: true } }))?.name ?? '原物料已不可用';
    if (key === 'productId') return (await db.product.findUnique({ where: { id: String(value) }, select: { name: true } }))?.name ?? '原产品已不可用';
    if (key === 'categoryNodeId') return (await db.productCategoryNode.findUnique({ where: { id: String(value) }, select: { name: true } }))?.name ?? '原分类已不可用';
    if (key === 'items' && Array.isArray(value)) return (await Promise.all(value.map(async (row) => {
      if (!row || typeof row !== 'object') return '';
      return `${await describe('materialId', row.materialId)} × ${row.quantity}${row.remark ? `（${row.remark}）` : ''}`;
    }))).join('；');
    return String(value);
  }
  const changes: CreationDifference[] = [];
  for (const [key, value] of Object.entries(next)) {
    if (JSON.stringify(old[key]) !== JSON.stringify(value)) changes.push({ label: labels[key] ?? '录入内容', before: await describe(key, old[key]), after: await describe(key, value) });
  }
  return changes;
}
