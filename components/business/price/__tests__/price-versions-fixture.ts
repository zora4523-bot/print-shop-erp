import { CustomerPriceBookPurpose, CustomerPriceCalculationType } from '@/generated/prisma/enums';
import type { CustomerPriceBookDraftAdminDto, CustomerPriceBookDraftPublishPreviewDto, CustomerPriceBookVersionAdminDto } from '@/lib/price/customer-price-book-admin';

export const versionDraft: CustomerPriceBookDraftAdminDto = {
  id: 'draft-ui', code: 'test-processing', name: '客户加工费', purpose: CustomerPriceBookPurpose.PROCESSING,
  version: 10, basedOn: { id: 'current-ui', code: 'test-processing', version: 9 },
  changeReason: '调整专版单价', createdBy: 'owner', createdAt: '2026-09-13T01:00:00Z',
  updatedAt: '2026-09-13T02:00:00Z', ruleSetSha256: null, categories: [], products: [], rules: [],
};
export const versionList: CustomerPriceBookVersionAdminDto[] = [
  { id: 'current-ui', code: 'test-processing', name: '客户加工费', purpose: CustomerPriceBookPurpose.PROCESSING,
    version: 9, status: 'CURRENT', effectiveFrom: '2026-09-12T01:00:00Z', effectiveTo: null,
    ruleCount: 150, basedOnVersion: 8, basedOnBookId: 'old-ui', changeReason: '调整专版单价',
    publishNote: null, ruleSetSha256: null, createdById: 'owner', workflowCreatedAt: null,
    scheduleChangeReason: null, scheduleChangedAt: null, updatedAt: versionDraft.updatedAt },
];
versionList.push({ ...versionList[0]!, id: versionDraft.id, version: 10, status: 'DRAFT', basedOnVersion: 9 });
versionList.push({ ...versionList[0]!, id: 'logistics-ui', purpose: CustomerPriceBookPurpose.LOGISTICS, version: 2 });

export function versionPreview(state: 'ready' | 'empty' | 'invalid' | 'risk' = 'ready'): CustomerPriceBookDraftPublishPreviewDto {
  const empty = state === 'empty';
  return {
    priceBookId: versionDraft.id, purpose: versionDraft.purpose, version: 10, basedOnVersion: 9,
    totalRuleCount: 150, activeRuleCount: 150, changedItemCount: empty ? 0 : 1, changedRuleCount: empty ? 0 : 1,
    increasedRuleCount: empty ? 0 : 1, decreasedRuleCount: 0, highRiskRuleCount: state === 'risk' ? 1 : 0,
    highRiskDeltaPercentThreshold: '50', deltaPercentMin: empty ? null : '0.03', deltaPercentMax: empty ? null : '0.03',
    changes: empty ? [] : [{ draftRuleId: null, name: '专版大号', productName: '专版大号', categoryName: '专版烫金',
      quantityLabel: '1,000–1,999 个', calculationType: CustomerPriceCalculationType.PER_PIECE,
      current: { amount: '0.325', includedUnits: null, incrementUnits: null, incrementAmount: null, isActive: true },
      draft: { amount: '0.3251', includedUnits: null, incrementUnits: null, incrementAmount: null, isActive: true },
      changedFields: ['单价'], direction: 'UP', deltaAmount: '0.0001', deltaPercent: '0.03' }],
    validation: state === 'invalid' ? { status: 'FAIL', issues: [{ path: 'rules', message: '数量范围重叠，请调整后重试' }] }
      : empty ? { status: 'FAIL', issues: [{ path: 'rules', message: '草稿与当前版本没有价格或规则变化，无需发布' }] }
      : { status: 'PASS', issues: [] },
  };
}
