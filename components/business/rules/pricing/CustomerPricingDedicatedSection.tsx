import 'server-only';

import { fixedCustomTierIssue } from '@/lib/price/fixed-custom-tiers';

import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import {
  updateCustomerPriceSectionDraftFormAction,
  type CustomerPriceSectionFormBinding,
  type CustomerPriceSectionFormContext,
} from '@/actions/customer-price-books';
import { CreateCustomerPriceBookDraftForm } from '@/components/business/price/ExternalSalesPriceBookDraftForms';
import {
  PriceWorkspaceLink,
  PriceWorkspaceNavigationGuardProvider,
} from '@/components/business/price/PriceWorkspaceNavigationGuard';
import {
  RulePriceWorkspaceStatusBand,
  type ExternalSalesChargeDraftSummary,
  type ExternalSalesChargeWorkspaceStatus,
} from '@/components/business/price/RulePriceWorkspaceStatusBand';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
} from '@/generated/prisma/enums';
import type {
  CustomerPriceSection,
  CustomerPriceSectionRuleDto,
  CustomerPriceSectionRuleValueDto,
  CustomerPriceSectionWorkspaceDto,
  CustomerPriceSectionWorkspaceStateDto,
} from '@/lib/price/customer-price-section-workspace';
import {
  RULE_CENTER_HREFS,
  priceVersionsHref,
} from '@/lib/navigation/rule-center';
import { cn } from '@/lib/utils';
import { CustomerPricingCreateDraftDialog } from './CustomerPricingCreateDraftDialog';
import { CustomerPricingRuleFocus } from './CustomerPricingRuleFocus';
import { CustomerPricingSectionDraftForm } from './CustomerPricingSectionDraftForm';
import { CustomerPricingUrlCleanup } from './CustomerPricingUrlCleanup';
import {
  CustomerAddsPricingSectionView,
  CustomerBlankPricingSectionView,
  CustomerMachinePricingSectionView,
  CustomerPrintPricingSectionView,
  CustomerShipPricingSectionView,
  CustomerTiersPricingSectionView,
  type CustomerBlankPricingRow,
  type CustomerCartonPricingTierRow,
  type CustomerPricingAdjustmentRow,
  type CustomerPrintPricingRow,
  type CustomerShippingZoneRow,
  type CustomerTierPricingRow,
  type PricingMatrixCell,
  type PricingMatrixColumn,
  type PricingNumericFieldState,
  type PricingNumericValue,
} from './CustomerPricingSectionViews';
import { formatDateTimeShanghai } from '@/lib/format/dates';

export type CustomerPricingDedicatedSectionProps = {
  workspace: CustomerPriceSectionWorkspaceDto;
  createDraftPurpose: CustomerPriceBookPurpose | null;
  focusRuleId?: string | null;
};

type EditableSectionField =
  | 'amount'
  | 'minQty'
  | 'maxQty'
  | 'includedUnits'
  | 'incrementUnits'
  | 'incrementAmount';

type FieldTarget = {
  rule: CustomerPriceSectionRuleDto;
  field: EditableSectionField;
  integerOffset?: number;
};

type FormAssembly = {
  rows: CustomerPriceSectionFormContext['rows'];
  bindings: CustomerPriceSectionFormBinding[];
  rowIndexByRule: Map<CustomerPriceSectionRuleDto, number>;
  warnings: Set<string>;
};

const BLANK_COLUMNS = [
  { key: 'mini', label: '迷你封', suffix: '-MINI' },
  { key: 'square', label: '方形', suffix: '-SQUARE' },
  { key: 'mid', label: '中号封', suffix: '-MID' },
  { key: 'large', label: '大号封', suffix: '-LARGE' },
  { key: 'west-mid', label: '西封中号', suffix: '-WEST-MID' },
  { key: 'west-large', label: '西封大号', suffix: '-WEST-LARGE' },
] as const;

const BLANK_PAPER_ORDER = [
  '120g珠光艳闪',
  '160g珠光艳闪',
  '160g珠光闪红',
  '160g红卡',
  '180g红卡',
  '230g红卡',
  '200g触感纸',
  '160g杂色珠光',
  '230g金葱',
] as const;

const CUSTOM_PRODUCT_CODES = [
  'EXT-CUSTOM-MID',
  'EXT-CUSTOM-SQUARE',
  'EXT-CUSTOM-WEST-MID',
  'EXT-CUSTOM-LARGE',
  'EXT-CUSTOM-WEST-LARGE',
] as const;

const CUSTOM_MIDDLE_CODES = new Set([
  'EXT-CUSTOM-MID',
  'EXT-CUSTOM-SQUARE',
  'EXT-CUSTOM-WEST-MID',
]);

const CUSTOM_LARGE_CODES = new Set([
  'EXT-CUSTOM-LARGE',
  'EXT-CUSTOM-WEST-LARGE',
]);

const TIER_NAMES = [
  '500个档',
  '1千档',
  '2千档',
  '3千档',
  '4千档',
  '5千档',
  '1万档',
  '2万档',
  '3万档',
  '5万档',
] as const;

const PRINT_COLUMNS = [
  { key: 'Q100', label: '100' },
  { key: 'Q200', label: '200' },
  { key: 'Q300', label: '300' },
  { key: 'Q400', label: '400' },
  { key: 'Q500', label: '500' },
  { key: 'Q1000', label: '1千' },
  { key: 'Q2000', label: '2千' },
  { key: 'Q3000', label: '3千' },
  { key: 'Q4000', label: '4千' },
  { key: 'Q5000', label: '5千' },
  { key: 'Q10000', label: '1万' },
  { key: 'Q20000', label: '2万' },
  { key: 'Q30000', label: '3万' },
] as const;

const PRINT_PRODUCTS = [
  { code: 'EXT-COLOR-COATED-200-LARGE', label: '铜版200g 大号' },
  { code: 'EXT-COLOR-COATED-200-MID', label: '铜版200g 中号' },
  { code: 'EXT-COLOR-ICE-WHITE-160-LARGE', label: '冰白160g 大号' },
  { code: 'EXT-COLOR-ICE-WHITE-160-MID', label: '冰白160g 中号' },
] as const;

const ADD_PAPER_CODES = [
  'CUSTOM_PAPER_VARIEGATED_PEARL_160',
  'CUSTOM_PAPER_LINEN_150',
  'CUSTOM_PAPER_RED_CARD_180',
  'CUSTOM_PAPER_RED_CARD_230',
  'CUSTOM_PAPER_GOLD_GLITTER_230',
  'CUSTOM_PAPER_SOFT_TOUCH_200',
] as const;

const ADD_CRAFTS = [
  {
    code: 'CUSTOM_WESTERN_ENVELOPE',
    label: '西封',
    description: '中号或大号均适用',
  },
  {
    code: 'CUSTOM_DOUBLE_COLOR',
    label: '双色',
    description: '专版同面第二色',
  },
  {
    code: 'CUSTOM_RELIEF_OR_RAISED_PIECE',
    label: '浮雕 / 激凸',
    description: '二选一',
  },
  {
    code: 'CUSTOM_RELIEF_OR_RAISED_SETUP',
    label: '调版费',
    description: '浮雕或激凸触发，一次性',
  },
] as const;

const ZTO_PROVINCE_ORDER = [
  '广东',
  '江西',
  '江苏',
  '安徽',
  '湖南',
  '湖北',
  '广西',
  '浙江',
  '福建',
  '天津',
  '上海',
  '北京',
  '河南',
  '河北',
  '四川',
  '重庆',
  '贵州',
  '山东',
  '云南',
  '山西',
  '陕西',
  '黑龙江',
  '吉林',
  '辽宁',
  '海南',
  '甘肃',
  '青海',
  '宁夏',
  '内蒙古',
  '新疆',
  '西藏',
] as const;

const ZTO_ZONE_PROVINCES: Readonly<Record<string, readonly string[]>> = {
  ZTO_GUANGDONG: ['广东'],
  ZTO_STANDARD_2_8: [
    '江西',
    '江苏',
    '安徽',
    '湖南',
    '湖北',
    '广西',
    '浙江',
    '福建',
  ],
  ZTO_STANDARD_3_5: [
    '天津',
    '上海',
    '北京',
    '河南',
    '河北',
    '四川',
    '重庆',
    '贵州',
    '山东',
  ],
  ZTO_STANDARD_4_5: [
    '云南',
    '山西',
    '陕西',
    '黑龙江',
    '吉林',
    '辽宁',
    '海南',
  ],
  ZTO_REMOTE_FIRST_10: ['甘肃', '青海', '宁夏', '内蒙古'],
  ZTO_REMOTE_FIRST_12: ['新疆', '西藏'],
};

function effectiveRule(
  rule: CustomerPriceSectionRuleDto,
): CustomerPriceSectionRuleValueDto | null {
  return rule.draft ?? rule.current;
}

function upper(value: string | null | undefined): string {
  return value?.toUpperCase() ?? '';
}

function ownsSectionRule(
  section: CustomerPriceSection,
  rule: CustomerPriceSectionRuleDto,
): boolean {
  const selected = effectiveRule(rule);
  if (!selected) return false;
  const code = upper(selected.code);
  const group = upper(selected.exclusiveGroup);
  if (section === 'blank') {
    return rule.purpose === CustomerPriceBookPurpose.PROCESSING && group === 'STOCK_BASE';
  }
  if (section === 'machine') {
    return (
      rule.purpose === CustomerPriceBookPurpose.PROCESSING &&
      group === 'STOCK_LOCAL_FOIL_MACHINE'
    );
  }
  if (section === 'tiers') {
    return rule.purpose === CustomerPriceBookPurpose.PROCESSING && group === 'CUSTOM_BASE';
  }
  if (section === 'adds') {
    return (
      rule.purpose === CustomerPriceBookPurpose.PROCESSING &&
      (code.startsWith('CUSTOM_PAPER_') ||
        ADD_CRAFTS.some((entry) => entry.code === code))
    );
  }
  if (section === 'print') {
    return (
      rule.purpose === CustomerPriceBookPurpose.PROCESSING &&
      (group === 'COLOR_BASE' || group === 'COLOR_SINGLE_FRONT_FOIL')
    );
  }
  if (rule.purpose === CustomerPriceBookPurpose.LOGISTICS) {
    return (
      group === 'CARTON_ORDER_QUANTITY_TIER' ||
      group === 'ZTO_PROVINCE_RATE'
    );
  }
  return (
    rule.purpose === CustomerPriceBookPurpose.PROCESSING &&
    (code === 'PACKAGING_SINGLE_STYLE_PER_BAG' ||
      code === 'PACKAGING_MIXED_STYLE_PER_BAG')
  );
}

function buildFormAssembly(
  workspace: CustomerPriceSectionWorkspaceDto,
): FormAssembly {
  const assembly: FormAssembly = {
    rows: [],
    bindings: [],
    rowIndexByRule: new Map(),
    warnings: new Set(),
  };
  for (const source of workspace.sources) {
    if (!source.draft) continue;
    const rules = workspace.rules.filter(
      (rule) =>
        rule.purpose === source.purpose &&
        ownsSectionRule(workspace.section, rule),
    );
    if (rules.length === 0) continue;
    if (
      rules.some(
        (rule) => rule.draft === null || rule.expectedUpdatedAt === null,
      )
    ) {
      assembly.warnings.add(
        `${source.purpose === CustomerPriceBookPurpose.LOGISTICS ? '物流' : '加工费'}草稿资料不完整，暂不可编辑。请刷新后重试。`,
      );
      continue;
    }
    for (const rule of rules) {
      const draft = rule.draft!;
      const rowIndex = assembly.rows.length;
      assembly.rowIndexByRule.set(rule, rowIndex);
      assembly.rows.push({
        priceBookId: source.draft.id,
        ruleId: draft.id,
        expectedUpdatedAt: rule.expectedUpdatedAt!,
        amount: draft.amount,
        minQty: draft.minQty,
        maxQty: draft.maxQty,
        includedUnits: draft.includedUnits,
        incrementUnits: draft.incrementUnits,
        incrementAmount: draft.incrementAmount,
      });
    }
  }
  return assembly;
}

function inputId(name: string): string {
  return `customer-section-${name.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
}

function focusedInputId(
  assembly: FormAssembly,
  focusRuleId: string | null | undefined,
): string | null {
  if (!focusRuleId) return null;
  const rowIndex = assembly.rows.findIndex((row) => row.ruleId === focusRuleId);
  if (rowIndex < 0) return null;

  const matchingBindings = assembly.bindings.filter((binding) =>
    binding.targets.some((target) => target.rowIndex === rowIndex),
  );
  const preferred =
    matchingBindings.find((binding) =>
      binding.targets.some(
        (target) => target.rowIndex === rowIndex && target.field === 'amount',
      ),
    ) ?? matchingBindings[0];
  return preferred ? inputId(preferred.inputName) : null;
}

function missingField(name: string): PricingNumericFieldState {
  return {
    id: inputId(name),
    name,
    value: null,
    editable: false,
    disabled: true,
    changed: false,
  };
}

function readonlyField(
  name: string,
  value: PricingNumericValue,
  changed = false,
): PricingNumericFieldState {
  return {
    id: inputId(name),
    name,
    value,
    editable: false,
    changed,
  };
}

function boundField(
  assembly: FormAssembly,
  inputName: string,
  value: PricingNumericValue,
  targets: readonly FieldTarget[],
  options: { allowEdit?: boolean; disabled?: boolean; changed?: boolean } = {},
): PricingNumericFieldState {
  const mappedTargets = targets.map((target) => {
    const rowIndex = assembly.rowIndexByRule.get(target.rule);
    return rowIndex === undefined
      ? null
      : {
          rowIndex,
          field: target.field,
          ...(target.integerOffset === undefined
            ? {}
            : { integerOffset: target.integerOffset }),
        };
  });
  const editable =
    options.allowEdit !== false &&
    !options.disabled &&
    targets.length > 0 &&
    mappedTargets.every((target) => target !== null);
  if (editable) {
    assembly.bindings.push({
      inputName,
      targets: mappedTargets.filter(
        (target): target is NonNullable<typeof target> => target !== null,
      ),
    });
  }
  return {
    id: inputId(inputName),
    name: inputName,
    value,
    editable,
    disabled: options.disabled,
    changed: options.changed ?? targets.some((target) => target.rule.changed),
  };
}

function selectedFieldValue(
  rule: CustomerPriceSectionRuleDto,
  field: EditableSectionField,
): PricingNumericValue {
  return effectiveRule(rule)?.[field] ?? null;
}

function sameValues(values: readonly PricingNumericValue[]): boolean {
  return values.every((value) => value === values[0]);
}

function ruleField(
  assembly: FormAssembly,
  inputName: string,
  rules: readonly CustomerPriceSectionRuleDto[],
  field: EditableSectionField,
  options: { allowEdit?: boolean; disabled?: boolean } = {},
): PricingNumericFieldState {
  if (rules.length === 0) return missingField(inputName);
  const values = rules.map((rule) => selectedFieldValue(rule, field));
  const consistent = sameValues(values);
  if (!consistent) {
    assembly.warnings.add(
      '同一视觉输入对应的底层规则值不一致，已禁止合并修改。',
    );
  }
  return boundField(
    assembly,
    inputName,
    consistent ? values[0] ?? null : null,
    rules.map((rule) => ({ rule, field })),
    { ...options, allowEdit: options.allowEdit !== false && consistent },
  );
}

function ruleByCode(
  rules: readonly CustomerPriceSectionRuleDto[],
  code: string,
): CustomerPriceSectionRuleDto | undefined {
  return rules.find((rule) => upper(effectiveRule(rule)?.code) === code);
}

function productCode(rule: CustomerPriceSectionRuleDto): string {
  return upper(effectiveRule(rule)?.product?.code);
}

function formatShanghaiDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return formatDateTimeShanghai(date);
}

function sectionHref(
  section: CustomerPriceSection,
  additions: Record<string, string | number> = {},
): string {
  const params = new URLSearchParams({ section });
  for (const [key, value] of Object.entries(additions)) {
    params.set(key, String(value));
  }
  return `${RULE_CENTER_HREFS.customerPricing}?${params.toString()}`;
}

function workspaceStatus(
  source: CustomerPriceSectionWorkspaceStateDto,
): ExternalSalesChargeWorkspaceStatus {
  return source.scheduledBook
    ? 'SCHEDULED'
    : source.currentBook
      ? 'CURRENT'
      : 'UNAVAILABLE';
}

function draftSummary(
  section: CustomerPriceSection,
  source: CustomerPriceSectionWorkspaceStateDto,
): ExternalSalesChargeDraftSummary | null {
  if (!source.draft) return null;
  return {
    version: source.draft.version,
    changeReason: source.draft.changeReason,
    changedCount: source.draft.changedCount,
    lastSavedLabel: formatShanghaiDateTime(source.draft.updatedAt),
    compareHref: sectionHref(section, { changed: 1 }),
    publishHref: priceVersionsHref(source.draft.id),
  };
}

function canCreateDraft(
  source: CustomerPriceSectionWorkspaceStateDto,
): boolean {
  return (
    source.draft === null &&
    source.scheduledBook === null &&
    source.draftCreation.allowed
  );
}

function sourcePurposeLabel(
  workspace: CustomerPriceSectionWorkspaceDto,
  source: CustomerPriceSectionWorkspaceStateDto,
): string {
  if (source.purpose === CustomerPriceBookPurpose.LOGISTICS) {
    return '物流费';
  }
  return workspace.section === 'ship' ? '入袋费' : '加工费';
}

function createDraftActionLabel(
  workspace: CustomerPriceSectionWorkspaceDto,
  source: CustomerPriceSectionWorkspaceStateDto,
  selected: boolean,
): string {
  if (workspace.section !== 'ship') {
    return selected ? '收起调价' : '发起调价';
  }
  return source.purpose === CustomerPriceBookPurpose.LOGISTICS
    ? selected
      ? '收起物流费调价'
      : '调整物流费'
    : selected
      ? '收起入袋费调价'
      : '调整入袋费';
}

function createDraftHref(
  workspace: CustomerPriceSectionWorkspaceDto,
  source: CustomerPriceSectionWorkspaceStateDto,
): string {
  return sectionHref(workspace.section, {
    start: 1,
    purpose: source.purpose.toLowerCase(),
  });
}

function createDraftDialogId(
  workspace: CustomerPriceSectionWorkspaceDto,
  source: CustomerPriceSectionWorkspaceStateDto,
): string {
  return `customer-pricing-${workspace.section}-${source.purpose.toLowerCase()}-draft-dialog`;
}

function VersionHeadingActions({
  workspace,
  createDraftPurpose,
}: CustomerPricingDedicatedSectionProps) {
  const sources = workspace.sources.filter(canCreateDraft);
  if (sources.length === 0) return null;

  return (
    <>
      {sources.map((source) => {
        const selected = createDraftPurpose === source.purpose;
        return (
          <PriceWorkspaceLink
            key={source.purpose}
            href={
              selected
                ? sectionHref(workspace.section)
                : createDraftHref(workspace, source)
            }
            prefetch={false}
            aria-controls={
              selected ? createDraftDialogId(workspace, source) : undefined
            }
            aria-expanded={selected}
            aria-haspopup="dialog"
            data-state={selected ? 'open' : 'closed'}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'min-h-11 shrink-0',
              selected && 'border-foreground bg-muted',
            )}
          >
            {createDraftActionLabel(workspace, source, selected)}
          </PriceWorkspaceLink>
        );
      })}
    </>
  );
}

function CompactVersionStatus({
  workspace,
  source,
}: {
  workspace: CustomerPriceSectionWorkspaceDto;
  source: CustomerPriceSectionWorkspaceStateDto;
}) {
  const scheduled = source.scheduledBook;
  const unavailable = !source.currentBook;
  if (!scheduled && !unavailable) return null;
  const purposeLabel = sourcePurposeLabel(workspace, source);
  const message = scheduled
    ? `第 ${scheduled.version} 版已安排在 ${formatShanghaiDateTime(
        scheduled.effectiveFrom,
      )} 生效；生效前不能再发起新调价。`
    : source.draftCreation.blockedReason ?? '请在价格版本中检查。';

  return (
    <section
      aria-label={`${purposeLabel}价格状态`}
      className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2"
    >
      <Badge variant={scheduled ? 'secondary' : 'destructive'}>
        {purposeLabel} · {scheduled ? '等待生效' : '暂无生效价'}
      </Badge>
      <p className="admin-wrap-anywhere text-xs leading-5 text-muted-foreground">
        {message}
      </p>
    </section>
  );
}

function VersionStatusBlocks({
  workspace,
}: Pick<CustomerPricingDedicatedSectionProps, 'workspace'>) {
  const multiple = workspace.sources.length > 1;
  const blocks = workspace.sources.map((source) => {
    if (source.draft) {
      return (
        <div key={source.purpose} className="min-w-0 space-y-1.5">
          {multiple ? (
            <p className="text-xs font-extrabold tracking-wide text-muted-foreground">
              {sourcePurposeLabel(workspace, source)}
            </p>
          ) : null}
          <RulePriceWorkspaceStatusBand
            ariaLabel={
              multiple
                ? `${sourcePurposeLabel(workspace, source)}调价草稿状态`
                : undefined
            }
            draft={draftSummary(workspace.section, source)}
            workspaceStatus={workspaceStatus(source)}
          />
        </div>
      );
    }

    if (source.scheduledBook || !source.currentBook) {
      return (
        <CompactVersionStatus
          key={source.purpose}
          workspace={workspace}
          source={source}
        />
      );
    }

    return null;
  });

  return blocks.some(Boolean) ? (
    <div className="min-w-0 space-y-3">{blocks}</div>
  ) : null;
}

function SelectedCreateDraftDialog({
  workspace,
  createDraftPurpose,
}: CustomerPricingDedicatedSectionProps) {
  if (createDraftPurpose === null) return null;

  const returnHref = sectionHref(workspace.section);
  const source = workspace.sources.find(
    (candidate) => candidate.purpose === createDraftPurpose,
  );
  if (!source || !canCreateDraft(source)) {
    return <CustomerPricingUrlCleanup href={returnHref} />;
  }

  return (
    <CustomerPricingCreateDraftDialog
      dialogId={createDraftDialogId(workspace, source)}
      open
      purposeLabel={sourcePurposeLabel(workspace, source)}
      returnHref={returnHref}
    >
      <CreateCustomerPriceBookDraftForm
        purpose={source.purpose}
        purposeLabel={sourcePurposeLabel(workspace, source)}
        returnHref={returnHref}
        presentation="dialog"
      />
    </CustomerPricingCreateDraftDialog>
  );
}

function WarningBlocks({
  warnings,
  shippingPolicyReadOnly,
}: {
  warnings: readonly string[];
  shippingPolicyReadOnly: boolean;
}) {
  if (warnings.length === 0 && !shippingPolicyReadOnly) return null;
  return (
    <div className="min-w-0 space-y-2">
      {warnings.length > 0 ? (
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>
            {warnings.some((warning) => warning.includes('5万档'))
              ? '当前价目缺少设计档位'
              : '部分价格暂不可编辑'}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-5">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {shippingPolicyReadOnly ? (
        <Alert variant="info" role="status">
          <Info aria-hidden="true" />
          <AlertTitle>物流重量参数</AlertTitle>
          <AlertDescription>
            红包单重与快递数量上限
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function blankColumnKey(code: string): string | null {
  const ordered = [
    BLANK_COLUMNS[4],
    BLANK_COLUMNS[5],
    BLANK_COLUMNS[0],
    BLANK_COLUMNS[1],
    BLANK_COLUMNS[2],
    BLANK_COLUMNS[3],
  ];
  return ordered.find((column) => code.endsWith(column.suffix))?.key ?? null;
}

function paperParts(paperType: string | null | undefined): {
  paperName: string;
  weight: string;
} {
  const value = paperType?.trim() || '未设置纸张';
  const match = /^(\d+)g(.+)$/u.exec(value);
  return match
    ? { paperName: match[2]!.trim(), weight: match[1]! }
    : { paperName: value, weight: '—' };
}

function renderBlank(
  workspace: CustomerPriceSectionWorkspaceDto,
  assembly: FormAssembly,
) {
  const byPaper = new Map<string, CustomerPriceSectionRuleDto[]>();
  for (const rule of workspace.rules) {
    const paper = effectiveRule(rule)?.product?.paperType ?? '未设置纸张';
    const rows = byPaper.get(paper) ?? [];
    rows.push(rule);
    byPaper.set(paper, rows);
  }
  const paperPriority = new Map<string, number>(
    BLANK_PAPER_ORDER.map((paper, index) => [paper, index]),
  );
  const rows: CustomerBlankPricingRow[] = [...byPaper]
    .sort(
      ([left], [right]) =>
        (paperPriority.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (paperPriority.get(right) ?? Number.MAX_SAFE_INTEGER) ||
        left.localeCompare(right, 'zh-CN'),
    )
    .map(([paper, rules]) => {
      const parts = paperParts(paper);
      const cells: PricingMatrixCell[] = BLANK_COLUMNS.map((column) => {
        const matched = rules.find(
          (rule) => blankColumnKey(productCode(rule)) === column.key,
        );
        return {
          ...(matched
            ? ruleField(
                assembly,
                `blank.${paper}.${column.key}`,
                [matched],
                'amount',
              )
            : missingField(`blank.${paper}.${column.key}`)),
          columnKey: column.key,
        };
      });
      return {
        key: paper,
        paperName: parts.paperName,
        weight: parts.weight,
        cells,
      };
    });
  const columns: PricingMatrixColumn[] = BLANK_COLUMNS.map(({ key, label }) => ({
    key,
    label,
  }));
  return <CustomerBlankPricingSectionView columns={columns} rows={rows} />;
}

function renderMachine(
  workspace: CustomerPriceSectionWorkspaceDto,
  assembly: FormAssembly,
) {
  const low = ruleByCode(workspace.rules, 'STOCK_LOCAL_FOIL_LT_1000_PER_PASS');
  const high = ruleByCode(workspace.rules, 'STOCK_LOCAL_FOIL_GTE_1000_PER_PASS');
  if (!low || !high) {
    assembly.warnings.add(
      '机烫计费档位不完整，暂不可编辑。请补齐两档规则。',
    );
  }
  const jumpTargets: FieldTarget[] = [];
  if (high) jumpTargets.push({ rule: high, field: 'minQty' });
  if (low) jumpTargets.push({ rule: low, field: 'maxQty', integerOffset: -1 });
  return (
    <CustomerMachinePricingSectionView
      rate={
        high
          ? ruleField(assembly, 'machine.rate', [high], 'amount')
          : missingField('machine.rate')
      }
      flatFee={
        low
          ? ruleField(assembly, 'machine.flatFee', [low], 'amount')
          : missingField('machine.flatFee')
      }
      jumpQuantity={boundField(
        assembly,
        'machine.jumpQuantity',
        high ? selectedFieldValue(high, 'minQty') : null,
        jumpTargets,
        { allowEdit: Boolean(low && high) },
      )}
      plateFee={readonlyField('machine.plateFee', null)}
    />
  );
}

function sortedProductTiers(
  rules: readonly CustomerPriceSectionRuleDto[],
  code: string,
): CustomerPriceSectionRuleDto[] {
  return rules
    .filter((rule) => productCode(rule) === code)
    .sort((left, right) => {
      const leftRule = effectiveRule(left);
      const rightRule = effectiveRule(right);
      return (
        (leftRule?.minQty ?? Number.MAX_SAFE_INTEGER) -
          (rightRule?.minQty ?? Number.MAX_SAFE_INTEGER) ||
        (leftRule?.maxQty ?? Number.MAX_SAFE_INTEGER) -
          (rightRule?.maxQty ?? Number.MAX_SAFE_INTEGER)
      );
    });
}

function renderTiers(
  workspace: CustomerPriceSectionWorkspaceDto,
  assembly: FormAssembly,
) {
  const byProduct = new Map(
    CUSTOM_PRODUCT_CODES.map((code) => [
      code,
      sortedProductTiers(workspace.rules, code),
    ]),
  );
  const canonical = byProduct.get('EXT-CUSTOM-MID') ?? [];
  const tierIssue = fixedCustomTierIssue(CUSTOM_PRODUCT_CODES.map(code =>
    (byProduct.get(code) ?? []).map(rule => ({
      minQty: effectiveRule(rule)?.minQty ?? null,
      maxQty: effectiveRule(rule)?.maxQty ?? null,
    })),
  ));
  if (tierIssue) assembly.warnings.add(tierIssue);
  const allowEdit = tierIssue === null;
  const rows: CustomerTierPricingRow[] = canonical.map((anchor, index) => {
    const sameTierRules = CUSTOM_PRODUCT_CODES.map(
      (code) => byProduct.get(code)?.[index],
    ).filter((rule): rule is CustomerPriceSectionRuleDto => Boolean(rule));
    const middleRules = sameTierRules.filter((rule) =>
      CUSTOM_MIDDLE_CODES.has(productCode(rule)),
    );
    const largeRules = sameTierRules.filter((rule) =>
      CUSTOM_LARGE_CODES.has(productCode(rule)),
    );
    const anchorRule = effectiveRule(anchor);
    const isLast = index === canonical.length - 1;
    const nextRules = isLast
      ? []
      : CUSTOM_PRODUCT_CODES.map((code) => byProduct.get(code)?.[index + 1]).filter(
          (rule): rule is CustomerPriceSectionRuleDto => Boolean(rule),
        );
    const boundaryTargets: FieldTarget[] = [
      ...sameTierRules.map((rule) => ({ rule, field: 'maxQty' as const })),
      ...nextRules.map((rule) => ({
        rule,
        field: 'minQty' as const,
        integerOffset: 1,
      })),
    ];
    const sentinelOpen = isLast && (anchorRule?.maxQty ?? 0) >= 9_999_999;
    return {
      key: `tier-${index}`,
      name: TIER_NAMES[index] ?? `第${index + 1}档`,
      maxQuantity: boundField(
        assembly,
        `tiers.${index}.maxQuantity`,
        sentinelOpen ? null : anchorRule?.maxQty ?? null,
        boundaryTargets,
        { allowEdit: allowEdit && !isLast, disabled: isLast },
      ),
      middlePrice: ruleField(
        assembly,
        `tiers.${index}.middlePrice`,
        middleRules,
        'amount',
        { allowEdit },
      ),
      largePrice: ruleField(
        assembly,
        `tiers.${index}.largePrice`,
        largeRules,
        'amount',
        { allowEdit },
      ),
    };
  });
  return <CustomerTiersPricingSectionView rows={rows} />;
}

function adjustmentRow(
  assembly: FormAssembly,
  rule: CustomerPriceSectionRuleDto,
  inputName: string,
  label?: string,
  description?: string,
): CustomerPricingAdjustmentRow {
  const selected = effectiveRule(rule);
  return {
    key: selected?.code ?? inputName,
    label: label ?? selected?.name ?? '未命名加价',
    description: description ?? selected?.scopeLabel ?? undefined,
    value: ruleField(assembly, inputName, [rule], 'amount'),
    unit:
      selected?.calculationType === CustomerPriceCalculationType.FIXED_AMOUNT
        ? '元'
        : '元/个',
    isNew: rule.current === null && rule.draft !== null,
  };
}

function renderAdds(
  workspace: CustomerPriceSectionWorkspaceDto,
  assembly: FormAssembly,
) {
  const paperAdjustments = ADD_PAPER_CODES.map((code) =>
    ruleByCode(workspace.rules, code),
  )
    .filter((rule): rule is CustomerPriceSectionRuleDto => Boolean(rule))
    .map((rule) =>
      adjustmentRow(
        assembly,
        rule,
        `adds.${effectiveRule(rule)!.code}.amount`,
      ),
    );
  const craftAdjustments = ADD_CRAFTS.map((entry) => {
    const rule = ruleByCode(workspace.rules, entry.code);
    return rule
      ? adjustmentRow(
          assembly,
          rule,
          `adds.${entry.code}.amount`,
          entry.label,
          entry.description,
        )
      : null;
  }).filter((row): row is CustomerPricingAdjustmentRow => row !== null);
  return (
    <CustomerAddsPricingSectionView
      paperAdjustments={paperAdjustments}
      craftAdjustments={craftAdjustments}
    />
  );
}

function printTierKey(code: string): string | null {
  return PRINT_COLUMNS.find((column) => code.endsWith(`_${column.key}`))?.key ?? null;
}

function renderPrint(
  workspace: CustomerPriceSectionWorkspaceDto,
  assembly: FormAssembly,
) {
  const columns: PricingMatrixColumn[] = PRINT_COLUMNS.map(({ key, label }) => ({
    key,
    label,
  }));
  const rows: CustomerPrintPricingRow[] = PRINT_PRODUCTS.map((product) => {
    const productRules = workspace.rules.filter(
      (rule) => productCode(rule) === product.code,
    );
    const cells: PricingMatrixCell[] = PRINT_COLUMNS.map((column) => {
      const matched = productRules.find(
        (rule) => printTierKey(upper(effectiveRule(rule)?.code)) === column.key,
      );
      return {
        ...(matched
          ? ruleField(
              assembly,
              `print.${product.code}.${column.key}`,
              [matched],
              'amount',
            )
          : missingField(`print.${product.code}.${column.key}`)),
        columnKey: column.key,
      };
    });
    return { key: product.code, label: product.label, cells };
  });
  const foilRules = workspace.rules.filter(
    (rule) =>
      upper(effectiveRule(rule)?.exclusiveGroup) ===
      'COLOR_SINGLE_FRONT_FOIL',
  );
  const foilCells: PricingMatrixCell[] = PRINT_COLUMNS.map((column) => {
    const matched = foilRules.find(
      (rule) => printTierKey(upper(effectiveRule(rule)?.code)) === column.key,
    );
    return {
      ...(matched
        ? ruleField(
            assembly,
            `print.foil.${column.key}`,
            [matched],
            'amount',
          )
        : missingField(`print.foil.${column.key}`)),
      columnKey: column.key,
    };
  });
  return (
    <CustomerPrintPricingSectionView
      columns={columns}
      rows={rows}
      foilCells={foilCells}
    />
  );
}

function zoneProvinces(rule: CustomerPriceSectionRuleDto): string[] {
  const code = upper(effectiveRule(rule)?.code);
  return [...(ZTO_ZONE_PROVINCES[code] ?? [])];
}

function zoneOrder(rule: CustomerPriceSectionRuleDto): number {
  const provinces = zoneProvinces(rule);
  return Math.min(
    ...provinces.map((province) => {
      const index = ZTO_PROVINCE_ORDER.indexOf(
        province as (typeof ZTO_PROVINCE_ORDER)[number],
      );
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    }),
  );
}

function policiesDiffer(
  policy: CustomerPriceSectionWorkspaceDto['shippingWeightPolicy'],
): boolean {
  return Boolean(
    policy?.draft &&
      JSON.stringify(policy.current) !== JSON.stringify(policy.draft),
  );
}

function renderShip(
  workspace: CustomerPriceSectionWorkspaceDto,
  assembly: FormAssembly,
) {
  const normalBag = ruleByCode(
    workspace.rules,
    'PACKAGING_SINGLE_STYLE_PER_BAG',
  );
  const mixedBag = ruleByCode(
    workspace.rules,
    'PACKAGING_MIXED_STYLE_PER_BAG',
  );
  const cartonRules = workspace.rules
    .filter(
      (rule) =>
        upper(effectiveRule(rule)?.exclusiveGroup) ===
        'CARTON_ORDER_QUANTITY_TIER',
    )
    .sort(
      (left, right) =>
        (effectiveRule(left)?.minQty ?? Number.MAX_SAFE_INTEGER) -
        (effectiveRule(right)?.minQty ?? Number.MAX_SAFE_INTEGER),
    );
  const cartonTiers: CustomerCartonPricingTierRow[] = cartonRules.map(
    (rule, index) => {
      const next = cartonRules[index + 1];
      const targets: FieldTarget[] = [{ rule, field: 'maxQty' }];
      if (next) {
        targets.push({ rule: next, field: 'minQty', integerOffset: 1 });
      }
      return {
        key: effectiveRule(rule)?.code ?? `carton-${index}`,
        name: `第${index + 1}档`,
        maxQuantity: boundField(
          assembly,
          `ship.carton.${index}.maxQuantity`,
          selectedFieldValue(rule, 'maxQty'),
          targets,
        ),
        fee: ruleField(
          assembly,
          `ship.carton.${index}.fee`,
          [rule],
          'amount',
        ),
      };
    },
  );
  const lastCarton = cartonRules.at(-1);

  const zoneRules = workspace.rules
    .filter(
      (rule) =>
        upper(effectiveRule(rule)?.exclusiveGroup) === 'ZTO_PROVINCE_RATE',
    )
    .sort((left, right) => zoneOrder(left) - zoneOrder(right));
  const zones: CustomerShippingZoneRow[] = zoneRules.map((rule, index) => {
    const selected = effectiveRule(rule);
    const provinces = zoneProvinces(rule);
    const incrementKilograms = Number(selected?.incrementUnits ?? 0);
    const safeZone = provinces.length > 0 && Number.isFinite(incrementKilograms) && incrementKilograms > 0;
    if (!safeZone) {
      assembly.warnings.add(
        '中通计费省份或续重单位缺失，暂不可编辑。请补齐该地区规则。',
      );
    }
    return {
      key: selected?.code ?? `zone-${index}`,
      name: String.fromCharCode(65 + index),
      provinces,
      firstWeightFee: ruleField(
        assembly,
        `ship.zone.${index}.firstWeightFee`,
        [rule],
        'amount',
        { allowEdit: safeZone },
      ),
      incrementFee: ruleField(
        assembly,
        `ship.zone.${index}.incrementFee`,
        [rule],
        'incrementAmount',
        { allowEdit: safeZone },
      ),
      incrementKilograms: safeZone ? incrementKilograms : 0,
    };
  });

  const policy =
    workspace.shippingWeightPolicy?.draft ??
    workspace.shippingWeightPolicy?.current ??
    null;
  const policyChanged = policiesDiffer(workspace.shippingWeightPolicy);
  const grams =
    policy?.billableWeightInput === 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE'
      ? policy.gramsPerItemByPaperWeightGsm
      : {};
  const unitWeights = [
    { key: '120', label: '120g', value: grams['120'] ?? null },
    {
      key: '150',
      label: '150g 莱尼纹（按160算）',
      value: grams['150'] ?? null,
    },
    { key: '160', label: '160g', value: grams['160'] ?? null },
    { key: '180', label: '180g', value: grams['180'] ?? null },
    { key: '200', label: '200g', value: grams['200'] ?? null },
    {
      key: '230',
      label: '230g 金葱/红卡',
      value: grams['230'] ?? null,
    },
    {
      key: 'wy',
      label: '万元封（不看克重）',
      value:
        policy?.billableWeightInput ===
        'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE'
          ? policy.tenThousandEnvelopeGramsPerItem
          : null,
    },
  ].map((entry) => ({
    key: entry.key,
    label: entry.label,
    value: readonlyField(
      `ship.policy.unitWeight.${entry.key}`,
      entry.value,
      policyChanged,
    ),
  }));

  return (
    <CustomerShipPricingSectionView
      bag={{
        normalFee: normalBag
          ? ruleField(assembly, 'ship.bag.normalFee', [normalBag], 'amount')
          : missingField('ship.bag.normalFee'),
        mixedFee: mixedBag
          ? ruleField(assembly, 'ship.bag.mixedFee', [mixedBag], 'amount')
          : missingField('ship.bag.mixedFee'),
      }}
      carton={{
        tiers: cartonTiers,
        segmentLength: readonlyField(
          'ship.carton.segmentLength',
          lastCarton ? selectedFieldValue(lastCarton, 'maxQty') : null,
          lastCarton?.changed ?? false,
        ),
        segmentFee: readonlyField(
          'ship.carton.segmentFee',
          lastCarton ? selectedFieldValue(lastCarton, 'amount') : null,
          lastCarton?.changed ?? false,
        ),
      }}
      shipping={{
        unitWeights,
        maxQuantity: readonlyField(
          'ship.policy.maxQuantity',
          policy?.maxOrderQuantity ?? null,
          policyChanged,
        ),
        zones,
      }}
    />
  );
}

function renderSection(
  workspace: CustomerPriceSectionWorkspaceDto,
  assembly: FormAssembly,
) {
  if (workspace.section === 'blank') return renderBlank(workspace, assembly);
  if (workspace.section === 'machine') return renderMachine(workspace, assembly);
  if (workspace.section === 'tiers') return renderTiers(workspace, assembly);
  if (workspace.section === 'adds') return renderAdds(workspace, assembly);
  if (workspace.section === 'print') return renderPrint(workspace, assembly);
  return renderShip(workspace, assembly);
}

export function CustomerPricingDedicatedSection({
  workspace,
  createDraftPurpose,
  focusRuleId,
}: CustomerPricingDedicatedSectionProps) {
  const assembly = buildFormAssembly(workspace);
  const sectionView = renderSection(workspace, assembly) as ReactElement<{
    headingActions?: ReactNode;
    statusContent?: ReactNode;
  }>;
  const focusTargetId = focusedInputId(assembly, focusRuleId);
  const context: CustomerPriceSectionFormContext = {
    section: workspace.section,
    rows: assembly.rows,
    bindings: assembly.bindings,
  };
  const saveAction =
    context.rows.length > 0 && context.bindings.length > 0
      ? updateCustomerPriceSectionDraftFormAction.bind(null, context)
      : undefined;
  const sectionViewWithStatus = cloneElement(sectionView, {
    headingActions: (
      <VersionHeadingActions
        workspace={workspace}
        createDraftPurpose={createDraftPurpose}
      />
    ),
    statusContent: (
      <div className="min-w-0 space-y-3">
        <VersionStatusBlocks workspace={workspace} />
        <WarningBlocks
          warnings={[...assembly.warnings]}
          shippingPolicyReadOnly={workspace.section === 'ship'}
        />
      </div>
    ),
  });

  return (
    <PriceWorkspaceNavigationGuardProvider>
      <div className="min-w-0">
        {focusTargetId ? (
          <CustomerPricingRuleFocus targetId={focusTargetId} />
        ) : null}
        <CustomerPricingSectionDraftForm saveAction={saveAction}>
          {sectionViewWithStatus}
        </CustomerPricingSectionDraftForm>
        <SelectedCreateDraftDialog
          workspace={workspace}
          createDraftPurpose={createDraftPurpose}
        />
      </div>
    </PriceWorkspaceNavigationGuardProvider>
  );
}
