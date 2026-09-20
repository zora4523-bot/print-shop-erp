import { findCatalogPaperIdentityMatches } from '../order/catalog-paper-identity';
import { BOX_PRICE_RULES, CONFIRMED_BOX_RATES } from './box-packaging-rules';
import 'server-only';

import { createHash } from 'node:crypto';
import {
  addBlankPaperSchema,
  blankPaperFact,
  blankSpecificationKey,
  BLANK_SPECIFICATIONS,
  type AddBlankPaperInput,
} from './blank-paper';
import { canonicalizeCreateOrderPaperFact } from './create-order/canonical-facts';
import { fixedCustomTierIssue } from './fixed-custom-tiers';
import customTierRelease from '../../config/customer-price-books/custom-tiers-20260913.json';
import {
  Prisma,
  type CustomerPriceCalculationType,
  type CustomerPriceRuleKind,
} from '../../generated/prisma/client';
import {
  CustomerPriceBookPurpose,
  OrderSettlementType,
} from '../../generated/prisma/enums';
import { writeAuditLogInTx, type AuditActor } from '../audit-log';
import { db } from '../db';
import {
  PublishedCreateOrderPriceAdapterError,
  readCandidatePublishedCreateOrderPriceProjection,
} from '../order/create-order-published-rule-adapter';
import {
  validateDraftPriceBookRules,
  type DraftPriceBookValidationIssue,
  type DraftPriceRuleForValidation,
} from './customer-price-book-draft-validation';
import {
  customerPriceSectionOwnsRule,
  type CustomerPriceSection,
} from './customer-price-section-membership';
import {
  acquirePriceRuleSnapshotReadLock,
  acquirePriceRuleSnapshotWriteLock,
} from './rule-snapshot-lock';
import {
  buildCustomerRuleCondition,
  customerRuleConditionEditorInput,
  parseCustomerRuleCondition,
  type CustomerRuleConditionEditorInput,
} from './customer-rule-condition';

const EXTERNAL_SETTLEMENT = OrderSettlementType.EXTERNAL_SALES;

type DraftWorkflow = {
  status: 'DRAFT';
  basedOn: {
    id: string;
    code: string;
    version: number;
  };
  createdBy: string;
  createdAt: string;
  changeReason: string;
  lastEditedBy?: string;
  lastEditedAt?: string;
  ruleSetSha256?: string;
};

export type CustomerPriceBookVersionAdminDto = {
  id: string;
  code: string;
  name: string;
  purpose: CustomerPriceBookPurpose;
  version: number;
  status: 'DRAFT' | 'CURRENT' | 'SCHEDULED' | 'CANCELLED' | 'HISTORICAL';
  effectiveFrom: string;
  effectiveTo: string | null;
  ruleCount: number;
  basedOnVersion: number | null;
  basedOnBookId: string | null;
  changeReason: string | null;
  publishNote: string | null;
  ruleSetSha256: string | null;
  createdById: string | null;
  workflowCreatedAt: string | null;
  scheduleChangeReason: string | null;
  scheduleChangedAt: string | null;
  updatedAt: string;
};

export type CustomerPriceRuleDraftAdminDto = {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  kind: CustomerPriceRuleKind;
  calculationType: CustomerPriceCalculationType | null;
  amount: string | null;
  includedUnits: string | null;
  incrementUnits: string | null;
  incrementAmount: string | null;
  minQty: number | null;
  maxQty: number | null;
  triggerCondition: unknown;
  exclusiveGroup: string | null;
  priority: number;
  note: string | null;
  blocksAutomaticQuote: boolean;
  isActive: boolean;
  source: {
    name: string | null;
    sha256: string | null;
    sheet: string | null;
    range: string | null;
  };
  updatedAt: string;
};

export type CustomerPriceBookDraftAdminDto = {
  id: string;
  code: string;
  name: string;
  purpose: CustomerPriceBookPurpose;
  version: number;
  basedOn: DraftWorkflow['basedOn'];
  changeReason: string;
  createdBy: string;
  createdAt: string;
  ruleSetSha256: string | null;
  updatedAt: string;
  categories: Array<{ id: string; code: string; name: string }>;
  products: Array<{ id: string; code: string; name: string }>;
  rules: CustomerPriceRuleDraftAdminDto[];
};

export type CustomerPriceBookDraftImpactPriceDto = {
  amount: string | null;
  includedUnits: string | null;
  incrementUnits: string | null;
  incrementAmount: string | null;
  isActive: boolean;
};

export type CustomerPriceBookDraftImpactChangeDto = {
  draftRuleId: string | null;
  name: string;
  categoryName: string;
  productName: string | null;
  quantityLabel: string;
  calculationType: CustomerPriceCalculationType | null;
  current: CustomerPriceBookDraftImpactPriceDto | null;
  draft: CustomerPriceBookDraftImpactPriceDto | null;
  changedFields: string[];
  direction: 'UP' | 'DOWN' | 'MIXED' | 'OTHER' | 'ADDED' | 'REMOVED';
  deltaAmount: string | null;
  deltaPercent: string | null;
};

export type CustomerPriceBookDraftPublishPreviewDto = {
  priceBookId: string;
  purpose: CustomerPriceBookPurpose;
  version: number;
  basedOnVersion: number;
  totalRuleCount: number;
  activeRuleCount: number;
  changedItemCount: number;
  changedRuleCount: number;
  increasedRuleCount: number;
  decreasedRuleCount: number;
  /**
   * A high-risk change is not forbidden. It requires a separate acknowledgement
   * because a misplaced decimal can otherwise pass structural validation.
   */
  highRiskRuleCount: number;
  highRiskDeltaPercentThreshold: string;
  deltaPercentMin: string | null;
  deltaPercentMax: string | null;
  changes: CustomerPriceBookDraftImpactChangeDto[];
  validation: {
    status: 'PASS' | 'FAIL';
    issues: DraftPriceBookValidationIssue[];
  };
};

export type CustomerPriceRuleDraftEditorMode =
  | 'PROCESSING'
  | 'SHIPPING'
  | 'PACKAGING';

/**
 * Safe DTO for the client-side rule editor. Imported provenance and raw JSON
 * never cross the boundary; matching is projected into a closed typed shape.
 */
export type CustomerPriceRuleDraftEditorDto = {
  context: {
    id: string;
    purpose: CustomerPriceBookPurpose;
    categories: Array<{ id: string; name: string }>;
    products: Array<{ id: string; name: string }>;
    crafts: Array<{ value: string; label: string }>;
  };
  rule: {
    id: string;
    name: string;
    categoryId: string;
    categoryName: string;
    productId: string | null;
    kind: CustomerPriceRuleKind;
    calculationType: CustomerPriceCalculationType | null;
    unitsPerSheet: number | null;
    match: CustomerRuleConditionEditorInput;
    matchValidationErrors: string[];
    amount: string | null;
    includedUnits: string | null;
    incrementUnits: string | null;
    incrementAmount: string | null;
    minQty: number | null;
    maxQty: number | null;
    blocksAutomaticQuote: boolean;
    isActive: boolean;
    editorMode: CustomerPriceRuleDraftEditorMode;
    shippingScopeLabel: string | null;
    updatedAt: string;
  };
};

export type CreateCustomerPriceBookDraftInput = {
  purpose: CustomerPriceBookPurpose;
  changeReason: string;
};

export type UpdateCustomerPriceRuleDraftInput = {
  priceBookId: string;
  ruleId: string;
  expectedUpdatedAt: Date;
  name: string;
  amount: string | null;
  isActive: boolean;
  categoryId?: string;
  productId?: string | null;
  kind?: CustomerPriceRuleKind;
  calculationType?: CustomerPriceCalculationType | null;
  unitsPerSheet?: number | null;
  minQty?: number | null;
  maxQty?: number | null;
  blocksAutomaticQuote?: boolean;
  match?: CustomerRuleConditionEditorInput;
  includedUnits?: string | null;
  incrementUnits?: string | null;
  incrementAmount?: string | null;
};

export type UpdateCustomerPriceRuleDraftGroupInput = {
  priceBookId: string;
  anchorRuleId: string;
  rows: Array<{
    ruleId: string;
    expectedUpdatedAt: Date;
    amount: string;
    isActive: boolean;
  }>;
};

export type CustomerPricingSectionId = CustomerPriceSection;

export type UpdateCustomerPriceSectionDraftInput = {
  priceBookId: string;
  section: CustomerPricingSectionId;
  rows: Array<{
    ruleId: string;
    expectedUpdatedAt: Date;
    amount: string | null;
    minQty: number | null;
    maxQty: number | null;
    includedUnits: string | null;
    incrementUnits: string | null;
    incrementAmount: string | null;
  }>;
};

export type PublishCustomerPriceBookDraftInput = {
  priceBookId: string;
  /** Omit for immediate publication at one server-generated canonical instant. */
  effectiveFrom?: Date;
  expectedDraftUpdatedAt: Date;
  /** Empty values inherit the draft's required change reason. */
  publishNote?: string;
  /** Required when the locked current-to-draft comparison detects high risk. */
  confirmedHighRisk?: boolean;
};

export type DiscardCustomerPriceBookDraftInput = {
  priceBookId: string;
  expectedDraftUpdatedAt: Date;
};

export type CancelScheduledCustomerPriceBookInput = {
  priceBookId: string;
  expectedUpdatedAt: Date;
  reason: string;
};

export type RescheduleCustomerPriceBookInput = {
  priceBookId: string;
  expectedUpdatedAt: Date;
  effectiveFrom: Date;
  reason: string;
};

export class CustomerPriceBookAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomerPriceBookAdminError';
  }
}

export class CustomerPriceBookValidationError extends CustomerPriceBookAdminError {
  readonly issues: DraftPriceBookValidationIssue[];

  constructor(issues: DraftPriceBookValidationIssue[]) {
    super('价目簿规则校验未通过');
    this.name = 'CustomerPriceBookValidationError';
    this.issues = issues;
  }
}

export class CustomerPriceBookHighRiskConfirmationError extends CustomerPriceBookAdminError {
  constructor() {
    super('本次调价包含高风险报价变更，请勾选高风险确认后再发布');
    this.name = 'CustomerPriceBookHighRiskConfirmationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveIntegerConditionValue(
  condition: unknown,
  key: string,
): number | null {
  if (!isRecord(condition)) return null;
  const value = condition[key];
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : null;
}

function draftWorkflow(notes: unknown): DraftWorkflow | null {
  if (!isRecord(notes) || !isRecord(notes.workflow)) return null;
  const workflow = notes.workflow;
  if (
    workflow.status !== 'DRAFT' ||
    !isRecord(workflow.basedOn) ||
    typeof workflow.basedOn.id !== 'string' ||
    typeof workflow.basedOn.code !== 'string' ||
    !Number.isSafeInteger(workflow.basedOn.version) ||
    typeof workflow.createdBy !== 'string' ||
    typeof workflow.createdAt !== 'string' ||
    typeof workflow.changeReason !== 'string'
  ) {
    return null;
  }
  return {
    status: 'DRAFT',
    basedOn: {
      id: workflow.basedOn.id,
      code: workflow.basedOn.code,
      version: Number(workflow.basedOn.version),
    },
    createdBy: workflow.createdBy,
    createdAt: workflow.createdAt,
    changeReason: workflow.changeReason,
    ...(typeof workflow.lastEditedBy === 'string'
      ? { lastEditedBy: workflow.lastEditedBy }
      : {}),
    ...(typeof workflow.lastEditedAt === 'string'
      ? { lastEditedAt: workflow.lastEditedAt }
      : {}),
    ...(typeof workflow.ruleSetSha256 === 'string'
      ? { ruleSetSha256: workflow.ruleSetSha256 }
      : {}),
  };
}

function workflowSummary(notes: unknown): {
  basedOnBookId: string;
  basedOnVersion: number;
  changeReason: string;
  publishNote: string | null;
  ruleSetSha256: string | null;
  createdById: string;
  createdAt: string;
} | null {
  if (!isRecord(notes) || !isRecord(notes.workflow)) return null;
  const workflow = notes.workflow;
  if (
    !isRecord(workflow.basedOn) ||
    typeof workflow.basedOn.id !== 'string' ||
    !Number.isSafeInteger(workflow.basedOn.version) ||
    typeof workflow.changeReason !== 'string' ||
    typeof workflow.createdBy !== 'string' ||
    typeof workflow.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    basedOnBookId: workflow.basedOn.id,
    basedOnVersion: Number(workflow.basedOn.version),
    changeReason: workflow.changeReason,
    publishNote:
      typeof workflow.publishNote === 'string' ? workflow.publishNote : null,
    ruleSetSha256:
      typeof workflow.ruleSetSha256 === 'string'
        ? workflow.ruleSetSha256
        : workflow.status === 'PUBLISHED' &&
            typeof notes.ruleSetSha256 === 'string'
          ? notes.ruleSetSha256
          : null,
    createdById: workflow.createdBy,
    createdAt: workflow.createdAt,
  };
}

type ScheduleControl = {
  status: 'RESCHEDULED' | 'CANCELLED';
  changedBy: string;
  changedAt: string;
  reason: string;
  previousEffectiveFrom: string;
  effectiveFrom: string;
};

function scheduleControl(notes: unknown): ScheduleControl | null {
  if (!isRecord(notes) || !isRecord(notes.scheduleControl)) return null;
  const control = notes.scheduleControl;
  if (
    (control.status !== 'RESCHEDULED' && control.status !== 'CANCELLED') ||
    typeof control.changedBy !== 'string' ||
    typeof control.changedAt !== 'string' ||
    typeof control.reason !== 'string' ||
    typeof control.previousEffectiveFrom !== 'string' ||
    typeof control.effectiveFrom !== 'string'
  ) {
    return null;
  }
  return {
    status: control.status,
    changedBy: control.changedBy,
    changedAt: control.changedAt,
    reason: control.reason,
    previousEffectiveFrom: control.previousEffectiveFrom,
    effectiveFrom: control.effectiveFrom,
  };
}

/**
 * Legacy repair migrations preserved superseded scheduled books instead of
 * deleting them, but predate `scheduleControl`. Treat that evidence as a
 * cancelled plan so a version that never became current is not presented as
 * ordinary historical pricing.
 */
function supersededScheduleSummary(notes: unknown): {
  changedAt: string;
  reason: string;
} | null {
  if (
    !isRecord(notes) ||
    typeof notes.supersededAt !== 'string' ||
    typeof notes.supersededByPriceBookId !== 'string'
  ) {
    return null;
  }
  return {
    changedAt: notes.supersededAt,
    reason:
      typeof notes.supersededReason === 'string' &&
      notes.supersededReason.trim().length > 0
        ? notes.supersededReason
        : '已由新的计划版本替代',
  };
}

function notesRecord(notes: unknown): Record<string, unknown> {
  return isRecord(notes) ? { ...notes } : {};
}

function notesInput(notes: Record<string, unknown>): Prisma.InputJsonObject {
  return notes as Prisma.InputJsonObject;
}

function scheduleControlNotes(
  notes: unknown,
  control: ScheduleControl,
): Prisma.InputJsonObject {
  return notesInput({
    ...notesRecord(notes),
    scheduleControl: control,
  });
}

function publishedNotes(
  notes: unknown,
  workflow: DraftWorkflow,
  actor: AuditActor,
  effectiveFrom: Date,
  now: Date,
  ruleSetSha256: string,
  publishNote: string,
): Prisma.InputJsonObject {
  return notesInput({
    ...notesRecord(notes),
    ruleSetSha256,
    workflow: {
      ...workflow,
      status: 'PUBLISHED',
      publishedBy: actor.id,
      publishedAt: now.toISOString(),
      effectiveFrom: effectiveFrom.toISOString(),
      ruleSetSha256,
      publishNote,
    },
  });
}

function constraintText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const record = error as Record<string, unknown>;
  return `${String(record.message ?? '')} ${JSON.stringify(record.meta ?? '')}`;
}

function mapConstraintError(error: unknown): CustomerPriceBookAdminError | null {
  const text = constraintText(error);
  if (text.includes('CustomerPriceRule_active_base_quantity_no_overlap')) {
    return new CustomerPriceBookAdminError('同一产品的基础报价数量区间不能重叠');
  }
  if (
    text.includes('CustomerPriceBook_active_settlement_purpose_window_no_overlap') ||
    text.includes('CustomerPriceBook_active_settlement_window_no_overlap')
  ) {
    return new CustomerPriceBookAdminError('同一用途的生效价目版本不能重叠');
  }
  if (
    text.includes('CustomerPriceRule_values_valid') ||
    text.includes('CustomerPriceRule_logistics_values_valid')
  ) {
    return new CustomerPriceBookAdminError('价目规则字段组合或金额精度不合法');
  }
  if (text.includes('CustomerPriceBook_code_version_key')) {
    return new CustomerPriceBookAdminError('该价目簿版本已存在，请刷新后重试');
  }
  return null;
}

const RULE_VALIDATION_SELECT = {
  id: true,
  code: true,
  name: true,
  kind: true,
  calculationType: true,
  amount: true,
  includedUnits: true,
  incrementUnits: true,
  incrementAmount: true,
  minQty: true,
  maxQty: true,
  triggerCondition: true,
  exclusiveGroup: true,
  priority: true,
  blocksAutomaticQuote: true,
  sourceSheet: true,
  sourceRange: true,
  sourceName: true,
  sourceSha256: true,
  note: true,
  productId: true,
  isActive: true,
  category: {
    select: { code: true, name: true, isActive: true },
  },
  product: {
    select: { code: true, category: true, isActive: true },
  },
} as const;

async function validationRules(
  tx: Prisma.TransactionClient,
  priceBookId: string,
): Promise<DraftPriceRuleForValidation[]> {
  const rows = await tx.customerPriceRule.findMany({
    where: { priceBookId },
    select: RULE_VALIDATION_SELECT,
    orderBy: [{ categoryId: 'asc' }, { priority: 'desc' }, { code: 'asc' }],
  });
  return rows.map((rule) => ({
    ...rule,
    code: String(rule.code),
    kind: String(rule.kind),
    calculationType: rule.calculationType ? String(rule.calculationType) : null,
    category: {
      ...rule.category,
      code: String(rule.category.code),
    },
    product: rule.product
      ? { ...rule.product, code: String(rule.product.code) }
      : null,
  }));
}

function canonicalJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJson(child)]),
    );
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    return value;
  }
  return String(value);
}

function decimalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return new Prisma.Decimal(String(value)).toString();
}

export function calculateCustomerPriceRuleSetSha256(
  rules: DraftPriceRuleForValidation[],
): string {
  const normalized = [...rules]
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((rule) => ({
      code: rule.code,
      name: rule.name,
      categoryCode: rule.category.code,
      productCode: rule.product?.code ?? null,
      kind: rule.kind,
      calculationType: rule.calculationType,
      amount: decimalText(rule.amount),
      includedUnits: decimalText(rule.includedUnits),
      incrementUnits: decimalText(rule.incrementUnits),
      incrementAmount: decimalText(rule.incrementAmount),
      minQty: rule.minQty,
      maxQty: rule.maxQty,
      triggerCondition: canonicalJson(rule.triggerCondition),
      exclusiveGroup: rule.exclusiveGroup,
      priority: rule.priority,
      blocksAutomaticQuote: rule.blocksAutomaticQuote,
      sourceSheet: rule.sourceSheet,
      sourceRange: rule.sourceRange,
      sourceName: rule.sourceName,
      sourceSha256: rule.sourceSha256,
      note: rule.note,
      isActive: rule.isActive,
    }));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

const IMPACT_RULE_SELECT = {
  id: true,
  code: true,
  name: true,
  categoryId: true,
  productId: true,
  kind: true,
  calculationType: true,
  amount: true,
  includedUnits: true,
  incrementUnits: true,
  incrementAmount: true,
  minQty: true,
  maxQty: true,
  triggerCondition: true,
  exclusiveGroup: true,
  priority: true,
  note: true,
  blocksAutomaticQuote: true,
  isActive: true,
  category: { select: { name: true } },
  product: { select: { name: true } },
} as const;

type ImpactRuleRow = {
  id: string;
  code: unknown;
  name: string;
  categoryId: string;
  productId: string | null;
  kind: unknown;
  calculationType: CustomerPriceCalculationType | null;
  amount: unknown;
  includedUnits: unknown;
  incrementUnits: unknown;
  incrementAmount: unknown;
  minQty: number | null;
  maxQty: number | null;
  triggerCondition: unknown;
  exclusiveGroup: string | null;
  priority: number;
  note: string | null;
  blocksAutomaticQuote: boolean;
  isActive: boolean;
  category: { name: string };
  product: { name: string } | null;
};

const IMPACT_FIELD_LABELS = {
  name: '项目名称',
  categoryId: '收费类目',
  productId: '适用产品',
  kind: '规则类型',
  calculationType: '计价方式',
  amount: '价格',
  includedUnits: '首重单位',
  incrementUnits: '续重单位',
  incrementAmount: '续重价格',
  minQty: '最小数量',
  maxQty: '最大数量',
  triggerCondition: '适用条件',
  exclusiveGroup: '适用范围',
  priority: '应用顺序',
  note: '说明',
  blocksAutomaticQuote: '自动报价方式',
  isActive: '启用状态',
} as const;

type ImpactComparableField = keyof typeof IMPACT_FIELD_LABELS;

function comparableImpactValue(
  rule: ImpactRuleRow,
  field: ImpactComparableField,
): unknown {
  if (
    field === 'amount' ||
    field === 'includedUnits' ||
    field === 'incrementUnits' ||
    field === 'incrementAmount'
  ) {
    return decimalText(rule[field]);
  }
  if (field === 'triggerCondition') return canonicalJson(rule[field]);
  if (field === 'kind') return String(rule[field]);
  return rule[field];
}

function impactPrice(rule: ImpactRuleRow): CustomerPriceBookDraftImpactPriceDto {
  return {
    amount: decimalText(rule.amount),
    includedUnits: decimalText(rule.includedUnits),
    incrementUnits: decimalText(rule.incrementUnits),
    incrementAmount: decimalText(rule.incrementAmount),
    isActive: rule.isActive,
  };
}

function quantityLabel(rule: ImpactRuleRow): string {
  if (rule.minQty !== null && rule.maxQty !== null) {
    return rule.minQty === rule.maxQty
      ? `${rule.minQty.toLocaleString('zh-CN')} 个`
      : `${rule.minQty.toLocaleString('zh-CN')}–${rule.maxQty.toLocaleString('zh-CN')} 个`;
  }
  if (rule.minQty !== null) {
    return `${rule.minQty.toLocaleString('zh-CN')} 个起`;
  }
  if (rule.maxQty !== null) {
    return `至 ${rule.maxQty.toLocaleString('zh-CN')} 个`;
  }
  return '全部数量';
}

function impactDelta(
  current: ImpactRuleRow | null,
  draft: ImpactRuleRow | null,
): Pick<
  CustomerPriceBookDraftImpactChangeDto,
  'direction' | 'deltaAmount' | 'deltaPercent'
> {
  if (!current) {
    return { direction: 'ADDED', deltaAmount: null, deltaPercent: null };
  }
  if (!draft) {
    return { direction: 'REMOVED', deltaAmount: null, deltaPercent: null };
  }

  const pairs: Array<[unknown, unknown]> = [
    [current.amount, draft.amount],
    [current.incrementAmount, draft.incrementAmount],
  ];
  const directions: number[] = [];
  let primaryDelta: Prisma.Decimal | null = null;
  let primaryPercent: Prisma.Decimal | null = null;

  for (const [beforeRaw, afterRaw] of pairs) {
    if (beforeRaw === null || beforeRaw === undefined) continue;
    if (afterRaw === null || afterRaw === undefined) continue;
    const before = new Prisma.Decimal(String(beforeRaw));
    const after = new Prisma.Decimal(String(afterRaw));
    const compared = after.comparedTo(before);
    if (compared === 0) continue;
    directions.push(compared);
    if (!primaryDelta) {
      primaryDelta = after.minus(before);
      primaryPercent = before.isZero()
        ? null
        : primaryDelta.dividedBy(before).times(100);
    }
  }

  const hasUp = directions.some((direction) => direction > 0);
  const hasDown = directions.some((direction) => direction < 0);
  return {
    direction: hasUp && hasDown ? 'MIXED' : hasUp ? 'UP' : hasDown ? 'DOWN' : 'OTHER',
    deltaAmount: primaryDelta?.toDecimalPlaces(4).toString() ?? null,
    deltaPercent: primaryPercent?.toDecimalPlaces(1).toString() ?? null,
  };
}

function buildImpactChange(
  current: ImpactRuleRow | null,
  draft: ImpactRuleRow | null,
): CustomerPriceBookDraftImpactChangeDto | null {
  if (!current && !draft) return null;
  const changedFields = current && draft
    ? (Object.keys(IMPACT_FIELD_LABELS) as ImpactComparableField[])
        .filter(
          (field) =>
            JSON.stringify(comparableImpactValue(current, field)) !==
            JSON.stringify(comparableImpactValue(draft, field)),
        )
        .map((field) => IMPACT_FIELD_LABELS[field])
    : ['规则集'];
  if (changedFields.length === 0) return null;

  const display = draft ?? current!;
  return {
    draftRuleId: draft?.id ?? null,
    name: display.name,
    categoryName: display.category.name,
    productName: display.product?.name ?? null,
    quantityLabel: quantityLabel(display),
    calculationType: display.calculationType,
    current: current ? impactPrice(current) : null,
    draft: draft ? impactPrice(draft) : null,
    changedFields,
    ...impactDelta(current, draft),
  };
}

/**
 * This is a review threshold, not a price constraint. Administrators may still
 * publish any value after explicitly acknowledging a large relative change.
 */
const HIGH_RISK_DELTA_PERCENT_THRESHOLD = new Prisma.Decimal(50);

function hasHighRiskPriceTransition(
  beforeRaw: string | null,
  afterRaw: string | null,
): boolean {
  if (beforeRaw === afterRaw) return false;
  if (beforeRaw === null || afterRaw === null) return true;

  const before = new Prisma.Decimal(beforeRaw);
  const after = new Prisma.Decimal(afterRaw);
  if (before.isZero()) return !after.isZero();
  return after
    .minus(before)
    .dividedBy(before)
    .times(100)
    .abs()
    .greaterThanOrEqualTo(HIGH_RISK_DELTA_PERCENT_THRESHOLD);
}

function isHighRiskImpactChange(
  change: CustomerPriceBookDraftImpactChangeDto,
): boolean {
  // Adding/removing an active rule or toggling its active state changes quote
  // availability even when the stored numeric fields themselves stay equal.
  if (!change.current || !change.draft) {
    return (change.current ?? change.draft)?.isActive === true;
  }
  if (change.current.isActive !== change.draft.isActive) return true;
  if (!change.current.isActive) return false;

  return (
    hasHighRiskPriceTransition(
      change.current.amount,
      change.draft.amount,
    ) ||
    hasHighRiskPriceTransition(
      change.current.incrementAmount,
      change.draft.incrementAmount,
    )
  );
}

function buildImpactChanges(
  currentRules: readonly ImpactRuleRow[],
  draftRules: readonly ImpactRuleRow[],
): CustomerPriceBookDraftImpactChangeDto[] {
  const draftByCode = new Map(
    draftRules.map((rule) => [String(rule.code), rule] as const),
  );
  const currentByCode = new Map(
    currentRules.map((rule) => [String(rule.code), rule] as const),
  );
  const allCodes = new Set([...currentByCode.keys(), ...draftByCode.keys()]);

  return [...allCodes]
    .map((code) =>
      buildImpactChange(
        currentByCode.get(code) ?? null,
        draftByCode.get(code) ?? null,
      ),
    )
    .filter(
      (change): change is CustomerPriceBookDraftImpactChangeDto =>
        change !== null,
    );
}

function impactItemKey(rule: ImpactRuleRow): string {
  if (rule.productId) return `${rule.categoryId}:${rule.productId}`;
  const normalizedName = rule.name.replace(
    /\s*\d[\d,]*\s*(?:个|件|张)(?:\s.*)?$/u,
    '',
  );
  return `${rule.categoryId}:${normalizedName}`;
}

async function assertValidRuleSet(
  tx: Prisma.TransactionClient,
  priceBookId: string,
  purpose: CustomerPriceBookPurpose,
): Promise<DraftPriceRuleForValidation[]> {
  const rules = await validationRules(tx, priceBookId);
  const issues = validateDraftPriceBookRules({
    purpose,
    rules,
  });
  if (issues.length > 0) {
    throw new CustomerPriceBookValidationError(issues);
  }
  return rules;
}

async function assertCandidateProjectionForRange(
  tx: Prisma.TransactionClient,
  input: {
    candidatePriceBookId: string;
    candidatePurpose: CustomerPriceBookPurpose;
    start: Date;
    end: Date | null;
  },
): Promise<void> {
  const counterpartPurpose =
    input.candidatePurpose === CustomerPriceBookPurpose.PROCESSING
      ? CustomerPriceBookPurpose.LOGISTICS
      : CustomerPriceBookPurpose.PROCESSING;
  const counterpartBooks = await tx.customerPriceBook.findMany({
    where: {
      settlementType: EXTERNAL_SETTLEMENT,
      purpose: counterpartPurpose,
      isActive: true,
      ...(input.end ? { effectiveFrom: { lt: input.end } } : {}),
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.start } }],
    },
    select: { effectiveFrom: true, effectiveTo: true },
    orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }],
  });
  const inRange = (value: Date): boolean =>
    value >= input.start && (input.end === null || value < input.end);
  const boundaryMillis = new Set<number>([input.start.getTime()]);
  for (const book of counterpartBooks) {
    if (inRange(book.effectiveFrom)) {
      boundaryMillis.add(book.effectiveFrom.getTime());
    }
    if (book.effectiveTo && inRange(book.effectiveTo)) {
      boundaryMillis.add(book.effectiveTo.getTime());
    }
  }

  for (const milliseconds of [...boundaryMillis].sort((left, right) => left - right)) {
    const effectiveFrom = new Date(milliseconds);
    try {
      await readCandidatePublishedCreateOrderPriceProjection(tx, {
        candidatePriceBookId: input.candidatePriceBookId,
        effectiveFrom,
        snapshotLockHeld: true,
      });
    } catch (error) {
      if (error instanceof PublishedCreateOrderPriceAdapterError) {
        throw new CustomerPriceBookAdminError(
          `计划版本调整后无法供建单计价：${error.message}`,
        );
      }
      throw error;
    }
  }
}

async function assertScheduledBookIsUnreferenced(
  tx: Prisma.TransactionClient,
  book: {
    id: string;
    priceVersionLockCount: number;
    chargeCount: number;
  },
): Promise<void> {
  const sourceRuleReferences = await tx.orderCustomerCharge.count({
    where: { sourceRule: { is: { priceBookId: book.id } } },
  });
  if (
    book.priceVersionLockCount > 0 ||
    book.chargeCount > 0 ||
    sourceRuleReferences > 0
  ) {
    throw new CustomerPriceBookAdminError(
      '该计划版本已被工单价格事实引用，不能取消或改期',
    );
  }
}

export async function listCustomerPriceBookVersionsAndDrafts(
  now: Date = new Date(),
): Promise<CustomerPriceBookVersionAdminDto[]> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotReadLock(tx);
    const books = await tx.customerPriceBook.findMany({
      where: { settlementType: EXTERNAL_SETTLEMENT },
      select: {
        id: true,
        code: true,
        name: true,
        purpose: true,
        version: true,
        effectiveFrom: true,
        effectiveTo: true,
        isActive: true,
        notes: true,
        updatedAt: true,
        _count: { select: { rules: true } },
      },
      orderBy: [{ purpose: 'asc' }, { version: 'desc' }],
    });
    return books.map((book) => {
      const workflow = draftWorkflow(book.notes);
      const metadata = workflowSummary(book.notes);
      const schedule = scheduleControl(book.notes);
      const supersededSchedule = supersededScheduleSummary(book.notes);
      let status: CustomerPriceBookVersionAdminDto['status'];
      if (!book.isActive) {
        status =
          schedule?.status === 'CANCELLED' || supersededSchedule
            ? 'CANCELLED'
            : workflow
              ? 'DRAFT'
              : book.effectiveFrom > now
                ? 'CANCELLED'
              : 'HISTORICAL';
      } else if (book.effectiveFrom > now) {
        status = 'SCHEDULED';
      } else if (book.effectiveTo === null || book.effectiveTo > now) {
        status = 'CURRENT';
      } else {
        status = 'HISTORICAL';
      }
      return {
        id: book.id,
        code: String(book.code),
        name: book.name,
        purpose: book.purpose,
        version: book.version,
        status,
        effectiveFrom: book.effectiveFrom.toISOString(),
        effectiveTo: book.effectiveTo?.toISOString() ?? null,
        ruleCount: book._count.rules,
        basedOnVersion: metadata?.basedOnVersion ?? null,
        basedOnBookId: metadata?.basedOnBookId ?? null,
        changeReason: metadata?.changeReason ?? null,
        publishNote: metadata?.publishNote ?? null,
        ruleSetSha256: metadata?.ruleSetSha256 ?? null,
        createdById: metadata?.createdById ?? null,
        workflowCreatedAt: metadata?.createdAt ?? null,
        scheduleChangeReason:
          schedule?.reason ?? supersededSchedule?.reason ?? null,
        scheduleChangedAt:
          schedule?.changedAt ?? supersededSchedule?.changedAt ?? null,
        updatedAt: book.updatedAt.toISOString(),
      };
    });
  });
}

export async function getCustomerPriceBookDraft(
  priceBookId: string,
): Promise<CustomerPriceBookDraftAdminDto | null> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotReadLock(tx);
    const book = await tx.customerPriceBook.findUnique({
      where: { id: priceBookId },
      select: {
        id: true,
        code: true,
        name: true,
        purpose: true,
        settlementType: true,
        version: true,
        isActive: true,
        notes: true,
        updatedAt: true,
        rules: {
          select: {
            id: true,
            code: true,
            name: true,
            categoryId: true,
            productId: true,
            kind: true,
            calculationType: true,
            amount: true,
            includedUnits: true,
            incrementUnits: true,
            incrementAmount: true,
            minQty: true,
            maxQty: true,
            triggerCondition: true,
            exclusiveGroup: true,
            priority: true,
            note: true,
            blocksAutomaticQuote: true,
            isActive: true,
            sourceName: true,
            sourceSha256: true,
            sourceSheet: true,
            sourceRange: true,
            updatedAt: true,
            category: { select: { code: true, name: true } },
            product: { select: { code: true, name: true } },
          },
          orderBy: [
            { category: { sortOrder: 'asc' } },
            { priority: 'desc' },
            { code: 'asc' },
          ],
        },
      },
    });
    const workflow = book ? draftWorkflow(book.notes) : null;
    if (
      !book ||
      book.settlementType !== EXTERNAL_SETTLEMENT ||
      book.isActive ||
      !workflow
    ) {
      return null;
    }

    const [categories, products] = await Promise.all([
      tx.customerChargeCategory.findMany({
        where: {
          OR: [
            { isActive: true },
            { rules: { some: { priceBookId: book.id } } },
          ],
        },
        select: { id: true, code: true, name: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      tx.product.findMany({
        where: {
          OR: [
            { isActive: true },
            { customerPriceRules: { some: { priceBookId: book.id } } },
          ],
        },
        select: { id: true, code: true, name: true },
        orderBy: [{ code: 'asc' }, { name: 'asc' }],
      }),
    ]);

    return {
      id: book.id,
      code: String(book.code),
      name: book.name,
      purpose: book.purpose,
      version: book.version,
      basedOn: workflow.basedOn,
      changeReason: workflow.changeReason,
      createdBy: workflow.createdBy,
      createdAt: workflow.createdAt,
      ruleSetSha256: workflow.ruleSetSha256 ?? null,
      updatedAt: book.updatedAt.toISOString(),
      categories: categories.map((category) => ({
        ...category,
        code: String(category.code),
      })),
      products: products.map((product) => ({
        ...product,
        code: String(product.code),
      })),
      rules: book.rules.map((rule) => ({
        id: rule.id,
        code: String(rule.code),
        name: rule.name,
        categoryId: rule.categoryId,
        categoryCode: String(rule.category.code),
        categoryName: rule.category.name,
        productId: rule.productId,
        productCode: rule.product ? String(rule.product.code) : null,
        productName: rule.product?.name ?? null,
        kind: rule.kind,
        calculationType: rule.calculationType,
        amount: rule.amount?.toString() ?? null,
        includedUnits: rule.includedUnits?.toString() ?? null,
        incrementUnits: rule.incrementUnits?.toString() ?? null,
        incrementAmount: rule.incrementAmount?.toString() ?? null,
        minQty: rule.minQty,
        maxQty: rule.maxQty,
        triggerCondition: rule.triggerCondition,
        exclusiveGroup: rule.exclusiveGroup,
        priority: rule.priority,
        note: rule.note,
        blocksAutomaticQuote: rule.blocksAutomaticQuote,
        isActive: rule.isActive,
        source: {
          name: rule.sourceName,
          sha256: rule.sourceSha256,
          sheet: rule.sourceSheet,
          range: rule.sourceRange,
        },
        updatedAt: rule.updatedAt.toISOString(),
      })),
    };
  });
}

/**
 * Builds the publish-center read model while holding the same snapshot lock as
 * quoting and price-book writes. Technical matcher/provenance fields are used
 * for comparison and validation, but are never returned to the client.
 */
export async function getCustomerPriceBookDraftPublishPreview(
  priceBookId: string,
): Promise<CustomerPriceBookDraftPublishPreviewDto | null> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotReadLock(tx);
    const draft = await tx.customerPriceBook.findUnique({
      where: { id: priceBookId },
      select: {
        id: true,
        purpose: true,
        settlementType: true,
        version: true,
        isActive: true,
        notes: true,
        rules: {
          select: IMPACT_RULE_SELECT,
          orderBy: [{ categoryId: 'asc' }, { priority: 'desc' }, { code: 'asc' }],
        },
      },
    });
    const workflow = draft ? draftWorkflow(draft.notes) : null;
    if (
      !draft ||
      draft.settlementType !== EXTERNAL_SETTLEMENT ||
      draft.isActive ||
      !workflow
    ) {
      return null;
    }

    const basedOn = await tx.customerPriceBook.findUnique({
      where: { id: workflow.basedOn.id },
      select: {
        id: true,
        purpose: true,
        settlementType: true,
        version: true,
        rules: {
          select: IMPACT_RULE_SELECT,
          orderBy: [{ categoryId: 'asc' }, { priority: 'desc' }, { code: 'asc' }],
        },
      },
    });
    if (
      !basedOn ||
      basedOn.settlementType !== EXTERNAL_SETTLEMENT ||
      basedOn.purpose !== draft.purpose ||
      basedOn.version !== workflow.basedOn.version
    ) {
      return null;
    }

    const draftRules = draft.rules as ImpactRuleRow[];
    const currentRules = basedOn.rules as ImpactRuleRow[];
    const draftByCode = new Map(
      draftRules.map((rule) => [String(rule.code), rule] as const),
    );
    const currentByCode = new Map(
      currentRules.map((rule) => [String(rule.code), rule] as const),
    );
    const allCodes = new Set([...currentByCode.keys(), ...draftByCode.keys()]);
    const changes = buildImpactChanges(currentRules, draftRules)
      .sort((left, right) => {
        if (left.deltaPercent !== null && right.deltaPercent !== null) {
          return new Prisma.Decimal(right.deltaPercent)
            .comparedTo(new Prisma.Decimal(left.deltaPercent));
        }
        if (left.deltaPercent !== null) return -1;
        if (right.deltaPercent !== null) return 1;
        return left.name.localeCompare(right.name, 'zh-CN');
      });

    const changedItemKeys = new Set<string>();
    for (const code of allCodes) {
      const current = currentByCode.get(code) ?? null;
      const next = draftByCode.get(code) ?? null;
      if (!buildImpactChange(current, next)) continue;
      changedItemKeys.add(impactItemKey(next ?? current!));
    }

    const percentValues = changes
      .map((change) => change.deltaPercent)
      .filter((value): value is string => value !== null)
      .map((value) => new Prisma.Decimal(value));
    const normalizedRules = await validationRules(tx, draft.id);
    const normalizedCurrentRules = await validationRules(tx, basedOn.id);
    const validationIssues = [
      ...validateDraftPriceBookRules({
        purpose: draft.purpose,
        rules: normalizedRules,
      }),
    ];
    if (
      calculateCustomerPriceRuleSetSha256(normalizedRules) ===
      calculateCustomerPriceRuleSetSha256(normalizedCurrentRules)
    ) {
      validationIssues.push({
        path: 'rules',
        message: '草稿与当前版本没有价格或规则变化，无需发布',
      });
    }
    if (validationIssues.length === 0) {
      try {
        await readCandidatePublishedCreateOrderPriceProjection(tx, {
          candidatePriceBookId: draft.id,
          // The ordinary release path is immediate. The final locked publish
          // repeats this projection at its canonical release instant; an
          // explicit future release is therefore still validated again there.
          effectiveFrom: new Date(),
          snapshotLockHeld: true,
        });
      } catch (error) {
        if (error instanceof PublishedCreateOrderPriceAdapterError) {
          validationIssues.push({
            path: 'rules',
            message: `候选价目版本无法供建单计价：${error.message}`,
          });
        } else {
          throw error;
        }
      }
    }

    return {
      priceBookId: draft.id,
      purpose: draft.purpose,
      version: draft.version,
      basedOnVersion: workflow.basedOn.version,
      totalRuleCount: draftRules.length,
      activeRuleCount: draftRules.filter((rule) => rule.isActive).length,
      changedItemCount: changedItemKeys.size,
      changedRuleCount: changes.length,
      increasedRuleCount: changes.filter(
        (change) => change.direction === 'UP' || change.direction === 'MIXED',
      ).length,
      decreasedRuleCount: changes.filter(
        (change) => change.direction === 'DOWN' || change.direction === 'MIXED',
      ).length,
      highRiskRuleCount: changes.filter(isHighRiskImpactChange).length,
      highRiskDeltaPercentThreshold:
        HIGH_RISK_DELTA_PERCENT_THRESHOLD.toString(),
      deltaPercentMin:
        percentValues.length > 0
          ? Prisma.Decimal.min(...percentValues).toString()
          : null,
      deltaPercentMax:
        percentValues.length > 0
          ? Prisma.Decimal.max(...percentValues).toString()
          : null,
      changes,
      validation: {
        status: validationIssues.length === 0 ? 'PASS' : 'FAIL',
        issues: validationIssues,
      },
    };
  });
}

function businessConditionValidationErrors(errors: readonly string[]): string[] {
  return [
    ...new Set(
      errors.map((error) => error.trim()).filter(Boolean),
    ),
  ];
}

function shippingScopeLabel(condition: unknown): string {
  const record = isRecord(condition) ? condition : null;
  const carrier = record?.carrierCode === 'ZTO' ? '中通' : '指定承运商';
  const provinces = Array.isArray(record?.provinces)
    ? record.provinces.filter(
        (province): province is string =>
          typeof province === 'string' && province.trim().length > 0,
      )
    : [];
  return provinces.length > 0
    ? `${carrier} · ${provinces.join('、')}`
    : `${carrier} · 全部地区`;
}

/** Reads one editable rule without serializing its code, source or matcher JSON. */
export async function getCustomerPriceBookDraftRuleEditor(
  priceBookId: string,
  ruleId: string,
): Promise<CustomerPriceRuleDraftEditorDto | null> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotReadLock(tx);
    const rule = await tx.customerPriceRule.findUnique({
      where: { id: ruleId },
      select: {
        id: true,
        priceBookId: true,
        name: true,
        categoryId: true,
        productId: true,
        kind: true,
        calculationType: true,
        amount: true,
        includedUnits: true,
        incrementUnits: true,
        incrementAmount: true,
        minQty: true,
        maxQty: true,
        triggerCondition: true,
        blocksAutomaticQuote: true,
        isActive: true,
        updatedAt: true,
        category: { select: { code: true, name: true } },
        priceBook: {
          select: {
            id: true,
            purpose: true,
            settlementType: true,
            isActive: true,
            notes: true,
          },
        },
      },
    });
    if (
      !rule ||
      rule.priceBookId !== priceBookId ||
      rule.priceBook.settlementType !== EXTERNAL_SETTLEMENT ||
      rule.priceBook.isActive ||
      !draftWorkflow(rule.priceBook.notes)
    ) {
      return null;
    }

    const isProcessing =
      rule.priceBook.purpose === CustomerPriceBookPurpose.PROCESSING;
    const editableCondition = customerRuleConditionEditorInput(
      rule.triggerCondition,
    );
    const referencedCraftCodes = [
      ...editableCondition.value.craftCodes,
      ...editableCondition.value.noneOfCraftCodes,
      ...editableCondition.value.anyCraftCodeOutside,
    ];
    const [categories, products, crafts] = isProcessing
      ? await Promise.all([
          tx.customerChargeCategory.findMany({
            where: {
              AND: [
                { code: { notIn: ['SHIPPING_FEE', 'PACKING_MATERIAL'] } },
                {
                  OR: [
                    { isActive: true },
                    { id: rule.categoryId },
                  ],
                },
              ],
            },
            select: { id: true, name: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          }),
          tx.product.findMany({
            where: {
              OR: [
                { isActive: true },
                ...(rule.productId ? [{ id: rule.productId }] : []),
              ],
            },
            select: { id: true, name: true },
            orderBy: [{ code: 'asc' }, { name: 'asc' }],
          }),
          tx.craft.findMany({
            where: {
              OR: [
                { isActive: true },
                ...(referencedCraftCodes.length > 0
                  ? [{ code: { in: referencedCraftCodes } }]
                  : []),
              ],
            },
            select: { code: true, name: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          }),
        ])
      : [[], [], []];

    const categoryCode = String(rule.category.code);
    if (
      !isProcessing &&
      categoryCode !== 'SHIPPING_FEE' &&
      categoryCode !== 'PACKING_MATERIAL'
    ) {
      return null;
    }
    const editorMode: CustomerPriceRuleDraftEditorMode = isProcessing
      ? 'PROCESSING'
      : categoryCode === 'SHIPPING_FEE'
        ? 'SHIPPING'
        : 'PACKAGING';
    return {
      context: {
        id: rule.priceBook.id,
        purpose: rule.priceBook.purpose,
        categories,
        products,
        crafts: crafts.map((craft) => ({
          value: craft.code,
          label: craft.name,
        })),
      },
      rule: {
        id: rule.id,
        name: rule.name,
        categoryId: rule.categoryId,
        categoryName: rule.category.name,
        productId: rule.productId,
        kind: rule.kind,
        calculationType: rule.calculationType,
        unitsPerSheet: positiveIntegerConditionValue(
          rule.triggerCondition,
          'unitsPerSheet',
        ),
        match: editableCondition.value,
        matchValidationErrors: businessConditionValidationErrors(
          editableCondition.errors,
        ),
        amount: rule.amount?.toString() ?? null,
        includedUnits: rule.includedUnits?.toString() ?? null,
        incrementUnits: rule.incrementUnits?.toString() ?? null,
        incrementAmount: rule.incrementAmount?.toString() ?? null,
        minQty: rule.minQty,
        maxQty: rule.maxQty,
        blocksAutomaticQuote: rule.blocksAutomaticQuote,
        isActive: rule.isActive,
        editorMode,
        shippingScopeLabel:
          editorMode === 'SHIPPING'
            ? shippingScopeLabel(rule.triggerCondition)
            : null,
        updatedAt: rule.updatedAt.toISOString(),
      },
    };
  });
}

/** Add only the approved box rules to an unchanged draft, preserving all published history. */
export async function prepareConfirmedBoxPackagingDraft(
  input: { priceBookId: string; expectedDraftUpdatedAt: Date },
  actor: AuditActor,
): Promise<{ id: string; updatedAt: Date }> {
  if (actor.role !== 'ADMIN') throw new CustomerPriceBookAdminError('仅管理员可设置装盒价格');
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const draft = await tx.customerPriceBook.findUnique({ where: { id: input.priceBookId } });
    const workflow = draft ? draftWorkflow(draft.notes) : null;
    if (
      !draft ||
      draft.isActive ||
      !workflow ||
      draft.purpose !== CustomerPriceBookPurpose.PROCESSING ||
      draft.settlementType !== EXTERNAL_SETTLEMENT ||
      draft.updatedAt.getTime() !== input.expectedDraftUpdatedAt.getTime()
    )
      throw new CustomerPriceBookAdminError('草稿已变化或不可编辑，请刷新后重试');
    const source = await tx.customerPriceBook.findUnique({ where: { id: workflow.basedOn.id } });
    const now = new Date();
    if (!source || !source.isActive || source.effectiveFrom > now || source.effectiveTo !== null)
      throw new CustomerPriceBookAdminError('草稿基准版本已变化');
    const before = await validationRules(tx, draft.id);
    const original = await validationRules(tx, source.id);
    const outsideBoxes = (rules: DraftPriceRuleForValidation[]) =>
      rules.filter((rule) => !BOX_PRICE_RULES.some((box) => box.code === rule.code));
    if (
      calculateCustomerPriceRuleSetSha256(outsideBoxes(before)) !==
        calculateCustomerPriceRuleSetSha256(outsideBoxes(original)) ||
      JSON.stringify(canonicalJson(notesRecord(draft.notes).constants)) !==
        JSON.stringify(canonicalJson(notesRecord(source.notes).constants))
    )
      throw new CustomerPriceBookAdminError('草稿含其他调价，不能一并发布装盒规则');
    const category = await tx.customerChargeCategory.findFirst({
      where: { code: 'PACKING', isActive: true },
      select: { id: true },
    });
    if (!category) throw new CustomerPriceBookAdminError('缺少包装收费类目');
    for (const [index, rule] of BOX_PRICE_RULES.entries()) {
      const existing = before.find((candidate) => candidate.code === rule.code);
      if (existing) {
        if (!new Prisma.Decimal(String(existing.amount)).eq(CONFIRMED_BOX_RATES[index]))
          throw new CustomerPriceBookAdminError('装盒草稿已有不同价格，请在包装计价页面审阅');
        continue;
      }
      await tx.customerPriceRule.create({
        data: {
          priceBookId: draft.id,
          categoryId: category.id,
          code: rule.code,
          name: rule.name,
          kind: 'ADD_ON',
          calculationType: 'PER_BOX',
          amount: CONFIRMED_BOX_RATES[index],
          exclusiveGroup: rule.group,
          priority: 100,
          minQty: null,
          maxQty: null,
          triggerCondition: {
            schemaVersion: 1,
            target: 'PACKAGING_GROUP',
            packagingModes: [...rule.modes],
          },
          sourceName: '2026-09-13 用户确认装盒报价',
          sourceSha256: createHash('sha256')
            .update(JSON.stringify({ rules: BOX_PRICE_RULES, rates: CONFIRMED_BOX_RATES }))
            .digest('hex'),
          note: '空盒与装盒加工费分别按实际盒数计价。',
          isActive: true,
        },
      });
    }
    await assertValidRuleSet(tx, draft.id, draft.purpose);
    await readCandidatePublishedCreateOrderPriceProjection(tx, {
      candidatePriceBookId: draft.id,
      effectiveFrom: now,
      snapshotLockHeld: true,
    });
    const updated = await tx.customerPriceBook.update({
      where: { id: draft.id },
      data: {
        notes: notesInput({
          ...notesRecord(draft.notes),
          workflow: {
            ...workflow,
            changeReason: '新增红卡、触感空盒与装盒加工费',
            lastEditedBy: actor.id,
            lastEditedAt: now.toISOString(),
          },
        }),
      },
      select: { id: true, updatedAt: true },
    });
    await writeAuditLogInTx(tx, {
      actor,
      action: 'UPDATE_DRAFT_RULE_GROUP',
      entityType: 'CustomerPriceBook',
      entityId: draft.id,
      before: [],
      after: BOX_PRICE_RULES.map((rule, index) => ({
        code: rule.code,
        amount: CONFIRMED_BOX_RATES[index],
      })),
      requestMetadata: { source: 'customer-price-book-admin.prepareConfirmedBoxPackagingDraft' },
    });
    return updated;
  });
}

/** Controlled one-time data release. Runtime quotation still reads published rules. */
export async function prepareConfirmedCustomTierDraft(
  input: { priceBookId: string; expectedDraftUpdatedAt: Date },
  actor: AuditActor,
): Promise<{ id: string; updatedAt: Date }> {
  if (actor.role !== 'ADMIN') throw new CustomerPriceBookAdminError('仅管理员可调整专版阶梯');
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const now = new Date();
    const draft = await tx.customerPriceBook.findUnique({ where: { id: input.priceBookId } });
    const workflow = draft ? draftWorkflow(draft.notes) : null;
    if (!draft || draft.isActive || !workflow ||
        draft.purpose !== CustomerPriceBookPurpose.PROCESSING ||
        draft.settlementType !== EXTERNAL_SETTLEMENT ||
        draft.updatedAt.getTime() !== input.expectedDraftUpdatedAt.getTime()) {
      throw new CustomerPriceBookAdminError('草稿已变化或不可编辑，请刷新后重试');
    }
    const source = await tx.customerPriceBook.findUnique({ where: { id: workflow.basedOn.id } });
    if (!source || !source.isActive || source.effectiveFrom > now || source.effectiveTo !== null ||
        source.code !== 'EXTERNAL_SALES_PROCESSING_RULES' ||
        notesRecord(source.notes).ruleVersion !== '2026-08-30-print-null-sentinel') {
      throw new CustomerPriceBookAdminError('当前价目版本不适用本次专版阶梯调整');
    }
    const outsideTiers = (rules: DraftPriceRuleForValidation[]) =>
      rules.filter(rule => rule.exclusiveGroup !== 'CUSTOM_BASE');
    const before = await validationRules(tx, draft.id);
    const original = await validationRules(tx, source.id);
    if (calculateCustomerPriceRuleSetSha256(outsideTiers(before)) !==
        calculateCustomerPriceRuleSetSha256(outsideTiers(original)) ||
        JSON.stringify(canonicalJson(notesRecord(draft.notes).constants)) !==
        JSON.stringify(canonicalJson(notesRecord(source.notes).constants))) {
      throw new CustomerPriceBookAdminError('草稿含其他调价，请先单独处理，避免一并发布');
    }
    const productCodes = [
      'EXT-CUSTOM-MID', 'EXT-CUSTOM-SQUARE', 'EXT-CUSTOM-WEST-MID',
      'EXT-CUSTOM-LARGE', 'EXT-CUSTOM-WEST-LARGE',
    ];
    const rows = await tx.customerPriceRule.findMany({
      where: { priceBookId: draft.id, exclusiveGroup: 'CUSTOM_BASE' },
      include: { product: { select: { code: true, name: true } } },
      orderBy: { minQty: 'asc' },
    });
    const groups = productCodes.map(code => rows.filter(rule => rule.product?.code === code));
    const issue = fixedCustomTierIssue(groups);
    if (issue || groups.flat().length !== rows.length || rows.some(rule =>
      !rule.isActive || rule.kind !== 'BASE' || rule.calculationType !== 'PER_PIECE')) {
      throw new CustomerPriceBookAdminError(issue ?? '专版基础规则不完整，不能自动调整');
    }
    // The exclusion constraint is immediate: stage only this unpublished group
    // inactive, then restore each row with its final non-overlapping range. The
    // transaction and snapshot write lock hide all intermediate states.
    const staged = await tx.customerPriceRule.updateMany({
      where: { priceBookId: draft.id, id: { in: rows.map(rule => rule.id) }, isActive: true },
      data: { isActive: false },
    });
    if (staged.count !== rows.length) throw new CustomerPriceBookAdminError('草稿已变化，请刷新后重试');
    const sourceSha256 = createHash('sha256').update(JSON.stringify(customTierRelease)).digest('hex');
    for (const [groupIndex, group] of groups.entries()) {
      const isLarge = groupIndex >= 3;
      for (const [index, tier] of customTierRelease.tiers.entries()) {
        const minQty = index === 0 ? 1 : tier.quantity;
        const maxQty = (customTierRelease.tiers[index + 1]?.quantity ?? 10_000_000) - 1;
        const amount = new Prisma.Decimal(isLarge ? tier.large : tier.middle);
        const data = {
          minQty, maxQty, amount, isActive: true,
          name: `${group[0]!.product!.name} · ${tier.name}`,
          sourceName: customTierRelease.source, sourceSha256,
          sourceSheet: '专版单色平烫', sourceRange: `数量 ${tier.quantity}`,
          note: '按达到档位取价；200个档含不足200个，保持无最低起订量。',
        };
        const existing = group.length === 11 ? group[index] : group[index - 1];
        if (existing) {
          await tx.customerPriceRule.update({ where: { id: existing.id }, data });
        } else {
          const anchor = group[0]!;
          await tx.customerPriceRule.create({ data: {
            ...data, priceBookId: draft.id, categoryId: anchor.categoryId,
            productId: anchor.productId, code: `BASE_${productCodes[groupIndex]}_Q200`,
            kind: anchor.kind, calculationType: anchor.calculationType,
            includedUnits: anchor.includedUnits, incrementUnits: anchor.incrementUnits,
            incrementAmount: anchor.incrementAmount,
            triggerCondition: anchor.triggerCondition === null
              ? Prisma.DbNull : anchor.triggerCondition as Prisma.InputJsonValue,
            exclusiveGroup: anchor.exclusiveGroup, priority: anchor.priority,
            blocksAutomaticQuote: anchor.blocksAutomaticQuote, isActive: true,
          } });
        }
      }
    }
    const after = await assertValidRuleSet(tx, draft.id, draft.purpose);
    await readCandidatePublishedCreateOrderPriceProjection(tx, {
      candidatePriceBookId: draft.id, effectiveFrom: now, snapshotLockHeld: true,
    });
    const updated = await tx.customerPriceBook.update({
      where: { id: draft.id },
      data: { notes: notesInput({
        ...notesRecord(draft.notes), ruleVersion: customTierRelease.version,
        workflow: { ...workflow, changeReason: '按确认报价表补齐200个档，数量达到下一档时换价',
          lastEditedBy: actor.id, lastEditedAt: now.toISOString() },
      }) },
      select: { id: true, updatedAt: true },
    });
    await writeAuditLogInTx(tx, {
      actor, action: 'UPDATE_DRAFT_RULE_GROUP', entityType: 'CustomerPriceBook', entityId: draft.id,
      before: before.filter(rule => rule.exclusiveGroup === 'CUSTOM_BASE'),
      after: after.filter(rule => rule.exclusiveGroup === 'CUSTOM_BASE'),
      requestMetadata: { source: 'prepareConfirmedCustomTierDraft', release: customTierRelease.version },
    });
    return updated;
  }, { timeout: 30_000 });
}

export async function createCustomerPriceBookDraft(
  input: CreateCustomerPriceBookDraftInput,
  actor: AuditActor,
  now: Date = new Date(),
): Promise<{ id: string; version: number; purpose: CustomerPriceBookPurpose }> {
  try {
    return await db.$transaction(async (tx) => {
      await acquirePriceRuleSnapshotWriteLock(tx);

      const activeBooks = await tx.customerPriceBook.findMany({
        where: {
          settlementType: EXTERNAL_SETTLEMENT,
          purpose: input.purpose,
          isActive: true,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
        select: {
          id: true,
          code: true,
          name: true,
          settlementType: true,
          purpose: true,
          version: true,
          currency: true,
          sourceName: true,
          sourceSha256: true,
          notes: true,
          effectiveFrom: true,
          rules: {
            select: {
              categoryId: true,
              productId: true,
              code: true,
              name: true,
              kind: true,
              calculationType: true,
              amount: true,
              includedUnits: true,
              incrementUnits: true,
              incrementAmount: true,
              minQty: true,
              maxQty: true,
              triggerCondition: true,
              exclusiveGroup: true,
              priority: true,
              sourceSheet: true,
              sourceRange: true,
              sourceName: true,
              sourceSha256: true,
              note: true,
              blocksAutomaticQuote: true,
              isActive: true,
            },
          },
        },
        orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
        take: 2,
      });
      if (activeBooks.length === 0) {
        throw new CustomerPriceBookAdminError('当前没有可复制的生效价目簿');
      }
      if (activeBooks.length > 1) {
        throw new CustomerPriceBookAdminError('当前同时存在多个生效价目簿，请先修正版本有效期');
      }
      const source = activeBooks[0]!;

      const scheduled = await tx.customerPriceBook.findMany({
        where: {
          settlementType: EXTERNAL_SETTLEMENT,
          purpose: input.purpose,
          isActive: true,
          effectiveFrom: { gt: now },
        },
        select: { id: true, version: true, effectiveFrom: true },
        orderBy: { effectiveFrom: 'asc' },
        take: 1,
      });
      if (scheduled.length > 0) {
        throw new CustomerPriceBookAdminError(
          '该用途已有待生效版本，当前发布流程不能再创建后续草稿',
        );
      }

      const inactiveBooks = await tx.customerPriceBook.findMany({
        where: {
          settlementType: EXTERNAL_SETTLEMENT,
          purpose: input.purpose,
          isActive: false,
        },
        select: { id: true, notes: true },
      });
      const existingDraft = inactiveBooks.find((book) => draftWorkflow(book.notes));
      if (existingDraft) {
        throw new CustomerPriceBookAdminError('该用途已有草稿版本，请先编辑或发布现有草稿');
      }

      const latest = await tx.customerPriceBook.findFirst({
        where: { code: source.code },
        select: { version: true },
        orderBy: { version: 'desc' },
      });
      const version = (latest?.version ?? source.version) + 1;
      const workflow: DraftWorkflow = {
        status: 'DRAFT',
        basedOn: {
          id: source.id,
          code: String(source.code),
          version: source.version,
        },
        createdBy: actor.id,
        createdAt: now.toISOString(),
        changeReason: input.changeReason,
      };
      const created = await tx.customerPriceBook.create({
        data: {
          code: String(source.code),
          name: source.name,
          settlementType: source.settlementType,
          purpose: source.purpose,
          version,
          currency: source.currency,
          sourceName: source.sourceName,
          sourceSha256: source.sourceSha256,
          effectiveFrom: now,
          effectiveTo: null,
          isActive: false,
          notes: notesInput({ ...notesRecord(source.notes), workflow }),
        },
        select: { id: true, version: true, purpose: true },
      });
      if (source.rules.length > 0) {
        await tx.customerPriceRule.createMany({
          data: source.rules.map((rule) => ({
            priceBookId: created.id,
            categoryId: rule.categoryId,
            productId: rule.productId,
            code: String(rule.code),
            name: rule.name,
            kind: rule.kind,
            calculationType: rule.calculationType,
            amount: rule.amount,
            includedUnits: rule.includedUnits,
            incrementUnits: rule.incrementUnits,
            incrementAmount: rule.incrementAmount,
            minQty: rule.minQty,
            maxQty: rule.maxQty,
            triggerCondition:
              rule.triggerCondition === null
                ? Prisma.DbNull
                : (rule.triggerCondition as Prisma.InputJsonValue),
            exclusiveGroup: rule.exclusiveGroup,
            priority: rule.priority,
            sourceSheet: rule.sourceSheet,
            sourceRange: rule.sourceRange,
            sourceName: rule.sourceName,
            sourceSha256: rule.sourceSha256,
            note: rule.note,
            blocksAutomaticQuote: rule.blocksAutomaticQuote,
            isActive: rule.isActive,
          })),
        });
      }
      await assertValidRuleSet(tx, created.id, source.purpose);
      await writeAuditLogInTx(tx, {
        actor,
        action: 'CREATE_DRAFT',
        entityType: 'CustomerPriceBook',
        entityId: created.id,
        before: {
          id: source.id,
          code: String(source.code),
          version: source.version,
        },
        after: { ...created, copiedRuleCount: source.rules.length, workflow },
        requestMetadata: {
          source: 'customer-price-book-admin.createCustomerPriceBookDraft',
          changeReason: input.changeReason,
        },
      });
      return created;
    });
  } catch (error) {
    if (error instanceof CustomerPriceBookAdminError) throw error;
    throw mapConstraintError(error) ?? error;
  }
}

export async function updateCustomerPriceRuleDraft(
  input: UpdateCustomerPriceRuleDraftInput,
  actor: AuditActor,
  now: Date = new Date(),
): Promise<{ id: string; priceBookId: string }> {
  try {
    return await db.$transaction(async (tx) => {
      await acquirePriceRuleSnapshotWriteLock(tx);
      const existing = await tx.customerPriceRule.findUnique({
        where: { id: input.ruleId },
        select: {
          id: true,
          priceBookId: true,
          updatedAt: true,
          name: true,
          categoryId: true,
          productId: true,
          kind: true,
          calculationType: true,
          amount: true,
          includedUnits: true,
          incrementUnits: true,
          incrementAmount: true,
          minQty: true,
          maxQty: true,
          triggerCondition: true,
          exclusiveGroup: true,
          priority: true,
          note: true,
          blocksAutomaticQuote: true,
          isActive: true,
          category: { select: { code: true } },
          priceBook: {
            select: {
              id: true,
              purpose: true,
              settlementType: true,
              isActive: true,
              notes: true,
            },
          },
        },
      });
      if (!existing || existing.priceBookId !== input.priceBookId) {
        throw new CustomerPriceBookAdminError('草稿规则不存在');
      }
      const workflow = draftWorkflow(existing.priceBook.notes);
      if (
        existing.priceBook.settlementType !== EXTERNAL_SETTLEMENT ||
        existing.priceBook.isActive ||
        !workflow
      ) {
        throw new CustomerPriceBookAdminError('已发布或历史价目版本不可原地修改');
      }
      if (
        !Number.isFinite(input.expectedUpdatedAt.getTime()) ||
        existing.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
      ) {
        throw new CustomerPriceBookAdminError(
          '该规则已被其他管理员修改，请刷新后重试',
        );
      }

      const isProcessing =
        existing.priceBook.purpose === CustomerPriceBookPurpose.PROCESSING;
      const existingCategoryCode = String(existing.category.code);
      const isShipping =
        !isProcessing && existingCategoryCode === 'SHIPPING_FEE';
      if (
        !isProcessing &&
        !isShipping &&
        existingCategoryCode !== 'PACKING_MATERIAL'
      ) {
        throw new CustomerPriceBookAdminError(
          '该物流收费类目暂不支持在页面编辑',
        );
      }
      if (
        isProcessing &&
        (input.categoryId === undefined ||
          input.productId === undefined ||
          input.kind === undefined ||
          input.calculationType === undefined ||
          input.unitsPerSheet === undefined ||
          input.minQty === undefined ||
          input.maxQty === undefined ||
          input.blocksAutomaticQuote === undefined ||
          input.match === undefined)
      ) {
        throw new CustomerPriceBookAdminError(
          '加工费编辑字段不完整，请刷新后重试',
        );
      }
      if (
        isShipping &&
        (input.includedUnits === undefined ||
          input.incrementUnits === undefined ||
          input.incrementAmount === undefined)
      ) {
        throw new CustomerPriceBookAdminError(
          '快递费编辑字段不完整，请刷新后重试',
        );
      }
      if (
        !isProcessing &&
        !isShipping &&
        (input.minQty === undefined || input.maxQty === undefined)
      ) {
        throw new CustomerPriceBookAdminError(
          '打包耗材编辑字段不完整，请刷新后重试',
        );
      }
      if (isProcessing) {
        const existingTarget = customerRuleConditionEditorInput(
          existing.triggerCondition,
        ).value.target;
        if (input.match!.target !== existingTarget) {
          throw new CustomerPriceBookAdminError(
            '计价对象不能直接变更，请刷新后重试',
          );
        }
      }

      let targetProductCodes: string[] = [];
      if (isProcessing) {
        const category = await tx.customerChargeCategory.findUnique({
          where: { id: input.categoryId! },
          select: { id: true, code: true },
        });
        if (!category) throw new CustomerPriceBookAdminError('收费类目不存在');
        if (
          String(category.code) === 'SHIPPING_FEE' ||
          String(category.code) === 'PACKING_MATERIAL'
        ) {
          throw new CustomerPriceBookAdminError('加工费不能改为物流收费类目');
        }
        if (input.productId) {
          const product = await tx.product.findUnique({
            where: { id: input.productId },
            select: { id: true, code: true },
          });
          if (!product) throw new CustomerPriceBookAdminError('建单产品不存在');
          targetProductCodes = [String(product.code)];
        } else if (existing.productId === null) {
          // 历史附加规则可能通过多个 productCodes 限定范围，
          // 这组稳定编号不向管理端暴露。只改金额/名称时必须原样
          // 保留；只有用户明确从单产品规则清空产品时才移除。
          targetProductCodes =
            parseCustomerRuleCondition(existing.triggerCondition).condition
              ?.productCodes ?? [];
        }
      }

      let triggerCondition = existing.triggerCondition;
      if (isProcessing) {
        let unitsPerSheet: number | null = null;
        if (input.calculationType === 'PER_SHEET') {
          if (
            !Number.isSafeInteger(input.unitsPerSheet) ||
            Number(input.unitsPerSheet) < 1
          ) {
            throw new CustomerPriceBookAdminError(
              '按张计价必须填写正整数的每张含几个',
            );
          }
          unitsPerSheet = input.unitsPerSheet!;
        }
        triggerCondition = buildCustomerRuleCondition(input.match!, {
          productCodes: targetProductCodes,
          unitsPerSheet,
        });
      }

      const editableData = isProcessing
        ? {
            categoryId: input.categoryId!,
            productId: input.productId!,
            kind: input.kind!,
            calculationType: input.calculationType!,
            minQty: input.minQty!,
            maxQty: input.maxQty!,
            blocksAutomaticQuote: input.blocksAutomaticQuote!,
            triggerCondition:
              triggerCondition === null
                ? Prisma.DbNull
                : (triggerCondition as Prisma.InputJsonValue),
          }
        : isShipping
          ? {
              includedUnits: input.includedUnits!,
              incrementUnits: input.incrementUnits!,
              incrementAmount: input.incrementAmount!,
            }
          : {
              minQty: input.minQty!,
              maxQty: input.maxQty!,
            };

      const updated = await tx.customerPriceRule.update({
        where: { id: input.ruleId },
        data: {
          name: input.name,
          amount: input.amount,
          isActive: input.isActive,
          ...editableData,
        },
        select: {
          id: true,
          priceBookId: true,
          name: true,
          categoryId: true,
          productId: true,
          kind: true,
          calculationType: true,
          amount: true,
          includedUnits: true,
          incrementUnits: true,
          incrementAmount: true,
          minQty: true,
          maxQty: true,
          triggerCondition: true,
          exclusiveGroup: true,
          priority: true,
          note: true,
          blocksAutomaticQuote: true,
          isActive: true,
        },
      });
      await assertValidRuleSet(tx, input.priceBookId, existing.priceBook.purpose);
      await tx.customerPriceBook.update({
        where: { id: input.priceBookId },
        data: {
          notes: notesInput({
            ...notesRecord(existing.priceBook.notes),
            workflow: {
              ...workflow,
              lastEditedBy: actor.id,
              lastEditedAt: now.toISOString(),
            },
          }),
        },
        select: { id: true },
      });
      await writeAuditLogInTx(tx, {
        actor,
        action: 'UPDATE_DRAFT_RULE',
        entityType: 'CustomerPriceRule',
        entityId: updated.id,
        before: existing,
        after: updated,
        requestMetadata: {
          source: 'customer-price-book-admin.updateCustomerPriceRuleDraft',
          priceBookId: input.priceBookId,
        },
      });
      return { id: updated.id, priceBookId: updated.priceBookId };
    });
  } catch (error) {
    if (error instanceof CustomerPriceBookAdminError) throw error;
    throw mapConstraintError(error) ?? error;
  }
}

const GROUP_RULE_SELECT = {
  id: true,
  priceBookId: true,
  updatedAt: true,
  categoryId: true,
  productId: true,
  kind: true,
  calculationType: true,
  amount: true,
  includedUnits: true,
  incrementUnits: true,
  incrementAmount: true,
  minQty: true,
  maxQty: true,
  triggerCondition: true,
  exclusiveGroup: true,
  priority: true,
  sourceSheet: true,
  sourceName: true,
  sourceSha256: true,
  note: true,
  blocksAutomaticQuote: true,
  isActive: true,
} as const;

type GroupRuleRow = Prisma.CustomerPriceRuleGetPayload<{
  select: typeof GROUP_RULE_SELECT;
}>;

const SECTION_RULE_SELECT = {
  ...GROUP_RULE_SELECT,
  code: true,
} as const;

type SectionRuleRow = Prisma.CustomerPriceRuleGetPayload<{
  select: typeof SECTION_RULE_SELECT;
}>;

const SECTION_BOOK_SELECT = {
  id: true,
  settlementType: true,
  purpose: true,
  isActive: true,
  notes: true,
} as const;

type SectionBookRow = Prisma.CustomerPriceBookGetPayload<{
  select: typeof SECTION_BOOK_SELECT;
}>;

/** Matcher arrays represent sets; their persisted order is not semantic. */
function canonicalGroupMatcherJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value
      .map(canonicalGroupMatcherJson)
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalGroupMatcherJson(child)]),
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return String(value);
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return String(value);
}

/**
 * Fields which identify one processing-product price ladder. Quantity, amount,
 * display name, active state and the individual source cell intentionally do
 * not affect membership. Hidden matching semantics, source document/sheet and
 * rule notes do, so visually similar but distinct rules cannot be mixed.
 */
function priceRuleGroupSignature(rule: GroupRuleRow): string {
  return JSON.stringify({
    categoryId: rule.categoryId,
    productId: rule.productId,
    kind: rule.kind,
    calculationType: rule.calculationType,
    includedUnits: decimalText(rule.includedUnits),
    incrementUnits: decimalText(rule.incrementUnits),
    incrementAmount: decimalText(rule.incrementAmount),
    triggerCondition: canonicalGroupMatcherJson(rule.triggerCondition),
    exclusiveGroup: rule.exclusiveGroup,
    priority: rule.priority,
    sourceSheet: rule.sourceSheet,
    sourceName: rule.sourceName,
    sourceSha256: rule.sourceSha256,
    note: rule.note,
    blocksAutomaticQuote: rule.blocksAutomaticQuote,
  });
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

/**
 * Atomically saves the visible amount/active fields for one complete product
 * ladder. The client supplies only opaque row identities and editable values;
 * group membership and matcher/provenance fields stay server-owned.
 */
export async function updateCustomerPriceRuleDraftGroup(
  input: UpdateCustomerPriceRuleDraftGroupInput,
  actor: AuditActor,
  now: Date = new Date(),
): Promise<{ priceBookId: string; ruleIds: string[] }> {
  try {
    return await db.$transaction(async (tx) => {
      await acquirePriceRuleSnapshotWriteLock(tx);

      if (input.rows.length === 0) {
        throw new CustomerPriceBookAdminError('价格阶梯至少需要一项');
      }
      const submittedIds = input.rows.map((row) => row.ruleId);
      if (new Set(submittedIds).size !== submittedIds.length) {
        throw new CustomerPriceBookAdminError('价格阶梯中存在重复项目，请刷新后重试');
      }

      const anchor = await tx.customerPriceRule.findUnique({
        where: { id: input.anchorRuleId },
        select: {
          ...GROUP_RULE_SELECT,
          priceBook: {
            select: {
              id: true,
              purpose: true,
              settlementType: true,
              isActive: true,
              notes: true,
            },
          },
        },
      });
      const workflow = anchor ? draftWorkflow(anchor.priceBook.notes) : null;
      if (!anchor || anchor.priceBookId !== input.priceBookId) {
        throw new CustomerPriceBookAdminError('价格阶梯不存在');
      }
      if (
        anchor.priceBook.settlementType !== EXTERNAL_SETTLEMENT ||
        anchor.priceBook.purpose !== CustomerPriceBookPurpose.PROCESSING ||
        anchor.priceBook.isActive ||
        !workflow
      ) {
        throw new CustomerPriceBookAdminError('已发布或历史价目版本不可原地修改');
      }
      if (
        anchor.kind !== 'BASE' ||
        anchor.productId === null ||
        anchor.calculationType === null ||
        !Number.isSafeInteger(anchor.minQty) ||
        anchor.minQty! < 1 ||
        anchor.minQty !== anchor.maxQty
      ) {
        throw new CustomerPriceBookAdminError('该收费项目不是可整组编辑的产品价格阶梯');
      }

      const candidates = await tx.customerPriceRule.findMany({
        where: {
          priceBookId: input.priceBookId,
          categoryId: anchor.categoryId,
          productId: anchor.productId,
          kind: anchor.kind,
          calculationType: anchor.calculationType,
        },
        select: GROUP_RULE_SELECT,
        orderBy: [{ minQty: 'asc' }, { id: 'asc' }],
      });
      const anchorSignature = priceRuleGroupSignature(anchor);
      const groupRows = candidates.filter(
        (candidate) => priceRuleGroupSignature(candidate) === anchorSignature,
      );
      if (
        groupRows.length === 0 ||
        groupRows.some(
          (row) =>
            !Number.isSafeInteger(row.minQty) ||
            row.minQty! < 1 ||
            row.minQty !== row.maxQty,
        )
      ) {
        throw new CustomerPriceBookAdminError('价格阶梯的数量档不完整，请刷新后重试');
      }
      const quantities = groupRows.map((row) => row.minQty!);
      if (new Set(quantities).size !== quantities.length) {
        throw new CustomerPriceBookAdminError('价格阶梯存在重复数量档，不能整组保存');
      }
      const groupIds = groupRows.map((row) => row.id);
      if (
        !submittedIds.includes(input.anchorRuleId) ||
        !sameStringSet(submittedIds, groupIds)
      ) {
        throw new CustomerPriceBookAdminError('价格阶梯已变化，请刷新后重试');
      }

      const existingById = new Map(groupRows.map((row) => [row.id, row]));
      for (const row of input.rows) {
        const existing = existingById.get(row.ruleId);
        if (!existing) {
          throw new CustomerPriceBookAdminError('价格阶梯已变化，请刷新后重试');
        }
        if (
          !Number.isFinite(row.expectedUpdatedAt.getTime()) ||
          existing.updatedAt.getTime() !== row.expectedUpdatedAt.getTime()
        ) {
          throw new CustomerPriceBookAdminError(
            '价格阶梯已被其他管理员修改，请刷新后重试',
          );
        }
      }

      const submittedById = new Map(
        input.rows.map((row) => [row.ruleId, row]),
      );
      for (const existing of groupRows) {
        const submitted = submittedById.get(existing.id)!;
        const outcome = await tx.customerPriceRule.updateMany({
          where: {
            id: existing.id,
            priceBookId: input.priceBookId,
            updatedAt: submitted.expectedUpdatedAt,
          },
          data: {
            amount: new Prisma.Decimal(submitted.amount),
            isActive: submitted.isActive,
            updatedAt: now,
          },
        });
        if (outcome.count !== 1) {
          throw new CustomerPriceBookAdminError(
            '价格阶梯已被其他管理员修改，请刷新后重试',
          );
        }
      }

      await assertValidRuleSet(
        tx,
        input.priceBookId,
        anchor.priceBook.purpose,
      );
      await tx.customerPriceBook.update({
        where: { id: input.priceBookId },
        data: {
          updatedAt: now,
          notes: notesInput({
            ...notesRecord(anchor.priceBook.notes),
            workflow: {
              ...workflow,
              lastEditedBy: actor.id,
              lastEditedAt: now.toISOString(),
            },
          }),
        },
        select: { id: true },
      });

      for (const existing of groupRows) {
        const submitted = submittedById.get(existing.id)!;
        await writeAuditLogInTx(tx, {
          actor,
          action: 'UPDATE_DRAFT_RULE_GROUP_ROW',
          entityType: 'CustomerPriceRule',
          entityId: existing.id,
          before: {
            amount: existing.amount,
            isActive: existing.isActive,
            updatedAt: existing.updatedAt,
          },
          after: {
            amount: submitted.amount,
            isActive: submitted.isActive,
            updatedAt: now,
          },
          requestMetadata: {
            source:
              'customer-price-book-admin.updateCustomerPriceRuleDraftGroup',
            priceBookId: input.priceBookId,
            anchorRuleId: input.anchorRuleId,
          },
        });
      }
      await writeAuditLogInTx(tx, {
        actor,
        action: 'UPDATE_DRAFT_RULE_GROUP',
        entityType: 'CustomerPriceBook',
        entityId: input.priceBookId,
        before: {
          anchorRuleId: input.anchorRuleId,
          rows: groupRows.map((row) => ({
            ruleId: row.id,
            amount: row.amount,
            isActive: row.isActive,
          })),
        },
        after: {
          anchorRuleId: input.anchorRuleId,
          rows: groupRows.map((row) => {
            const submitted = submittedById.get(row.id)!;
            return {
              ruleId: row.id,
              amount: submitted.amount,
              isActive: submitted.isActive,
            };
          }),
        },
        requestMetadata: {
          source: 'customer-price-book-admin.updateCustomerPriceRuleDraftGroup',
          changedRuleCount: groupRows.length,
        },
      });

      return { priceBookId: input.priceBookId, ruleIds: groupIds };
    });
  } catch (error) {
    if (error instanceof CustomerPriceBookAdminError) throw error;
    throw mapConstraintError(error) ?? error;
  }
}

function sameNullableDecimal(
  persisted: unknown,
  submitted: string | null,
): boolean {
  return decimalText(persisted) ===
    (submitted === null ? null : new Prisma.Decimal(submitted).toString());
}

function sectionRowSnapshot(row: {
  amount: unknown;
  minQty: number | null;
  maxQty: number | null;
  includedUnits: unknown;
  incrementUnits: unknown;
  incrementAmount: unknown;
  updatedAt: Date;
}) {
  return {
    amount: decimalText(row.amount),
    minQty: row.minQty,
    maxQty: row.maxQty,
    includedUnits: decimalText(row.includedUnits),
    incrementUnits: decimalText(row.incrementUnits),
    incrementAmount: decimalText(row.incrementAmount),
    updatedAt: row.updatedAt,
  };
}

function sectionRowHasSemanticChange(
  existing: SectionRuleRow,
  submitted: UpdateCustomerPriceSectionDraftInput['rows'][number],
): boolean {
  return (
    !sameNullableDecimal(existing.amount, submitted.amount) ||
    existing.minQty !== submitted.minQty ||
    existing.maxQty !== submitted.maxQty ||
    !sameNullableDecimal(existing.includedUnits, submitted.includedUnits) ||
    !sameNullableDecimal(existing.incrementUnits, submitted.incrementUnits) ||
    !sameNullableDecimal(existing.incrementAmount, submitted.incrementAmount)
  );
}

type PreparedCustomerPriceSectionDraft = {
  input: UpdateCustomerPriceSectionDraftInput;
  book: SectionBookRow;
  workflow: DraftWorkflow;
  sectionRules: SectionRuleRow[];
  changedRules: SectionRuleRow[];
  sectionIds: string[];
  submittedById: Map<
    string,
    UpdateCustomerPriceSectionDraftInput['rows'][number]
  >;
};

async function prepareCustomerPriceSectionDraft(
  tx: Prisma.TransactionClient,
  input: UpdateCustomerPriceSectionDraftInput,
): Promise<PreparedCustomerPriceSectionDraft> {
  const book = await tx.customerPriceBook.findUnique({
    where: { id: input.priceBookId },
    select: SECTION_BOOK_SELECT,
  });
  const workflow = book ? draftWorkflow(book.notes) : null;
  if (
    !book ||
    book.settlementType !== EXTERNAL_SETTLEMENT ||
    book.isActive ||
    !workflow
  ) {
    throw new CustomerPriceBookAdminError('已发布或历史价目版本不可原地修改');
  }

  const allRules = await tx.customerPriceRule.findMany({
    where: { priceBookId: input.priceBookId },
    select: SECTION_RULE_SELECT,
    orderBy: [{ code: 'asc' }],
  });
  const sectionRules = allRules.filter((rule) =>
    customerPriceSectionOwnsRule(input.section, book.purpose, rule),
  );
  if (sectionRules.length === 0) {
    throw new CustomerPriceBookAdminError('该业务板块暂无可编辑规则');
  }

  const submittedIds = input.rows.map((row) => row.ruleId);
  const sectionIds = sectionRules.map((rule) => rule.id);
  if (
    new Set(submittedIds).size !== submittedIds.length ||
    !sameStringSet(submittedIds, sectionIds)
  ) {
    throw new CustomerPriceBookAdminError('业务板块规则已变化，请刷新后重试');
  }

  const existingById = new Map(sectionRules.map((rule) => [rule.id, rule]));
  for (const submitted of input.rows) {
    const existing = existingById.get(submitted.ruleId);
    if (!existing) {
      throw new CustomerPriceBookAdminError('业务板块规则已变化，请刷新后重试');
    }
    if (
      !Number.isFinite(submitted.expectedUpdatedAt.getTime()) ||
      existing.updatedAt.getTime() !== submitted.expectedUpdatedAt.getTime()
    ) {
      throw new CustomerPriceBookAdminError('价格已被其他管理员修改，请刷新后重试');
    }

    const group = existing.exclusiveGroup?.toUpperCase() ?? '';
    const mayEditBounds =
      input.section === 'machine' ||
      input.section === 'tiers' ||
      (input.section === 'ship' &&
        group === 'CARTON_ORDER_QUANTITY_TIER');
    const mayEditShippingTerms =
      input.section === 'ship' && group === 'ZTO_PROVINCE_RATE';
    if (
      (!mayEditBounds &&
        (submitted.minQty !== existing.minQty ||
          submitted.maxQty !== existing.maxQty)) ||
      (!mayEditShippingTerms &&
        (!sameNullableDecimal(existing.includedUnits, submitted.includedUnits) ||
          !sameNullableDecimal(existing.incrementUnits, submitted.incrementUnits) ||
          !sameNullableDecimal(
            existing.incrementAmount,
            submitted.incrementAmount,
          )))
    ) {
      throw new CustomerPriceBookAdminError('提交内容包含该业务板块不允许修改的字段');
    }
  }

  const submittedById = new Map(input.rows.map((row) => [row.ruleId, row]));
  if (input.section === 'tiers') {
    const groups = new Map<string, typeof input.rows>();
    for (const rule of [...sectionRules].sort((a, b) => (a.minQty ?? 0) - (b.minQty ?? 0))) {
      const key = rule.productId ?? '';
      const rows = groups.get(key) ?? [];
      groups.set(key, [...rows, submittedById.get(rule.id)!]);
    }
    const issue = fixedCustomTierIssue([...groups.values()]);
    if (issue) throw new CustomerPriceBookAdminError(issue);
  }
  return {
    input,
    book,
    workflow,
    sectionRules,
    changedRules: sectionRules.filter((rule) =>
      sectionRowHasSemanticChange(rule, submittedById.get(rule.id)!),
    ),
    sectionIds,
    submittedById,
  };
}

async function writePreparedCustomerPriceSectionDraft(
  tx: Prisma.TransactionClient,
  prepared: PreparedCustomerPriceSectionDraft,
  now: Date,
): Promise<void> {
  // Stage changed BASE ranges together before restoring them. Updating one
  // adjacent range at a time can violate the immediate exclusion constraint,
  // even though the complete, already validated ladder has no overlap.
  for (const existing of prepared.changedRules) {
    const submitted = prepared.submittedById.get(existing.id)!;
    if (existing.kind !== 'BASE' || !existing.isActive ||
        (existing.minQty === submitted.minQty && existing.maxQty === submitted.maxQty)) continue;
    const staged = await tx.customerPriceRule.updateMany({
      where: { id: existing.id, priceBookId: prepared.input.priceBookId, updatedAt: submitted.expectedUpdatedAt },
      data: { isActive: false, updatedAt: existing.updatedAt },
    });
    if (staged.count !== 1) throw new CustomerPriceBookAdminError('价格已被其他管理员修改，请刷新后重试');
  }
  for (const existing of prepared.changedRules) {
    const submitted = prepared.submittedById.get(existing.id)!;
    const outcome = await tx.customerPriceRule.updateMany({
      where: {
        id: existing.id,
        priceBookId: prepared.input.priceBookId,
        updatedAt: submitted.expectedUpdatedAt,
      },
      data: {
        isActive: existing.isActive,
        amount:
          submitted.amount === null
            ? null
            : new Prisma.Decimal(submitted.amount),
        minQty: submitted.minQty,
        maxQty: submitted.maxQty,
        includedUnits:
          submitted.includedUnits === null
            ? null
            : new Prisma.Decimal(submitted.includedUnits),
        incrementUnits:
          submitted.incrementUnits === null
            ? null
            : new Prisma.Decimal(submitted.incrementUnits),
        incrementAmount:
          submitted.incrementAmount === null
            ? null
            : new Prisma.Decimal(submitted.incrementAmount),
        updatedAt: now,
      },
    });
    if (outcome.count !== 1) {
      throw new CustomerPriceBookAdminError('价格已被其他管理员修改，请刷新后重试');
    }
  }
}

async function finishPreparedCustomerPriceSectionDraft(
  tx: Prisma.TransactionClient,
  prepared: PreparedCustomerPriceSectionDraft,
  actor: AuditActor,
  now: Date,
): Promise<void> {
  if (prepared.changedRules.length === 0) return;

  await tx.customerPriceBook.update({
    where: { id: prepared.input.priceBookId },
    data: {
      updatedAt: now,
      notes: notesInput({
        ...notesRecord(prepared.book.notes),
        workflow: {
          ...prepared.workflow,
          lastEditedBy: actor.id,
          lastEditedAt: now.toISOString(),
        },
      }),
    },
    select: { id: true },
  });

  for (const existing of prepared.changedRules) {
    const submitted = prepared.submittedById.get(existing.id)!;
    await writeAuditLogInTx(tx, {
      actor,
      action: 'UPDATE_DRAFT_PRICE_SECTION_ROW',
      entityType: 'CustomerPriceRule',
      entityId: existing.id,
      before: sectionRowSnapshot(existing),
      after: { ...submitted, updatedAt: now },
      requestMetadata: {
        source: 'customer-price-book-admin.updateCustomerPriceSectionDraft',
        priceBookId: prepared.input.priceBookId,
        section: prepared.input.section,
      },
    });
  }
  await writeAuditLogInTx(tx, {
    actor,
    action: 'UPDATE_DRAFT_PRICE_SECTION',
    entityType: 'CustomerPriceBook',
    entityId: prepared.input.priceBookId,
    before: { section: prepared.input.section },
    after: {
      section: prepared.input.section,
      ruleIds: prepared.changedRules.map((rule) => rule.id),
    },
    requestMetadata: {
      source: 'customer-price-book-admin.updateCustomerPriceSectionDraft',
      changedRuleCount: prepared.changedRules.length,
    },
  });
}

/**
 * Atomically saves complete design-native sections across every price book in
 * one page submission. All books are preflighted under one write lock before
 * the first row is touched; any later write or full-book validation failure
 * aborts the single database transaction.
 */
export async function updateCustomerPriceSectionsDraft(
  inputs: readonly UpdateCustomerPriceSectionDraftInput[],
  actor: AuditActor,
  now: Date = new Date(),
): Promise<Array<{ priceBookId: string; ruleIds: string[] }>> {
  try {
    return await db.$transaction(async (tx) => {
      await acquirePriceRuleSnapshotWriteLock(tx);
      if (inputs.length === 0) {
        throw new CustomerPriceBookAdminError('当前业务板块没有可保存规则');
      }
      const priceBookIds = inputs.map((input) => input.priceBookId);
      if (new Set(priceBookIds).size !== priceBookIds.length) {
        throw new CustomerPriceBookAdminError('提交内容包含重复价目版本，请刷新后重试');
      }

      const prepared: PreparedCustomerPriceSectionDraft[] = [];
      for (const input of inputs) {
        prepared.push(await prepareCustomerPriceSectionDraft(tx, input));
      }
      for (const section of prepared) {
        await writePreparedCustomerPriceSectionDraft(tx, section, now);
      }
      for (const section of prepared) {
        await assertValidRuleSet(
          tx,
          section.input.priceBookId,
          section.book.purpose,
        );
      }
      for (const section of prepared) {
        await finishPreparedCustomerPriceSectionDraft(tx, section, actor, now);
      }

      return prepared.map((section) => ({
        priceBookId: section.input.priceBookId,
        ruleIds: section.changedRules.map((rule) => rule.id),
      }));
    });
  } catch (error) {
    if (error instanceof CustomerPriceBookAdminError) throw error;
    throw mapConstraintError(error) ?? error;
  }
}

/**
 * Backwards-compatible single-book entry point. It delegates to the same
 * batch transaction so there is only one mutation implementation to audit.
 */
export async function updateCustomerPriceSectionDraft(
  input: UpdateCustomerPriceSectionDraftInput,
  actor: AuditActor,
  now: Date = new Date(),
): Promise<{ priceBookId: string; ruleIds: string[] }> {
  const [updated] = await updateCustomerPriceSectionsDraft([input], actor, now);
  return updated!;
}

export async function discardCustomerPriceBookDraft(
  input: DiscardCustomerPriceBookDraftInput,
  actor: AuditActor,
): Promise<{ id: string; purpose: CustomerPriceBookPurpose }> {
  try {
    return await db.$transaction(async (tx) => {
      await acquirePriceRuleSnapshotWriteLock(tx);
      const draft = await tx.customerPriceBook.findUnique({
        where: { id: input.priceBookId },
        select: {
          id: true,
          code: true,
          version: true,
          purpose: true,
          settlementType: true,
          isActive: true,
          notes: true,
          updatedAt: true,
          _count: { select: { rules: true, charges: true } },
        },
      });
      const workflow = draft ? draftWorkflow(draft.notes) : null;
      if (
        !draft ||
        draft.settlementType !== EXTERNAL_SETTLEMENT ||
        draft.isActive ||
        !workflow
      ) {
        throw new CustomerPriceBookAdminError('只能放弃尚未发布的草稿价目簿');
      }
      if (
        !Number.isFinite(input.expectedDraftUpdatedAt.getTime()) ||
        draft.updatedAt.getTime() !== input.expectedDraftUpdatedAt.getTime()
      ) {
        throw new CustomerPriceBookAdminError(
          '草稿已被其他管理员修改，请刷新后重试',
        );
      }

      const sourceRuleReferences = await tx.orderCustomerCharge.count({
        where: {
          sourceRule: { is: { priceBookId: draft.id } },
        },
      });
      if (draft._count.charges > 0 || sourceRuleReferences > 0) {
        throw new CustomerPriceBookAdminError('草稿已被工单收费事实引用，不能删除');
      }

      await writeAuditLogInTx(tx, {
        actor,
        action: 'DISCARD_DRAFT',
        entityType: 'CustomerPriceBook',
        entityId: draft.id,
        before: {
          id: draft.id,
          code: String(draft.code),
          version: draft.version,
          purpose: draft.purpose,
          ruleCount: draft._count.rules,
          workflow,
        },
        after: { discarded: true },
        requestMetadata: {
          source: 'customer-price-book-admin.discardCustomerPriceBookDraft',
        },
      });
      await tx.customerPriceRule.deleteMany({
        where: { priceBookId: draft.id },
      });
      await tx.customerPriceBook.delete({
        where: { id: draft.id },
        select: { id: true },
      });
      return { id: draft.id, purpose: draft.purpose };
    });
  } catch (error) {
    if (error instanceof CustomerPriceBookAdminError) throw error;
    throw mapConstraintError(error) ?? error;
  }
}

export async function cancelScheduledCustomerPriceBook(
  input: CancelScheduledCustomerPriceBookInput,
  actor: AuditActor,
  now: Date = new Date(),
): Promise<{ id: string; version: number; purpose: CustomerPriceBookPurpose }> {
  const reason = input.reason.trim();
  if (reason.length < 2 || reason.length > 500) {
    throw new CustomerPriceBookAdminError('取消原因需要 2–500 个字符');
  }

  try {
    return await db.$transaction(async (tx) => {
      await acquirePriceRuleSnapshotWriteLock(tx);
      const scheduled = await tx.customerPriceBook.findUnique({
        where: { id: input.priceBookId },
        select: {
          id: true,
          code: true,
          version: true,
          settlementType: true,
          purpose: true,
          effectiveFrom: true,
          effectiveTo: true,
          isActive: true,
          notes: true,
          updatedAt: true,
          _count: {
            select: { rules: true, charges: true, priceVersionLocks: true },
          },
        },
      });
      if (
        !scheduled ||
        scheduled.settlementType !== EXTERNAL_SETTLEMENT ||
        !scheduled.isActive ||
        scheduled.effectiveFrom <= now
      ) {
        throw new CustomerPriceBookAdminError('只能取消尚未生效的计划版本');
      }
      if (
        !Number.isFinite(input.expectedUpdatedAt.getTime()) ||
        scheduled.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
      ) {
        throw new CustomerPriceBookAdminError(
          '计划版本已被其他管理员修改，请刷新后重试',
        );
      }
      await assertScheduledBookIsUnreferenced(tx, {
        id: scheduled.id,
        priceVersionLockCount: scheduled._count.priceVersionLocks,
        chargeCount: scheduled._count.charges,
      });

      const predecessors = await tx.customerPriceBook.findMany({
        where: {
          settlementType: scheduled.settlementType,
          purpose: scheduled.purpose,
          isActive: true,
          id: { not: scheduled.id },
          effectiveFrom: { lt: scheduled.effectiveFrom },
          effectiveTo: scheduled.effectiveFrom,
        },
        select: {
          id: true,
          code: true,
          version: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
        orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
        take: 2,
      });
      if (predecessors.length !== 1) {
        throw new CustomerPriceBookAdminError(
          '计划版本的前驱版本不唯一，禁止取消以避免价格时间线断裂',
        );
      }
      const predecessor = predecessors[0]!;
      await assertCandidateProjectionForRange(tx, {
        candidatePriceBookId: predecessor.id,
        candidatePurpose: scheduled.purpose,
        start: scheduled.effectiveFrom,
        end: scheduled.effectiveTo,
      });

      const control: ScheduleControl = {
        status: 'CANCELLED',
        changedBy: actor.id,
        changedAt: now.toISOString(),
        reason,
        previousEffectiveFrom: scheduled.effectiveFrom.toISOString(),
        effectiveFrom: scheduled.effectiveFrom.toISOString(),
      };
      const deactivated = await tx.customerPriceBook.updateMany({
        where: {
          id: scheduled.id,
          isActive: true,
          updatedAt: input.expectedUpdatedAt,
          effectiveFrom: { gt: now },
        },
        data: {
          isActive: false,
          notes: scheduleControlNotes(scheduled.notes, control),
        },
      });
      if (deactivated.count !== 1) {
        throw new CustomerPriceBookAdminError(
          '计划版本已被其他管理员修改，请刷新后重试',
        );
      }
      await tx.customerPriceBook.update({
        where: { id: predecessor.id },
        data: { effectiveTo: scheduled.effectiveTo },
        select: { id: true },
      });
      await writeAuditLogInTx(tx, {
        actor,
        action: 'CANCEL_SCHEDULED_VERSION',
        entityType: 'CustomerPriceBook',
        entityId: scheduled.id,
        before: {
          id: scheduled.id,
          code: String(scheduled.code),
          version: scheduled.version,
          purpose: scheduled.purpose,
          effectiveFrom: scheduled.effectiveFrom,
          effectiveTo: scheduled.effectiveTo,
          isActive: true,
          ruleCount: scheduled._count.rules,
          predecessor,
        },
        after: {
          isActive: false,
          preservedRuleCount: scheduled._count.rules,
          predecessorEffectiveTo: scheduled.effectiveTo,
          control,
        },
        requestMetadata: {
          source: 'customer-price-book-admin.cancelScheduledCustomerPriceBook',
          reason,
        },
      });
      return {
        id: scheduled.id,
        version: scheduled.version,
        purpose: scheduled.purpose,
      };
    });
  } catch (error) {
    if (error instanceof CustomerPriceBookAdminError) throw error;
    throw mapConstraintError(error) ?? error;
  }
}

export async function rescheduleCustomerPriceBook(
  input: RescheduleCustomerPriceBookInput,
  actor: AuditActor,
  now: Date = new Date(),
): Promise<{ id: string; version: number; purpose: CustomerPriceBookPurpose }> {
  if (!Number.isFinite(input.effectiveFrom.getTime())) {
    throw new CustomerPriceBookAdminError('生效时间非法');
  }
  if (input.effectiveFrom <= now) {
    throw new CustomerPriceBookAdminError('改期后的生效时间必须晚于当前时间');
  }
  const reason = input.reason.trim();
  if (reason.length < 2 || reason.length > 500) {
    throw new CustomerPriceBookAdminError('改期原因需要 2–500 个字符');
  }

  try {
    return await db.$transaction(async (tx) => {
      await acquirePriceRuleSnapshotWriteLock(tx);
      const scheduled = await tx.customerPriceBook.findUnique({
        where: { id: input.priceBookId },
        select: {
          id: true,
          code: true,
          version: true,
          settlementType: true,
          purpose: true,
          effectiveFrom: true,
          effectiveTo: true,
          isActive: true,
          notes: true,
          updatedAt: true,
          _count: {
            select: { rules: true, charges: true, priceVersionLocks: true },
          },
        },
      });
      if (
        !scheduled ||
        scheduled.settlementType !== EXTERNAL_SETTLEMENT ||
        !scheduled.isActive ||
        scheduled.effectiveFrom <= now
      ) {
        throw new CustomerPriceBookAdminError('只能调整尚未生效的计划版本');
      }
      if (
        !Number.isFinite(input.expectedUpdatedAt.getTime()) ||
        scheduled.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
      ) {
        throw new CustomerPriceBookAdminError(
          '计划版本已被其他管理员修改，请刷新后重试',
        );
      }
      if (scheduled.effectiveFrom.getTime() === input.effectiveFrom.getTime()) {
        throw new CustomerPriceBookAdminError('新生效时间与当前计划时间相同');
      }
      if (
        scheduled.effectiveTo &&
        input.effectiveFrom >= scheduled.effectiveTo
      ) {
        throw new CustomerPriceBookAdminError('新生效时间必须早于后续版本');
      }
      await assertScheduledBookIsUnreferenced(tx, {
        id: scheduled.id,
        priceVersionLockCount: scheduled._count.priceVersionLocks,
        chargeCount: scheduled._count.charges,
      });

      const predecessors = await tx.customerPriceBook.findMany({
        where: {
          settlementType: scheduled.settlementType,
          purpose: scheduled.purpose,
          isActive: true,
          id: { not: scheduled.id },
          effectiveFrom: { lt: scheduled.effectiveFrom },
          effectiveTo: scheduled.effectiveFrom,
        },
        select: {
          id: true,
          code: true,
          version: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
        orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
        take: 2,
      });
      if (predecessors.length !== 1) {
        throw new CustomerPriceBookAdminError(
          '计划版本的前驱版本不唯一，禁止改期以避免价格时间线断裂',
        );
      }
      const predecessor = predecessors[0]!;
      if (input.effectiveFrom <= predecessor.effectiveFrom) {
        throw new CustomerPriceBookAdminError(
          '新生效时间必须晚于前驱版本的起始时间',
        );
      }
      if (input.effectiveFrom < scheduled.effectiveFrom) {
        await assertCandidateProjectionForRange(tx, {
          candidatePriceBookId: scheduled.id,
          candidatePurpose: scheduled.purpose,
          start: input.effectiveFrom,
          end: scheduled.effectiveFrom,
        });
      } else {
        await assertCandidateProjectionForRange(tx, {
          candidatePriceBookId: predecessor.id,
          candidatePurpose: scheduled.purpose,
          start: scheduled.effectiveFrom,
          end: input.effectiveFrom,
        });
        await assertCandidateProjectionForRange(tx, {
          candidatePriceBookId: scheduled.id,
          candidatePurpose: scheduled.purpose,
          start: input.effectiveFrom,
          end: input.effectiveFrom,
        });
      }

      const control: ScheduleControl = {
        status: 'RESCHEDULED',
        changedBy: actor.id,
        changedAt: now.toISOString(),
        reason,
        previousEffectiveFrom: scheduled.effectiveFrom.toISOString(),
        effectiveFrom: input.effectiveFrom.toISOString(),
      };
      const deactivated = await tx.customerPriceBook.updateMany({
        where: {
          id: scheduled.id,
          isActive: true,
          updatedAt: input.expectedUpdatedAt,
          effectiveFrom: { gt: now },
        },
        data: { isActive: false },
      });
      if (deactivated.count !== 1) {
        throw new CustomerPriceBookAdminError(
          '计划版本已被其他管理员修改，请刷新后重试',
        );
      }
      await tx.customerPriceBook.update({
        where: { id: predecessor.id },
        data: { effectiveTo: input.effectiveFrom },
        select: { id: true },
      });
      await tx.customerPriceBook.update({
        where: { id: scheduled.id },
        data: {
          effectiveFrom: input.effectiveFrom,
          isActive: true,
          notes: scheduleControlNotes(scheduled.notes, control),
        },
        select: { id: true },
      });
      await writeAuditLogInTx(tx, {
        actor,
        action: 'RESCHEDULE_VERSION',
        entityType: 'CustomerPriceBook',
        entityId: scheduled.id,
        before: {
          id: scheduled.id,
          code: String(scheduled.code),
          version: scheduled.version,
          purpose: scheduled.purpose,
          effectiveFrom: scheduled.effectiveFrom,
          effectiveTo: scheduled.effectiveTo,
          ruleCount: scheduled._count.rules,
          predecessor,
        },
        after: {
          effectiveFrom: input.effectiveFrom,
          effectiveTo: scheduled.effectiveTo,
          preservedRuleCount: scheduled._count.rules,
          predecessorEffectiveTo: input.effectiveFrom,
          control,
        },
        requestMetadata: {
          source: 'customer-price-book-admin.rescheduleCustomerPriceBook',
          reason,
        },
      });
      return {
        id: scheduled.id,
        version: scheduled.version,
        purpose: scheduled.purpose,
      };
    });
  } catch (error) {
    if (error instanceof CustomerPriceBookAdminError) throw error;
    throw mapConstraintError(error) ?? error;
  }
}

export async function publishCustomerPriceBookDraft(
  input: PublishCustomerPriceBookDraftInput,
  actor: AuditActor,
  /** Test-only clock instant. Production deliberately samples after locking. */
  suppliedNow?: Date,
): Promise<{ id: string; version: number; purpose: CustomerPriceBookPurpose }> {
  if (
    input.effectiveFrom !== undefined &&
    !Number.isFinite(input.effectiveFrom.getTime())
  ) {
    throw new CustomerPriceBookAdminError('生效时间非法');
  }

  try {
    return await db.$transaction(async (tx) => {
      await acquirePriceRuleSnapshotWriteLock(tx);
      // One timestamp drives current-version selection, the new half-open
      // window, published metadata and audit evidence. Sampling after the
      // write lock prevents an "immediate" request from becoming stale while
      // waiting for another price mutation.
      const canonicalNow = suppliedNow ?? new Date();
      const effectiveFrom = input.effectiveFrom ?? canonicalNow;
      if (effectiveFrom < canonicalNow) {
        throw new CustomerPriceBookAdminError(
          '价目版本不能追溯生效，请选择当前或未来时间',
        );
      }
      const draft = await tx.customerPriceBook.findUnique({
        where: { id: input.priceBookId },
        select: {
          id: true,
          code: true,
          name: true,
          settlementType: true,
          purpose: true,
          version: true,
          isActive: true,
          notes: true,
          updatedAt: true,
          rules: {
            select: IMPACT_RULE_SELECT,
            orderBy: [
              { categoryId: 'asc' },
              { priority: 'desc' },
              { code: 'asc' },
            ],
          },
        },
      });
      const workflow = draft ? draftWorkflow(draft.notes) : null;
      if (!draft || draft.isActive || !workflow) {
        throw new CustomerPriceBookAdminError('待发布的草稿价目簿不存在');
      }
      if (draft.settlementType !== EXTERNAL_SETTLEMENT) {
        throw new CustomerPriceBookAdminError('只能发布外部销售价目簿');
      }
      if (
        !Number.isFinite(input.expectedDraftUpdatedAt.getTime()) ||
        draft.updatedAt.getTime() !== input.expectedDraftUpdatedAt.getTime()
      ) {
        throw new CustomerPriceBookAdminError(
          '草稿已被其他管理员修改，请刷新后重试',
        );
      }
      const publishNote = input.publishNote?.trim() || workflow.changeReason.trim();
      if (publishNote.length < 2 || publishNote.length > 500) {
        throw new CustomerPriceBookAdminError('发布说明需要 2–500 个字符');
      }

      const normalizedRules = await assertValidRuleSet(
        tx,
        draft.id,
        draft.purpose,
      );
      const ruleSetSha256 = calculateCustomerPriceRuleSetSha256(normalizedRules);

      const currentBooks = await tx.customerPriceBook.findMany({
        where: {
          settlementType: draft.settlementType,
          purpose: draft.purpose,
          isActive: true,
          effectiveFrom: { lte: canonicalNow },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: canonicalNow } }],
        },
        select: {
          id: true,
          code: true,
          version: true,
          effectiveFrom: true,
          effectiveTo: true,
          rules: {
            select: IMPACT_RULE_SELECT,
            orderBy: [
              { categoryId: 'asc' },
              { priority: 'desc' },
              { code: 'asc' },
            ],
          },
        },
        orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
        take: 2,
      });
      if (currentBooks.length !== 1) {
        throw new CustomerPriceBookAdminError('当前生效价目版本不唯一，禁止发布草稿');
      }
      const current = currentBooks[0]!;
      if (current.id !== workflow.basedOn.id) {
        throw new CustomerPriceBookAdminError('草稿基于的旧版本已变化，请重新复制最新版本');
      }
      const highRiskRuleCount = buildImpactChanges(
        current.rules ?? [],
        draft.rules ?? [],
      ).filter(isHighRiskImpactChange).length;
      if (highRiskRuleCount > 0 && input.confirmedHighRisk !== true) {
        throw new CustomerPriceBookHighRiskConfirmationError();
      }
      const currentRuleSetSha256 = calculateCustomerPriceRuleSetSha256(
        await validationRules(tx, current.id),
      );
      if (ruleSetSha256 === currentRuleSetSha256) {
        throw new CustomerPriceBookAdminError(
          '草稿与当前版本没有价格或规则变化，无需发布',
        );
      }
      if (effectiveFrom <= current.effectiveFrom) {
        throw new CustomerPriceBookAdminError('新版本生效时间必须晚于当前版本起始时间');
      }
      if (current.effectiveTo && effectiveFrom > current.effectiveTo) {
        throw new CustomerPriceBookAdminError('新版本生效时间不能晚于当前版本既定截止时间');
      }

      const futureConflicts = await tx.customerPriceBook.findMany({
        where: {
          settlementType: draft.settlementType,
          purpose: draft.purpose,
          isActive: true,
          id: { not: current.id },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gt: effectiveFrom } },
          ],
        },
        select: { id: true, version: true },
        take: 1,
      });
      if (futureConflicts.length > 0) {
        throw new CustomerPriceBookAdminError('已有后续生效版本，不能发布重叠的新版本');
      }

      try {
        await readCandidatePublishedCreateOrderPriceProjection(tx, {
          candidatePriceBookId: draft.id,
          effectiveFrom,
          snapshotLockHeld: true,
        });
      } catch (error) {
        if (error instanceof PublishedCreateOrderPriceAdapterError) {
          throw new CustomerPriceBookAdminError(
            `候选价目版本无法供建单计价：${error.message}`,
          );
        }
        throw error;
      }

      // The exclusion constraint is immediate. Close the old half-open window
      // before activating the draft so no statement temporarily overlaps.
      await tx.customerPriceBook.update({
        where: { id: current.id },
        data: { effectiveTo: effectiveFrom },
        select: { id: true },
      });
      const published = await tx.customerPriceBook.update({
        where: { id: draft.id },
        data: {
          effectiveFrom,
          effectiveTo: null,
          isActive: true,
          notes: publishedNotes(
            draft.notes,
            workflow,
            actor,
            effectiveFrom,
            canonicalNow,
            ruleSetSha256,
            publishNote,
          ),
        },
        select: { id: true, version: true, purpose: true },
      });
      await writeAuditLogInTx(tx, {
        actor,
        action: 'PUBLISH_VERSION',
        entityType: 'CustomerPriceBook',
        entityId: published.id,
        before: {
          draft: {
            id: draft.id,
            version: draft.version,
            isActive: draft.isActive,
          },
          previousVersion: {
            id: current.id,
            code: String(current.code),
            version: current.version,
            effectiveFrom: current.effectiveFrom,
            effectiveTo: current.effectiveTo,
          },
        },
        after: {
          ...published,
          effectiveFrom,
          previousEffectiveTo: effectiveFrom,
          ruleSetSha256,
          publishNote,
        },
        requestMetadata: {
          source: 'customer-price-book-admin.publishCustomerPriceBookDraft',
          basedOnPriceBookId: current.id,
          highRiskRuleCount,
          highRiskConfirmed:
            highRiskRuleCount > 0 ? input.confirmedHighRisk === true : false,
        },
      });
      return published;
    });
  } catch (error) {
    if (error instanceof CustomerPriceBookAdminError) throw error;
    throw mapConstraintError(error) ?? error;
  }
}

/** Add catalog combinations and their draft prices under the same pricing write lock. */
export async function addBlankPaperDraft(
  raw: AddBlankPaperInput,
  actor: AuditActor,
  now: Date = new Date(),
): Promise<{ paperId: string; priceBookId: string }> {
  const input = addBlankPaperSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const book = await tx.customerPriceBook.findUnique({
      where: { id: input.priceBookId },
    });
    const workflow = book ? draftWorkflow(book.notes) : null;
    if (
      !book ||
      !workflow ||
      book.isActive ||
      book.purpose !== 'PROCESSING' ||
      book.settlementType !== EXTERNAL_SETTLEMENT
    ) {
      throw new CustomerPriceBookAdminError(
        '加工费草稿不可编辑，请返回价格表重新发起调价',
      );
    }
    if (book.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw new CustomerPriceBookAdminError('草稿已变化，请刷新后重新提交');
    }
    const rules = await tx.customerPriceRule.findMany({
      where: { priceBookId: book.id, exclusiveGroup: 'STOCK_BASE' },
      include: { product: { include: { categoryNode: true } } },
    });
    const anchor = rules.find(
      (rule) =>
        rule.product?.isActive &&
        rule.product.categoryNode.isActive &&
        rule.product.category === 'BLANK_STOCK',
    );
    if (!anchor?.product)
      throw new CustomerPriceBookAdminError(
        '空白封产品分类未配置，请先配置可建单产品组合',
      );
    const papers = await tx.material.findMany({ where: { category: 'PAPER' } });
    const existingPaperId =
      input.paper.mode === 'existing' ? input.paper.id : null;
    const selected = papers.find((paper) => paper.id === existingPaperId);
    const fact =
      input.paper.mode === 'new'
        ? canonicalizeCreateOrderPaperFact(input.paper.name, input.paper.weight)
        : selected
          ? blankPaperFact(selected)
          : null;
    if (!fact || fact.paperWeightGsm > 2000)
      throw new CustomerPriceBookAdminError(
        '纸张名称或克重不完整，请先完善纸张资料',
      );
    const label = `${fact.paperWeightGsm}g${fact.paperType}`;
    const matches = findCatalogPaperIdentityMatches(papers, {
      name: label, specification: `${fact.paperWeightGsm}g`,
    });
    if (matches.length > 1)
      throw new CustomerPriceBookAdminError(
        '同名同克重纸张存在重复记录，请先在纸张管理中处理',
      );
    let paper = selected ?? matches[0];
    if (paper && (!paper.isActive || paper.outOfStock))
      throw new CustomerPriceBookAdminError(
        '纸张已停用或缺货，请先在纸张管理中处理',
      );
    if (
      input.paper.mode === 'existing' &&
      (!selected || matches[0]?.id !== selected.id)
    ) {
      throw new CustomerPriceBookAdminError('纸张资料已变化，请刷新后重新选择');
    }
    const hash = createHash('sha256').update(label).digest('hex').slice(0, 20);
    if (!paper) {
      paper = await tx.material.create({
        data: {
          code: `PAPER-${hash}`,
          name: label,
          specification: `${fact.paperWeightGsm}g`,
          category: 'PAPER',
          unit: '张',
        },
      });
      await writeAuditLogInTx(tx, {
        actor,
        action: 'CREATE',
        entityType: 'Material',
        entityId: paper.id,
        before: null,
        after: paper,
      });
    }
    const products = await tx.product.findMany({
      where: { category: 'BLANK_STOCK' },
      include: { categoryNode: true },
    });
    const createdRuleIds: string[] = [];
    for (const entry of input.specifications) {
      const spec = BLANK_SPECIFICATIONS.find((spec) => spec.key === entry.key)!;
      const duplicate = rules.some((rule) => {
        const condition = parseCustomerRuleCondition(
          rule.triggerCondition,
        ).condition;
        return (
          condition?.paperTypes?.some((name) => {
            const candidate = canonicalizeCreateOrderPaperFact(name);
            return (
              candidate?.paperType === fact.paperType &&
              candidate.paperWeightGsm === fact.paperWeightGsm
            );
          }) &&
          condition.specifications?.some(
            (name) => blankSpecificationKey(name) === entry.key,
          )
        );
      });
      if (duplicate)
        throw new CustomerPriceBookAdminError(
          `${spec.label}已有价格记录，请返回价格表修改`,
        );
      const matchingProducts = products.filter((product) => {
        const candidate = product.paperType
          ? canonicalizeCreateOrderPaperFact(product.paperType, product.weight)
          : null;
        return (
          (product.paperMaterialId === paper.id ||
            (candidate?.paperType === fact.paperType &&
              candidate.paperWeightGsm === fact.paperWeightGsm)) &&
          blankSpecificationKey(product.specification) === entry.key
        );
      });
      if (matchingProducts.length > 1)
        throw new CustomerPriceBookAdminError(
          `${spec.label}有重复产品组合，请先在产品组合中处理`,
        );
      let product = matchingProducts[0];
      const productFact = product?.paperType
        ? canonicalizeCreateOrderPaperFact(product.paperType, product.weight)
        : null;
      if (
        product &&
        (!product.isActive ||
          !product.categoryNode.isActive ||
          productFact?.paperType !== fact.paperType ||
          productFact.paperWeightGsm !== fact.paperWeightGsm ||
          (product.paperMaterialId && product.paperMaterialId !== paper.id))
      ) {
        throw new CustomerPriceBookAdminError(
          `${spec.label}产品组合已停用或纸张关联不一致，请先检查产品组合`,
        );
      }
      if (!product) {
        product = await tx.product.create({
          data: {
            code: `BLANK-${hash}-${spec.key}`,
            name: `${label} ${spec.label}`,
            category: 'BLANK_STOCK',
            categoryNodeId: anchor.product.categoryNodeId,
            paperMaterialId: paper.id,
            paperType: label,
            weight: fact.paperWeightGsm,
            specification: spec.specification,
          },
          include: { categoryNode: true },
        });
        await writeAuditLogInTx(tx, {
          actor,
          action: 'CREATE',
          entityType: 'Product',
          entityId: product.id,
          before: null,
          after: product,
        });
      }
      if (!product.paperMaterialId) {
        const before = product;
        product = await tx.product.update({
          where: { id: product.id },
          data: { paperMaterialId: paper.id },
          include: { categoryNode: true },
        });
        await writeAuditLogInTx(tx, {
          actor,
          action: 'LINK_PAPER',
          entityType: 'Product',
          entityId: product.id,
          before,
          after: product,
        });
      }
      // An enabled catalog combination without a rule uses the existing manual-pricing path.
      if (entry.amount === null) continue;
      const rule = await tx.customerPriceRule.create({
        data: {
          priceBookId: book.id,
          categoryId: anchor.categoryId,
          productId: product.id,
          code: `STOCK-BASE-${hash}-${spec.key}`,
          name: `${label} ${spec.label}空白封单价`,
          kind: 'BASE',
          calculationType: 'PER_PIECE',
          amount: new Prisma.Decimal(entry.amount),
          minQty: 1,
          maxQty: null,
          exclusiveGroup: 'STOCK_BASE',
          triggerCondition: {
            schemaVersion: 1,
            target: 'ITEM',
            pricingRoutes: ['STOCK_BLANK'],
            paperTypes: [label],
            specifications: [spec.label],
          },
        },
      });
      createdRuleIds.push(rule.id);
      await writeAuditLogInTx(tx, {
        actor,
        action: 'CREATE_DRAFT_RULE',
        entityType: 'CustomerPriceRule',
        entityId: rule.id,
        before: null,
        after: rule,
      });
    }
    await assertValidRuleSet(tx, book.id, book.purpose);
    const editedAt = new Date(
      Math.max(now.getTime(), book.updatedAt.getTime() + 1),
    );
    await tx.customerPriceBook.update({
      where: { id: book.id },
      data: {
        updatedAt: editedAt,
        notes: notesInput({
          ...notesRecord(book.notes),
          workflow: {
            ...workflow,
            lastEditedBy: actor.id,
            lastEditedAt: editedAt.toISOString(),
          },
        }),
      },
    });
    await writeAuditLogInTx(tx, {
      actor,
      action: 'ADD_BLANK_PAPER',
      entityType: 'CustomerPriceBook',
      entityId: book.id,
      before: { updatedAt: book.updatedAt },
      after: {
        paperId: paper.id,
        ruleIds: createdRuleIds,
        updatedAt: editedAt,
      },
    });
    return { paperId: paper.id, priceBookId: book.id };
  });
}
