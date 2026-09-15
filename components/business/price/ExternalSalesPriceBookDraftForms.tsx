"use client";
'use client';
import { PACKAGING_MODE_LABELS } from '@/lib/order/packaging-mode';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  cancelScheduledCustomerPriceBookAction,
  createCustomerPriceBookDraftAction,
  discardCustomerPriceBookDraftAction,
  publishCustomerPriceBookDraftAction,
  rescheduleCustomerPriceBookAction,
  updateCustomerPriceRuleDraftAction,
} from '@/actions/customer-price-books';
import type {
  CustomerPriceBookMutationResult,
  UpdateCustomerPriceRuleDraftActionInput,
} from '@/actions/customer-price-books.types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
  CustomerPriceRuleKind,
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderPackagingMode,
  OrderProductStructure,
} from '@/generated/prisma/enums';
import type {
  CustomerPriceRuleDraftEditorDto,
} from '@/lib/price/customer-price-book-admin';
import {
  RULE_CENTER_HREFS,
  customerPricingHref,
} from '@/lib/navigation/rule-center';
import {
  NEW_ORDER_PRICING_ROUTES,
  ORDER_PRICING_ROUTE_LABELS,
} from '@/lib/order/pricing-route';
import {
  externalPriceBusinessText,
  externalPriceRuleDisplayName,
} from '@/lib/price/external-price-display';

export type CustomerPriceBookDraftRuleContext =
  CustomerPriceRuleDraftEditorDto['context'];

type MutationState = CustomerPriceBookMutationResult | null;

type FieldErrors = Record<string, string[]>;

const controlClass = 'min-h-11';
const selectClass =
  'min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40';
const textareaClass =
  'w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40';

const RULE_KIND_LABELS: Record<CustomerPriceRuleKind, string> = {
  [CustomerPriceRuleKind.BASE]: '基础费用',
  [CustomerPriceRuleKind.ADD_ON]: '加收费用',
  [CustomerPriceRuleKind.REFERENCE]: '人工确认',
};

const CALCULATION_TYPE_LABELS: Record<CustomerPriceCalculationType, string> = {
  [CustomerPriceCalculationType.PER_PIECE]: '按个',
  [CustomerPriceCalculationType.FIXED_AMOUNT]: '整批固定金额',
  [CustomerPriceCalculationType.PER_SHEET]: '按张',
  [CustomerPriceCalculationType.PER_10K]: '每万个',
  [CustomerPriceCalculationType.PER_ITEM]: '每款一次',
  [CustomerPriceCalculationType.PER_BOX]: '按盒计价',
  [CustomerPriceCalculationType.PER_BAG]: '按实际袋数',
};

const PRODUCT_STRUCTURE_LABELS: Record<OrderProductStructure, string> = {
  [OrderProductStructure.UNSPECIFIED]: '未指定（历史）',
  [OrderProductStructure.STANDARD_ENVELOPE]: '普通封',
  [OrderProductStructure.WESTERN_ENVELOPE]: '西封',
  [OrderProductStructure.TEN_THOUSAND_ENVELOPE]: '万元封',
};

const FOIL_TECHNIQUE_LABELS: Record<OrderFoilTechnique, string> = {
  [OrderFoilTechnique.UNSPECIFIED]: '未指定（历史）',
  [OrderFoilTechnique.NONE]: '无烫金',
  [OrderFoilTechnique.FLAT]: '平烫',
  [OrderFoilTechnique.RELIEF]: '浮雕',
  [OrderFoilTechnique.RAISED]: '激凸',
};

const LAMINATION_LABELS: Record<OrderLamination, string> = {
  [OrderLamination.NONE]: '无覆膜',
  [OrderLamination.MATTE]: '亚膜',
  [OrderLamination.SOFT_TOUCH]: '触感膜',
  [OrderLamination.NEW_GLOSS]: '新式光膜',
  [OrderLamination.LASER]: '激光膜',
};



function textValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function nullableTextValue(formData: FormData, name: string): string | null {
  const value = textValue(formData, name).trim();
  return value ? value : null;
}

function nullableNumberValue(formData: FormData, name: string): number | null {
  const value = textValue(formData, name).trim();
  return value ? Number(value) : null;
}

function listValue(formData: FormData, name: string): string[] {
  return [
    ...new Set(
      formData
        .getAll(name)
        .filter((value): value is string => typeof value === 'string')
        .flatMap((value) => value.split(/[,，、;；\n\r]+/u))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function enumListValue<T extends string>(formData: FormData, name: string): T[] {
  return [
    ...new Set(
      formData
        .getAll(name)
        .filter((value): value is string => typeof value === 'string'),
    ),
  ] as T[];
}

function nullableBooleanValue(formData: FormData, name: string): boolean | null {
  const value = textValue(formData, name);
  return value === 'true' ? true : value === 'false' ? false : null;
}

function checkedValue(formData: FormData, name: string): boolean {
  return formData.getAll(name).includes('true');
}

function mutationFieldErrors(state: MutationState): FieldErrors {
  return state?.status === 'invalid' ? state.fieldErrors : {};
}

function fieldDescriptionIds(
  errorId: string,
  errors: string[] | undefined,
  hintId?: string,
): string | undefined {
  const ids = [hintId, errors?.length ? errorId : undefined].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

function isConcurrentMutationError(state: MutationState): boolean {
  return (
    state?.status === 'error' &&
    /(?:已被其他管理员修改|价目簿版本已存在|已有草稿版本|已有待生效版本)/.test(
      state.message,
    )
  );
}

function useFocusFirstInvalidField(state: MutationState) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.status !== 'invalid') return;

    for (const name of Object.keys(state.fieldErrors)) {
      if (!state.fieldErrors[name]?.length) continue;
      const control = formRef.current?.elements.namedItem(name);
      if (!control) continue;
      const candidates =
        control instanceof Element
          ? [control]
          : Array.from({ length: control.length }, (_, index) =>
              control.item(index),
            );
      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement)) continue;
        if (candidate.matches(':disabled, input[type="hidden"]')) continue;
        candidate.focus();
        return;
      }
    }
  }, [state]);

  return formRef;
}

export function customerPriceRuleInputFromFormData(
  formData: FormData,
): UpdateCustomerPriceRuleDraftActionInput {
  const calculationType = textValue(formData, 'calculationType');
  return {
    priceBookId: textValue(formData, 'priceBookId'),
    ruleId: textValue(formData, 'ruleId'),
    expectedUpdatedAt: textValue(formData, 'expectedUpdatedAt'),
    name: textValue(formData, 'name'),
    amount: nullableTextValue(formData, 'amount'),
    isActive: checkedValue(formData, 'isActive'),
    ...(formData.has('categoryId')
      ? {
          categoryId: textValue(formData, 'categoryId'),
          productId: nullableTextValue(formData, 'productId'),
          kind: textValue(formData, 'kind') as CustomerPriceRuleKind,
          calculationType: calculationType
            ? (calculationType as CustomerPriceCalculationType)
            : null,
          unitsPerSheet: nullableNumberValue(formData, 'unitsPerSheet'),
          minQty: nullableNumberValue(formData, 'minQty'),
          maxQty: nullableNumberValue(formData, 'maxQty'),
          blocksAutomaticQuote: checkedValue(
            formData,
            'blocksAutomaticQuote',
          ),
          match: {
            target:
              textValue(formData, 'match.target') === 'PACKAGING_GROUP'
                ? 'PACKAGING_GROUP'
                : 'ITEM',
            packagingModes: enumListValue<OrderPackagingMode>(
              formData,
              'match.packagingModes',
            ),
            pricingRoutes: enumListValue<OrderItemPricingRoute>(
              formData,
              'match.pricingRoutes',
            ),
            productStructures: enumListValue<OrderProductStructure>(
              formData,
              'match.productStructures',
            ),
            foilTechniques: enumListValue<OrderFoilTechnique>(
              formData,
              'match.foilTechniques',
            ),
            laminations: enumListValue<OrderLamination>(
              formData,
              'match.laminations',
            ),
            specifications: listValue(formData, 'match.specifications'),
            paperTypes: listValue(formData, 'match.paperTypes'),
            craftCodes: listValue(formData, 'match.craftCodes'),
            noneOfCraftCodes: listValue(formData, 'match.noneOfCraftCodes'),
            anyCraftCodeOutside: listValue(
              formData,
              'match.anyCraftCodeOutside',
            ),
            craftMode:
              (nullableTextValue(formData, 'match.craftMode') as
                | 'ANY'
                | 'ALL'
                | null),
            foilColors: listValue(formData, 'match.foilColors'),
            printColors: listValue(formData, 'match.printColors'),
            isDoubleSided: nullableBooleanValue(
              formData,
              'match.isDoubleSided',
            ),
            isDoubleColor: nullableBooleanValue(
              formData,
              'match.isDoubleColor',
            ),
            hasLocalFoil: nullableBooleanValue(
              formData,
              'match.hasLocalFoil',
            ),
            foilColorCount: nullableNumberValue(
              formData,
              'match.foilColorCount',
            ),
            minFoilColorCount: nullableNumberValue(
              formData,
              'match.minFoilColorCount',
            ),
            maxFoilColorCount: nullableNumberValue(
              formData,
              'match.maxFoilColorCount',
            ),
            foilPassCount: nullableNumberValue(
              formData,
              'match.foilPassCount',
            ),
            minFoilPassCount: nullableNumberValue(
              formData,
              'match.minFoilPassCount',
            ),
            maxFoilPassCount: nullableNumberValue(
              formData,
              'match.maxFoilPassCount',
            ),
            printColorCount: nullableNumberValue(
              formData,
              'match.printColorCount',
            ),
            minPrintColorCount: nullableNumberValue(
              formData,
              'match.minPrintColorCount',
            ),
            maxPrintColorCount: nullableNumberValue(
              formData,
              'match.maxPrintColorCount',
            ),
            minWidthMm: nullableNumberValue(formData, 'match.minWidthMm'),
            maxWidthMm: nullableNumberValue(formData, 'match.maxWidthMm'),
            minHeightMm: nullableNumberValue(formData, 'match.minHeightMm'),
            maxHeightMm: nullableNumberValue(formData, 'match.maxHeightMm'),
            minPaperWeightGsm: nullableNumberValue(
              formData,
              'match.minPaperWeightGsm',
            ),
            maxPaperWeightGsm: nullableNumberValue(
              formData,
              'match.maxPaperWeightGsm',
            ),
            minItemCount: nullableNumberValue(formData, 'match.minItemCount'),
            maxItemCount: nullableNumberValue(formData, 'match.maxItemCount'),
            perFoilColor: checkedValue(formData, 'match.perFoilColor'),
            perFoilPass: checkedValue(formData, 'match.perFoilPass'),
            perPrintColor: checkedValue(formData, 'match.perPrintColor'),
          },
        }
      : {}),
    ...(formData.has('includedUnits')
      ? {
          includedUnits: nullableTextValue(formData, 'includedUnits'),
          incrementUnits: nullableTextValue(formData, 'incrementUnits'),
          incrementAmount: nullableTextValue(formData, 'incrementAmount'),
        }
      : {}),
    ...(!formData.has('categoryId') && formData.has('minQty')
      ? {
          minQty: nullableNumberValue(formData, 'minQty'),
          maxQty: nullableNumberValue(formData, 'maxQty'),
        }
      : {}),
  };
}

export async function createDraftFromForm(
  _previous: MutationState,
  formData: FormData,
): Promise<CustomerPriceBookMutationResult> {
  return createCustomerPriceBookDraftAction({
    purpose: textValue(formData, 'purpose') as CustomerPriceBookPurpose,
    changeReason: textValue(formData, 'changeReason'),
  });
}

export async function updateDraftRuleFromForm(
  _previous: MutationState,
  formData: FormData,
): Promise<CustomerPriceBookMutationResult> {
  return updateCustomerPriceRuleDraftAction(
    customerPriceRuleInputFromFormData(formData),
  );
}

export async function publishDraftFromForm(
  _previous: MutationState,
  formData: FormData,
): Promise<CustomerPriceBookMutationResult> {
  return publishCustomerPriceBookDraftAction({
    priceBookId: textValue(formData, 'priceBookId'),
    expectedDraftUpdatedAt: textValue(formData, 'expectedDraftUpdatedAt'),
    effectiveFrom: textValue(formData, 'effectiveFrom'),
    publishNote: textValue(formData, 'publishNote'),
    confirmedImpact: checkedValue(formData, 'confirmedImpact'),
    confirmedHighRisk: checkedValue(formData, 'confirmedHighRisk'),
  });
}

export async function discardDraftFromForm(
  _previous: MutationState,
  formData: FormData,
): Promise<CustomerPriceBookMutationResult> {
  return discardCustomerPriceBookDraftAction({
    priceBookId: textValue(formData, 'priceBookId'),
    expectedDraftUpdatedAt: textValue(formData, 'expectedDraftUpdatedAt'),
  });
}

export async function cancelScheduledFromForm(
  _previous: MutationState,
  formData: FormData,
): Promise<CustomerPriceBookMutationResult> {
  return cancelScheduledCustomerPriceBookAction({
    priceBookId: textValue(formData, 'priceBookId'),
    expectedUpdatedAt: textValue(formData, 'expectedUpdatedAt'),
    reason: textValue(formData, 'reason'),
    confirmedImpact: checkedValue(formData, 'confirmedImpact'),
  });
}

export async function rescheduleFromForm(
  _previous: MutationState,
  formData: FormData,
): Promise<CustomerPriceBookMutationResult> {
  return rescheduleCustomerPriceBookAction({
    priceBookId: textValue(formData, 'priceBookId'),
    expectedUpdatedAt: textValue(formData, 'expectedUpdatedAt'),
    effectiveFrom: textValue(formData, 'effectiveFrom'),
    reason: textValue(formData, 'reason'),
    confirmedImpact: checkedValue(formData, 'confirmedImpact'),
  });
}

function FieldErrorMessages({
  id,
  messages,
}: {
  id: string;
  messages: string[] | undefined;
}) {
  if (!messages?.length) return null;
  return (
    <ul id={id} className="space-y-1 text-sm text-destructive">
      {messages.map((message, index) => (
        <li key={`${message}-${index}`} className="admin-wrap-anywhere">
          {message}
        </li>
      ))}
    </ul>
  );
}

function MutationFeedback({
  state,
  onRefresh,
  successMessage = '操作已完成。',
}: {
  state: MutationState;
  onRefresh?: () => void;
  successMessage?: string;
}) {
  if (!state) return null;
  if (state.status === 'success') {
    return (
      <p role="status" className="text-sm text-success-foreground">
        {successMessage}
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="space-y-2 text-sm text-destructive">
        <p role="alert" className="admin-wrap-anywhere">
          {state.message}
        </p>
        {onRefresh && isConcurrentMutationError(state) ? (
          <div className="space-y-1.5">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 border-destructive/40 text-foreground"
              onClick={onRefresh}
            >
              刷新最新内容
            </Button>
            <p className="text-xs text-muted-foreground">
              刷新后请核对其他管理员的修改，再重新保存。
            </p>
          </div>
        ) : null}
      </div>
    );
  }
  const messages = [...new Set(Object.values(state.fieldErrors).flat())];
  return (
    <div role="alert" className="text-sm text-destructive">
      <p className="font-medium">请修正以下内容：</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {messages.map((message) => (
          <li key={message} className="admin-wrap-anywhere">
            {message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CreateCustomerPriceBookDraftForm({
  purpose,
  purposeLabel,
  returnHref,
  presentation = 'panel',
}: {
  purpose: CustomerPriceBookPurpose;
  purposeLabel?: string;
  returnHref?: string;
  presentation?: 'panel' | 'dialog';
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<MutationState, FormData>(
    createDraftFromForm,
    null,
  );
  const formRef = useFocusFirstInvalidField(state);
  const errors = mutationFieldErrors(state);
  const changeReasonId = `changeReason-${purpose}`;
  const changeReasonHintId = `${changeReasonId}-hint`;
  const changeReasonErrorId = `${changeReasonId}-error`;

  useEffect(() => {
    if (state?.status !== 'success') return;
    router.replace(
      returnHref ??
        customerPricingHref(
          purpose === CustomerPriceBookPurpose.LOGISTICS
            ? 'logistics'
            : 'processing',
        ),
    );
  }, [purpose, returnHref, router, state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-busy={pending}
      aria-label={`创建${
        purposeLabel ??
        (purpose === CustomerPriceBookPurpose.PROCESSING
          ? '加工费'
          : '快递与耗材')
      }调价草稿`}
      className={
        presentation === 'dialog'
          ? 'min-w-0 space-y-3'
          : 'mt-4 min-w-0 space-y-3 rounded-lg border border-dashed p-3'
      }
    >
      <input type="hidden" name="purpose" value={purpose} />
      {presentation === 'panel' ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">发起调价</p>
          <p className="text-xs leading-5 text-muted-foreground">
            草稿发布前不影响当前报价。
          </p>
        </div>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor={changeReasonId}>调价原因（必填）</Label>
        <textarea
          id={changeReasonId}
          name="changeReason"
          className={`${textareaClass} min-h-24`}
          placeholder="例如：2026 年 9 月原材料与快递调价"
          minLength={2}
          maxLength={500}
          required
          aria-required="true"
          aria-invalid={Boolean(errors.changeReason?.length)}
          aria-describedby={fieldDescriptionIds(
            changeReasonErrorId,
            errors.changeReason,
            changeReasonHintId,
          )}
        />
        <p id={changeReasonHintId} className="text-xs text-muted-foreground">
          用于调价记录。
        </p>
        <FieldErrorMessages
          id={changeReasonErrorId}
          messages={errors.changeReason}
        />
      </div>
      <Button type="submit" className="min-h-11" disabled={pending}>
        {pending ? '正在创建…' : '开始调价'}
      </Button>
      <MutationFeedback
        state={state}
        onRefresh={() => router.refresh()}
        successMessage="调价草稿已创建。"
      />
    </form>
  );
}

export function PublishCustomerPriceBookDraftForm({
  priceBookId,
  expectedDraftUpdatedAt,
  defaultEffectiveFrom,
  changeReason,
  impact,
}: {
  priceBookId: string;
  expectedDraftUpdatedAt: string;
  defaultEffectiveFrom: string;
  changeReason: string;
  impact?: {
    totalRuleCount: number;
    changedItemCount: number;
    changedRuleCount: number;
    increasedRuleCount: number;
    decreasedRuleCount: number;
    highRiskRuleCount: number;
    highRiskDeltaPercentThreshold: string;
    deltaPercentMin: string | null;
    deltaPercentMax: string | null;
    validationStatus: 'PASS' | 'FAIL';
    validationIssues?: Array<{
      message: string;
      href?: string;
    }>;
  };
}) {
  const router = useRouter();
  const [effectiveFrom, setEffectiveFrom] = useState(defaultEffectiveFrom);
  const [confirmedHighRisk, setConfirmedHighRisk] = useState(false);
  const [state, formAction, pending] = useActionState<MutationState, FormData>(
    publishDraftFromForm,
    null,
  );
  const formRef = useFocusFirstInvalidField(state);
  const errors = mutationFieldErrors(state);
  const effectiveFromId = `effectiveFrom-${priceBookId}`;
  const effectiveFromErrorId = `${effectiveFromId}-error`;
  const publishNoteId = `publishNote-${priceBookId}`;
  const publishNoteHintId = `${publishNoteId}-hint`;
  const publishNoteErrorId = `${publishNoteId}-error`;
  const confirmedHighRiskErrorId = `confirmedHighRisk-${priceBookId}-error`;
  const validationPassed = impact?.validationStatus !== 'FAIL';
  const hasChanges =
    (impact?.changedItemCount ?? 0) > 0 &&
    (impact?.changedRuleCount ?? 0) > 0;
  const requiresHighRiskConfirmation = (impact?.highRiskRuleCount ?? 0) > 0;

  const deltaRange =
    impact && impact.deltaPercentMin !== null && impact.deltaPercentMax !== null
      ? impact.deltaPercentMin === impact.deltaPercentMax
        ? `${Number(impact.deltaPercentMin) > 0 ? '+' : ''}${impact.deltaPercentMin}%`
        : `${Number(impact.deltaPercentMin) > 0 ? '+' : ''}${impact.deltaPercentMin}% 〜 ${
            Number(impact.deltaPercentMax) > 0 ? '+' : ''
          }${impact.deltaPercentMax}%`
      : '含启停或非金额修改';

  useEffect(() => {
    if (state?.status !== 'success') return;
    router.replace(RULE_CENTER_HREFS.priceVersions);
    router.refresh();
  }, [router, state]);

  if (impact && !hasChanges) {
    // Only the exact no-change diagnostic is redundant; never suppress real validation failures.
    const issues = (impact.validationIssues ?? []).filter(
      issue => issue.message !== '草稿与当前版本没有价格或规则变化，无需发布',
    );
    const unexplainedFailure = !validationPassed && !impact.validationIssues?.length;
    return (
      <section aria-label="草稿检查结果" className="space-y-3 rounded-xl border bg-card p-5">
        <p role="status" className="text-sm">草稿与当前版本一致，无需发布。</p>
        {issues.length > 0 || unexplainedFailure ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>发布检查未通过，请修正问题后重试。</p>
            <ul className="space-y-2">
              {issues.map((issue, index) => (
                <li key={index} className="admin-wrap-anywhere">
                  {issue.message}
                  {issue.href ? <a href={issue.href} className="ml-2 underline">打开对应价格</a> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-busy={pending}
      aria-label="发布价目草稿"
      className="min-w-0 space-y-4 rounded-xl border bg-card p-5"
    >
      <input type="hidden" name="priceBookId" value={priceBookId} />
      <input
        type="hidden"
        name="expectedDraftUpdatedAt"
        value={expectedDraftUpdatedAt}
      />
      <input type="hidden" name="confirmedImpact" value="true" />

      <section
        aria-labelledby={`publish-summary-${priceBookId}`}
        className="space-y-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`publish-summary-${priceBookId}`} className="font-medium">
            确认本次价格变更
          </h3>
        </div>

        <dl className="grid gap-3 text-sm [&_dt]:shrink-0 [&_dd]:min-w-0 [&_dd]:text-right [&_dd]:break-words">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">变更范围</dt>
            <dd className="font-sans tabular-nums">
              {impact?.changedItemCount ?? '—'} 个收费项目 ·{' '}
              {impact?.changedRuleCount ?? '—'} 条规则
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">全表检查</dt>
            <dd className={validationPassed ? 'text-success-foreground' : 'text-destructive'}>
              {validationPassed
                ? `${impact?.totalRuleCount ?? '—'} 条规则已通过`
                : '未通过'}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">涨跌区间</dt>
            <dd className="font-sans tabular-nums">{deltaRange}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">涨价 / 下调</dt>
            <dd className="font-sans tabular-nums">
              {impact?.increasedRuleCount ?? '—'} /{' '}
              {impact?.decreasedRuleCount ?? '—'} 条
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">生效方式</dt>
            <dd className="font-medium">
              {effectiveFrom
                ? `${effectiveFrom.replace('T', ' ')}（上海时间）`
                : '立即生效'}
            </dd>
          </div>
        </dl>

        {!hasChanges ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-background p-2 text-xs text-destructive">
            草稿和当前生效版没有可发布的差异。
          </p>
        ) : null}
        {!validationPassed ? (
          <div className="space-y-2 rounded-md border border-destructive/30 bg-background p-2 text-xs text-destructive">
            <p className="font-medium">发布检查未通过，请先修正以下问题：</p>
            <ul className="space-y-1.5">
              {impact?.validationIssues?.map((issue, index) => (
                <li key={`${issue.href ?? 'price-book'}-${index}`}>
                  <span className="admin-wrap-anywhere">{issue.message}</span>
                  {issue.href ? (
                    <a
                      href={issue.href}
                      className="ml-1 font-medium underline underline-offset-4"
                    >
                      打开对应价格
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs leading-5 text-warning-foreground">
          已开工单价格不变；新价格仅用于发布后新建或重新报价的工单。
        </p>

        {requiresHighRiskConfirmation ? (
          <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <p className="text-sm font-medium text-warning-foreground">
              检测到 {impact?.highRiskRuleCount} 条高风险报价变更
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              任一价格相对当前版涨跌达到 {impact?.highRiskDeltaPercentThreshold}% ，
              或价格在 0 元与非零之间、无报价与有报价之间切换，
              以及有效规则新增、移除或启停时，需要单独确认。
            </p>
            <label className="flex min-h-11 cursor-pointer items-center gap-1 rounded-md border pr-3 text-sm has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
              <Checkbox
                name="confirmedHighRisk"
                value="true"
                checked={confirmedHighRisk}
                disabled={pending}
                aria-label="我已逐条核对高风险变更，确认按当前新规则发布"
                onCheckedChange={setConfirmedHighRisk}
                aria-invalid={Boolean(errors.confirmedHighRisk?.length)}
                aria-describedby={fieldDescriptionIds(
                  confirmedHighRiskErrorId,
                  errors.confirmedHighRisk,
                )}
              />
              <span className="min-w-0 py-2">
                我已逐条核对高风险变更，确认按当前新规则发布
              </span>
            </label>
            <FieldErrorMessages
              id={confirmedHighRiskErrorId}
              messages={errors.confirmedHighRisk}
            />
          </div>
        ) : null}
      </section>

      <Disclosure className="rounded-lg border bg-card p-3">
        <DisclosureSummary className="justify-between gap-3">
          <span>预约生效或补充发布说明（可选）</span>
        </DisclosureSummary>
        <div className="mt-3 space-y-3 border-t pt-3">
          <div className="space-y-2">
            <Label htmlFor={effectiveFromId}>预约生效时间（上海时间）</Label>
            <Input
              id={effectiveFromId}
              name="effectiveFrom"
              type="datetime-local"
              className={controlClass}
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
              aria-invalid={Boolean(errors.effectiveFrom?.length)}
              aria-describedby={fieldDescriptionIds(
                effectiveFromErrorId,
                errors.effectiveFrom,
              )}
            />
            <p className="text-xs text-muted-foreground">
              留空即立即发布；只有已确定未来切换时刻时才需要预约。
            </p>
            <FieldErrorMessages
              id={effectiveFromErrorId}
              messages={errors.effectiveFrom}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={publishNoteId}>补充发布说明（可选）</Label>
            <textarea
              id={publishNoteId}
              name="publishNote"
              className={`${textareaClass} min-h-20`}
              placeholder="如需补充说明，请在此填写"
              minLength={2}
              maxLength={500}
              aria-invalid={Boolean(errors.publishNote?.length)}
              aria-describedby={fieldDescriptionIds(
                publishNoteErrorId,
                errors.publishNote,
                publishNoteHintId,
              )}
            />
            <p id={publishNoteHintId} className="text-xs text-muted-foreground">
              留空时发布记录沿用调价原因：{changeReason}
            </p>
            <FieldErrorMessages
              id={publishNoteErrorId}
              messages={errors.publishNote}
            />
          </div>
        </div>
      </Disclosure>

      <Button
        type="submit"
        variant="default"
        className="min-h-11 w-full"
        disabled={
          pending ||
          !validationPassed ||
          !hasChanges ||
          (requiresHighRiskConfirmation && !confirmedHighRisk)
        }
      >
        {pending
          ? '正在发布…'
          : effectiveFrom
            ? '确认预约发布'
            : '确认并立即发布'}
      </Button>
      <MutationFeedback
        state={state}
        onRefresh={() => router.refresh()}
        successMessage="价目草稿已发布。"
      />
    </form>
  );
}

export function DiscardCustomerPriceBookDraftForm({
  priceBookId,
  expectedDraftUpdatedAt,
}: {
  priceBookId: string;
  expectedDraftUpdatedAt: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<MutationState, FormData>(
    discardDraftFromForm,
    null,
  );
  const formId = useId();

  useEffect(() => {
    if (state?.status !== 'success') return;
    router.replace(RULE_CENTER_HREFS.priceVersions);
  }, [router, state]);

  return (
    <form
      id={formId}
      action={formAction}
      aria-label="放弃价目草稿"
      aria-busy={pending}
      className="min-w-0 space-y-3 rounded-lg border border-destructive/30 p-3"
    >
      <input type="hidden" name="priceBookId" value={priceBookId} />
      <input
        type="hidden"
        name="expectedDraftUpdatedAt"
        value={expectedDraftUpdatedAt}
      />
      <ConfirmActionController level="L2"
        formId={formId}
        disabled={pending}
        trigger={
          <Button
            type="button"
            variant="destructive"
            className="min-h-11"
            disabled={pending}
          >
            {pending ? '放弃中…' : '放弃草稿'}
          </Button>
        }
        cancelLabel="返回检查">
        <ConfirmActionDialog action="放弃这份价目草稿" changes={[]} consequences={[
          '草稿及其中所有未发布修改将永久删除。',
        ]} confirmText="确认放弃草稿" />
      </ConfirmActionController>
      <MutationFeedback
        state={state}
        onRefresh={() => router.refresh()}
        successMessage="未发布草稿已放弃。"
      />
    </form>
  );
}

export function CancelScheduledCustomerPriceBookForm({
  priceBookId,
  expectedUpdatedAt,
  version,
}: {
  priceBookId: string;
  expectedUpdatedAt: string;
  version: number;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<MutationState, FormData>(
    cancelScheduledFromForm,
    null,
  );
  const formId = useId();

  useEffect(() => {
    if (state?.status === 'success') router.refresh();
  }, [router, state]);

  return (
    <form
      id={formId}
      action={formAction}
      aria-label={`取消第 ${version} 版计划`}
      aria-busy={pending}
    >
      <input type="hidden" name="priceBookId" value={priceBookId} />
      <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />
      <input type="hidden" name="confirmedImpact" value="true" />
      <ConfirmActionController level="L3"
        formId={formId}
        disabled={pending}
        reasonLabel="取消原因"
        reasonPlaceholder="例如：价格复核未完成，取消本次计划"
        trigger={
          <Button type="button" variant="destructive" className="min-h-11">
            {pending ? '正在取消…' : '取消计划'}
          </Button>
        }
        cancelLabel="保留计划">
        <ConfirmActionDialog action={`取消第 ${version} 版的生效计划？`} changes={[]} consequences={[
          '前一版价格将延续覆盖原计划时段。',
        ]} confirmText="取消计划" />
      </ConfirmActionController>
      <MutationFeedback
        state={state}
        onRefresh={() => router.refresh()}
        successMessage="生效计划已取消。"
      />
    </form>
  );
}

export function RescheduleCustomerPriceBookForm({
  priceBookId,
  expectedUpdatedAt,
  version,
  defaultEffectiveFrom,
}: {
  priceBookId: string;
  expectedUpdatedAt: string;
  version: number;
  defaultEffectiveFrom: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<MutationState, FormData>(
    rescheduleFromForm,
    null,
  );
  const formId = useId();
  const inputId = useId();
  const [effectiveFrom, setEffectiveFrom] = useState(defaultEffectiveFrom);
  const errorId = `${inputId}-error`;
  const errors = mutationFieldErrors(state);

  useEffect(() => {
    if (state?.status === 'success') router.refresh();
  }, [router, state]);

  return (
    <form
      id={formId}
      action={formAction}
      aria-label={`调整第 ${version} 版生效时间`}
      aria-busy={pending}
      className="flex min-w-0 flex-wrap items-end gap-2"
    >
      <input type="hidden" name="priceBookId" value={priceBookId} />
      <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />
      <input type="hidden" name="confirmedImpact" value="true" />
      <div className="min-w-56 flex-1 space-y-1">
        <Label htmlFor={inputId} className="text-xs">新生效时间（上海时间）</Label>
        <Input
          id={inputId}
          name="effectiveFrom"
          type="datetime-local"
          className="min-h-11"
          value={effectiveFrom}
          onChange={(event) => setEffectiveFrom(event.target.value)}
          required
          aria-invalid={Boolean(errors.effectiveFrom?.length)}
          aria-describedby={errors.effectiveFrom?.length ? errorId : undefined}
        />
        <FieldErrorMessages id={errorId} messages={errors.effectiveFrom} />
      </div>
      <ConfirmActionController level="L3"
        formId={formId}
        disabled={pending}
        reasonLabel="改期原因"
        reasonPlaceholder="例如：延后至下月统一切换"
        trigger={
          <Button type="button" variant="outline" className="min-h-11">
            {pending ? '正在改期…' : '调整生效时间'}
          </Button>
        }
        cancelLabel="保持原时间">
        <ConfirmActionDialog action={`调整第 ${version} 版生效时间`} changes={[{label: "生效时间", old: defaultEffectiveFrom.replace("T", " "), new: effectiveFrom.replace("T", " ")}]} consequences={[
          '新生效时间之后的新建或重新报价工单受影响。',
        ]} confirmText="确认改期" />
      </ConfirmActionController>
      <MutationFeedback
        state={state}
        onRefresh={() => router.refresh()}
        successMessage="计划版本已改期。"
      />
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
  hint,
  hintId,
  errorId,
  errors,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  hint?: string;
  hintId?: string;
  errorId?: string;
  errors?: string[];
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {errorId ? <FieldErrorMessages id={errorId} messages={errors} /> : null}
    </div>
  );
}

function MatchCheckboxGroup<T extends string>({
  legend,
  name,
  labels,
  values,
  defaultValues,
  required,
  disabled,
  errors,
  errorId,
}: {
  legend: string;
  name: string;
  labels: Record<T, string>;
  values?: readonly T[];
  defaultValues: readonly T[];
  required?: boolean;
  disabled?: boolean;
  errors?: string[];
  errorId: string;
}) {
  const visibleValues =
    values ?? (Object.keys(labels) as T[]);
  return (
    <fieldset className="min-w-0 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">
        {legend}
        {required ? '（必选）' : '（不选表示不限）'}
      </legend>
      <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {visibleValues.map(
          (value) => (
            <label
              key={value}
              className="flex min-h-11 min-w-0 cursor-pointer items-center gap-1 rounded-lg border bg-background pr-2 text-sm has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60"
            >
              <Checkbox
                name={name}
                value={value}
                defaultChecked={defaultValues.includes(value)}
                disabled={disabled}
                aria-label={labels[value]}
                aria-invalid={Boolean(errors?.length)}
                aria-describedby={errors?.length ? errorId : undefined}
              />
              <span className="admin-wrap-anywhere">{labels[value]}</span>
            </label>
          ),
        )}
      </div>
      <div className="mt-2">
        <FieldErrorMessages id={errorId} messages={errors} />
      </div>
    </fieldset>
  );
}

function MatcherTextField({
  id,
  name,
  label,
  defaultValues,
  errors,
  placeholder,
}: {
  id: string;
  name: string;
  label: string;
  defaultValues: readonly string[];
  errors?: string[];
  placeholder?: string;
}) {
  const errorId = `${id}-error`;
  // Imported markers remain part of historical exact matching. Preserve the
  // submitted value until the administrator deliberately edits this field.
  const rawDefaultValue = defaultValues.join('、');
  const visibleDefaultValue = defaultValues
    .map(externalPriceBusinessText)
    .filter(Boolean)
    .join('、');
  const [submittedValue, setSubmittedValue] = useState(rawDefaultValue);
  return (
    <Field label={label} htmlFor={id} errorId={errorId} errors={errors}>
      <input type="hidden" name={name} value={submittedValue} />
      <Input
        id={id}
        className={controlClass}
        defaultValue={visibleDefaultValue}
        onChange={(event) => setSubmittedValue(event.currentTarget.value)}
        placeholder={placeholder ?? '多个值用逗号或顿号分隔；留空表示不限'}
        aria-invalid={Boolean(errors?.length)}
        aria-describedby={errors?.length ? errorId : undefined}
      />
    </Field>
  );
}

function MatcherTriStateField({
  id,
  name,
  label,
  defaultValue,
  trueLabel,
  falseLabel,
  errors,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: boolean | null;
  trueLabel: string;
  falseLabel: string;
  errors?: string[];
}) {
  const errorId = `${id}-error`;
  return (
    <Field label={label} htmlFor={id} errorId={errorId} errors={errors}>
      <select
        id={id}
        name={name}
        className={selectClass}
        defaultValue={defaultValue === null ? '' : String(defaultValue)}
        aria-invalid={Boolean(errors?.length)}
        aria-describedby={errors?.length ? errorId : undefined}
      >
        <option value="">不限</option>
        <option value="true">{trueLabel}</option>
        <option value="false">{falseLabel}</option>
      </select>
    </Field>
  );
}

function MatcherNumberField({
  id,
  name,
  label,
  defaultValue,
  errors,
  min = 0,
  step = 1,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: number | null;
  errors?: string[];
  min?: number;
  step?: number;
}) {
  const errorId = `${id}-error`;
  return (
    <Field label={label} htmlFor={id} errorId={errorId} errors={errors}>
      <Input
        id={id}
        name={name}
        type="number"
        inputMode={step === 1 ? 'numeric' : 'decimal'}
        min={min}
        max={9_999_999}
        step={step}
        className={controlClass}
        defaultValue={defaultValue ?? ''}
        placeholder="不限"
        aria-invalid={Boolean(errors?.length)}
        aria-describedby={errors?.length ? errorId : undefined}
      />
    </Field>
  );
}

export function CustomerPriceBookDraftRuleForm({
  context,
  rule,
  successHref,
}: {
  context: CustomerPriceBookDraftRuleContext;
  rule: CustomerPriceRuleDraftEditorDto['rule'];
  successHref?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<MutationState, FormData>(
    updateDraftRuleFromForm,
    null,
  );
  const formRef = useFocusFirstInvalidField(state);
  const errors = mutationFieldErrors(state);
  const conditionTarget = rule.match.target;

  useEffect(() => {
    if (state?.status !== 'success') return;
    if (successHref) {
      router.replace(successHref);
      return;
    }
    router.refresh();
  }, [router, state, successHref]);
  const prefix = `price-rule-${rule.id}`;
  const isProcessing = rule.editorMode === 'PROCESSING';
  const isShipping = rule.editorMode === 'SHIPPING';
  const isPackaging = rule.editorMode === 'PACKAGING';
  const displayName = externalPriceRuleDisplayName(rule.name);
  const referencedCraftCodes = [
    ...new Set([
      ...rule.match.craftCodes,
      ...rule.match.noneOfCraftCodes,
      ...rule.match.anyCraftCodeOutside,
    ]),
  ];
  const knownCraftCodes = new Set(context.crafts.map((craft) => craft.value));
  const craftOptions = [
    ...context.crafts,
    ...referencedCraftCodes
      .filter((code) => !knownCraftCodes.has(code))
      .map((value, index) => ({
        value,
        label: `历史工艺 ${index + 1}`,
      })),
  ];
  const craftValues = craftOptions.map((craft) => craft.value);
  const craftLabels = Object.fromEntries(
    craftOptions.map((craft) => [craft.value, craft.label]),
  );
  const hasMatchErrors =
    rule.matchValidationErrors.length > 0 ||
    Object.entries(errors).some(
      ([field, messages]) =>
        (field === 'match' || field.startsWith('match.')) &&
        Boolean(messages?.length),
    );
  const errorIdFor = (name: string) => `${prefix}-${name}-error`;
  const fieldA11y = (name: string, hintId?: string) => ({
    'aria-invalid': Boolean(errors[name]?.length),
    'aria-describedby': fieldDescriptionIds(
      errorIdFor(name),
      errors[name],
      hintId,
    ),
  });

  return (
    <form
      key={rule.id}
      ref={formRef}
      action={formAction}
      aria-busy={pending}
      aria-label={`编辑收费项目：${displayName}`}
      className="min-w-0 space-y-5 rounded-xl border bg-card p-4 shadow-sm"
    >
      <input type="hidden" name="priceBookId" value={context.id} />
      <input type="hidden" name="ruleId" value={rule.id} />
      <input type="hidden" name="expectedUpdatedAt" value={rule.updatedAt} />

      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field
          label="收费项目名称"
          htmlFor={`${prefix}-name`}
          errorId={errorIdFor('name')}
          errors={errors.name}
        >
          <Input
            id={`${prefix}-name`}
            name="name"
            className={controlClass}
            defaultValue={displayName}
            maxLength={120}
            required
            aria-required="true"
            {...fieldA11y('name')}
          />
        </Field>
        {isProcessing ? (
          <>
            <Field
              label="费用分类"
              htmlFor={`${prefix}-category`}
              errorId={errorIdFor('categoryId')}
              errors={errors.categoryId}
            >
              <select
                id={`${prefix}-category`}
                name="categoryId"
                className={selectClass}
                defaultValue={rule.categoryId}
                required
                aria-required="true"
                {...fieldA11y('categoryId')}
              >
                {context.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {externalPriceBusinessText(category.name)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="适用产品"
              htmlFor={`${prefix}-product`}
              hint="基础费用必须选择产品；其他费用留空表示通用。"
              hintId={`${prefix}-product-hint`}
              errorId={errorIdFor('productId')}
              errors={errors.productId}
            >
              <select
                id={`${prefix}-product`}
                name="productId"
                className={selectClass}
                defaultValue={rule.productId ?? ''}
                {...fieldA11y('productId', `${prefix}-product-hint`)}
              >
                <option value="">通用（不限产品）</option>
                {context.products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {externalPriceBusinessText(product.name)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="费用类型"
              htmlFor={`${prefix}-kind`}
              errorId={errorIdFor('kind')}
              errors={errors.kind}
            >
              <select
                id={`${prefix}-kind`}
                name="kind"
                className={selectClass}
                defaultValue={rule.kind}
                required
                aria-required="true"
                {...fieldA11y('kind')}
              >
                {Object.values(CustomerPriceRuleKind).map((kind) => (
                  <option key={kind} value={kind}>
                    {RULE_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <>
            <div className="min-w-0 space-y-2 text-sm">
              <p className="font-medium">费用分类</p>
              <p className="admin-wrap-anywhere min-h-11 rounded-lg border bg-muted/40 px-3 py-2.5">
                {rule.categoryName}
              </p>
            </div>
          </>
        )}
        {isShipping ? (
          <div className="min-w-0 space-y-2 text-sm">
            <p className="font-medium">适用地区</p>
            <p className="admin-wrap-anywhere min-h-11 rounded-lg border bg-muted/40 px-3 py-2.5">
              {rule.shippingScopeLabel}
            </p>
          </div>
        ) : null}
        {isProcessing || isPackaging ? (
          <>
            <Field
              label="最小数量"
              htmlFor={`${prefix}-minQty`}
              errorId={errorIdFor('minQty')}
              errors={errors.minQty}
            >
              <Input
                id={`${prefix}-minQty`}
                name="minQty"
                type="number"
                inputMode="numeric"
                className={controlClass}
                defaultValue={rule.minQty ?? ''}
                min={1}
                max={9_999_999}
                step={1}
                {...fieldA11y('minQty')}
              />
            </Field>
            <Field
              label="最大数量"
              htmlFor={`${prefix}-maxQty`}
              errorId={errorIdFor('maxQty')}
              errors={errors.maxQty}
            >
              <Input
                id={`${prefix}-maxQty`}
                name="maxQty"
                type="number"
                inputMode="numeric"
                className={controlClass}
                defaultValue={rule.maxQty ?? ''}
                min={1}
                max={9_999_999}
                step={1}
                {...fieldA11y('maxQty')}
              />
            </Field>
          </>
        ) : (
          null
        )}
        {isProcessing ? (
          <Field
            label="计价方式"
            htmlFor={`${prefix}-calculationType`}
            errorId={errorIdFor('calculationType')}
            errors={errors.calculationType}
          >
            <select
              id={`${prefix}-calculationType`}
              name="calculationType"
              className={selectClass}
              defaultValue={rule.calculationType ?? ''}
              {...fieldA11y('calculationType')}
            >
              <option value="">人工报价（无自动金额）</option>
              {Object.values(CustomerPriceCalculationType).map((type) => (
                <option key={type} value={type}>
                  {CALCULATION_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          null
        )}
        {isProcessing ? (
          <Field
            label="每张含几个"
            htmlFor={`${prefix}-unitsPerSheet`}
            hint="选择“按张”计价时必填，例如每张可生产 4 个。"
            hintId={`${prefix}-unitsPerSheet-hint`}
            errorId={errorIdFor('unitsPerSheet')}
            errors={errors.unitsPerSheet}
          >
            <Input
              id={`${prefix}-unitsPerSheet`}
              name="unitsPerSheet"
              type="number"
              inputMode="numeric"
              className={controlClass}
              defaultValue={rule.unitsPerSheet ?? ''}
              min={1}
              max={9_999_999}
              step={1}
              placeholder="仅按张计价需要填写"
              {...fieldA11y(
                'unitsPerSheet',
                `${prefix}-unitsPerSheet-hint`,
              )}
            />
          </Field>
        ) : null}
        <Field
          label={isShipping ? '首重金额（元）' : '金额（元）'}
          htmlFor={`${prefix}-amount`}
          errorId={errorIdFor('amount')}
          errors={errors.amount}
        >
          <Input
            id={`${prefix}-amount`}
            name="amount"
            inputMode="decimal"
            className={controlClass}
            defaultValue={rule.amount ?? ''}
            placeholder="人工报价规则可留空"
            {...fieldA11y('amount')}
          />
        </Field>
      </div>

      {isProcessing ? (
        <Disclosure
          className="min-w-0 rounded-xl border bg-muted/20 p-3"
          open={hasMatchErrors || undefined}
        >
          <DisclosureSummary className="font-semibold">
            适用范围
          </DisclosureSummary>
          <div className="mt-3 space-y-4">
            <p className="text-xs leading-5 text-muted-foreground">
              仅在适用范围变化时修改。
            </p>
            {rule.matchValidationErrors.length > 0 ? (
              <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <p className="font-medium">原适用条件需重新确认：</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {rule.matchValidationErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <FieldErrorMessages
              id={`${prefix}-match-error`}
              messages={errors.match}
            />
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-medium">计价对象</p>
              <p className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                {conditionTarget === 'PACKAGING_GROUP' ? '包装组' : '款式'}
              </p>
              <input type="hidden" name="match.target" value={conditionTarget} />
              <FieldErrorMessages
                id={errorIdFor('match.target')}
                messages={errors['match.target']}
              />
            </div>
            {conditionTarget === 'PACKAGING_GROUP' ? (
              <MatchCheckboxGroup
                legend="包装模式"
                name="match.packagingModes"
                labels={PACKAGING_MODE_LABELS}
                defaultValues={rule.match.packagingModes}
                required
                disabled={pending}
                errors={errors['match.packagingModes']}
                errorId={`${prefix}-packagingModes-error`}
              />
            ) : (
              <>
                <MatchCheckboxGroup
                  legend="适用计价方式"
                  name="match.pricingRoutes"
                  labels={ORDER_PRICING_ROUTE_LABELS}
                  values={NEW_ORDER_PRICING_ROUTES}
                  defaultValues={rule.match.pricingRoutes}
                  required
                  disabled={pending}
                  errors={errors['match.pricingRoutes']}
                  errorId={`${prefix}-pricingRoutes-error`}
                />
                {rule.match.pricingRoutes.includes(
                  OrderItemPricingRoute.MANUAL_QUOTE,
                ) ? (
                  <p className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning-foreground">
                    历史规则仅可查看；新规则限选三种计价方式。
                  </p>
                ) : null}
            <MatchCheckboxGroup
              legend="产品结构"
              name="match.productStructures"
              labels={PRODUCT_STRUCTURE_LABELS}
              defaultValues={rule.match.productStructures}
              disabled={pending}
              errors={errors['match.productStructures']}
              errorId={`${prefix}-productStructures-error`}
            />
            <MatchCheckboxGroup
              legend="烫金方式"
              name="match.foilTechniques"
              labels={FOIL_TECHNIQUE_LABELS}
              defaultValues={rule.match.foilTechniques}
              disabled={pending}
              errors={errors['match.foilTechniques']}
              errorId={`${prefix}-foilTechniques-error`}
            />
            <MatchCheckboxGroup
              legend="覆膜方式"
              name="match.laminations"
              labels={LAMINATION_LABELS}
              defaultValues={rule.match.laminations}
              disabled={pending}
              errors={errors['match.laminations']}
              errorId={`${prefix}-laminations-error`}
            />

            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <MatcherTextField
                id={`${prefix}-specifications`}
                name="match.specifications"
                label="尺寸规格名称"
                defaultValues={rule.match.specifications}
                errors={errors['match.specifications']}
                placeholder="例如：大号、中号"
              />
              <MatcherTextField
                id={`${prefix}-paperTypes`}
                name="match.paperTypes"
                label="纸张名称"
                defaultValues={rule.match.paperTypes}
                errors={errors['match.paperTypes']}
                placeholder="例如：160克触感纸、触感纸"
              />
              <MatchCheckboxGroup<string>
                legend="适用工艺"
                name="match.craftCodes"
                labels={craftLabels}
                values={craftValues}
                defaultValues={rule.match.craftCodes}
                disabled={pending}
                errors={errors['match.craftCodes']}
                errorId={`${prefix}-craftCodes-error`}
              />
              <Field
                label="多工艺条件"
                htmlFor={`${prefix}-craftMode`}
                errorId={`${prefix}-craftMode-error`}
                errors={errors['match.craftMode']}
              >
                <select
                  id={`${prefix}-craftMode`}
                  name="match.craftMode"
                  className={selectClass}
                  defaultValue={rule.match.craftMode === 'ALL' ? 'ALL' : ''}
                >
                  <option value="">命中任一工艺（默认）</option>
                  <option value="ALL">必须同时包含全部工艺</option>
                </select>
              </Field>
              <MatchCheckboxGroup<string>
                legend="排除工艺"
                name="match.noneOfCraftCodes"
                labels={craftLabels}
                values={craftValues}
                defaultValues={rule.match.noneOfCraftCodes}
                disabled={pending}
                errors={errors['match.noneOfCraftCodes']}
                errorId={`${prefix}-noneOfCraftCodes-error`}
              />
              <MatchCheckboxGroup<string>
                legend="已覆盖工艺（出现其他工艺时触发）"
                name="match.anyCraftCodeOutside"
                labels={craftLabels}
                values={craftValues}
                defaultValues={rule.match.anyCraftCodeOutside}
                disabled={pending}
                errors={errors['match.anyCraftCodeOutside']}
                errorId={`${prefix}-anyCraftCodeOutside-error`}
              />
              <MatcherTextField
                id={`${prefix}-foilColors`}
                name="match.foilColors"
                label="烫金颜色"
                defaultValues={rule.match.foilColors}
                errors={errors['match.foilColors']}
                placeholder="例如：金、银"
              />
              <MatcherTextField
                id={`${prefix}-printColors`}
                name="match.printColors"
                label="彩印颜色"
                defaultValues={rule.match.printColors}
                errors={errors['match.printColors']}
                placeholder="例如：C、M、Y、K"
              />
              <MatcherTriStateField
                id={`${prefix}-isDoubleSided`}
                name="match.isDoubleSided"
                label="单双面"
                defaultValue={rule.match.isDoubleSided}
                trueLabel="双面"
                falseLabel="单面"
                errors={errors['match.isDoubleSided']}
              />
              <MatcherTriStateField
                id={`${prefix}-isDoubleColor`}
                name="match.isDoubleColor"
                label="单双色"
                defaultValue={rule.match.isDoubleColor}
                trueLabel="双色"
                falseLabel="单色"
                errors={errors['match.isDoubleColor']}
              />
              <MatcherTriStateField
                id={`${prefix}-hasLocalFoil`}
                name="match.hasLocalFoil"
                label="局部烫金"
                defaultValue={rule.match.hasLocalFoil}
                trueLabel="是"
                falseLabel="否"
                errors={errors['match.hasLocalFoil']}
              />
            </div>

            <fieldset className="min-w-0 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">颜色与烫金道数</legend>
              <p className="mt-1 text-xs text-muted-foreground">
                精确值与范围不能同时填写。
              </p>
              <div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <MatcherNumberField id={`${prefix}-foilColorCount`} name="match.foilColorCount" label="烫金颜色精确数" defaultValue={rule.match.foilColorCount} errors={errors['match.foilColorCount']} />
                <MatcherNumberField id={`${prefix}-minFoilColorCount`} name="match.minFoilColorCount" label="烫金颜色最小数" defaultValue={rule.match.minFoilColorCount} errors={errors['match.minFoilColorCount']} />
                <MatcherNumberField id={`${prefix}-maxFoilColorCount`} name="match.maxFoilColorCount" label="烫金颜色最大数" defaultValue={rule.match.maxFoilColorCount} errors={errors['match.maxFoilColorCount']} />
                <MatcherNumberField id={`${prefix}-foilPassCount`} name="match.foilPassCount" label="烫金精确道数（正面＋背面）" defaultValue={rule.match.foilPassCount} errors={errors['match.foilPassCount']} />
                <MatcherNumberField id={`${prefix}-minFoilPassCount`} name="match.minFoilPassCount" label="烫金最少道数（正面＋背面）" defaultValue={rule.match.minFoilPassCount} errors={errors['match.minFoilPassCount']} />
                <MatcherNumberField id={`${prefix}-maxFoilPassCount`} name="match.maxFoilPassCount" label="烫金最多道数（正面＋背面）" defaultValue={rule.match.maxFoilPassCount} errors={errors['match.maxFoilPassCount']} />
                <MatcherNumberField id={`${prefix}-printColorCount`} name="match.printColorCount" label="彩印颜色精确数" defaultValue={rule.match.printColorCount} errors={errors['match.printColorCount']} />
                <MatcherNumberField id={`${prefix}-minPrintColorCount`} name="match.minPrintColorCount" label="彩印颜色最小数" defaultValue={rule.match.minPrintColorCount} errors={errors['match.minPrintColorCount']} />
                <MatcherNumberField id={`${prefix}-maxPrintColorCount`} name="match.maxPrintColorCount" label="彩印颜色最大数" defaultValue={rule.match.maxPrintColorCount} errors={errors['match.maxPrintColorCount']} />
              </div>
            </fieldset>

            <fieldset className="min-w-0 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">实际尺寸、克重与订单范围</legend>
              <div className="mt-2 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MatcherNumberField id={`${prefix}-minWidthMm`} name="match.minWidthMm" label="最小宽度（mm）" defaultValue={rule.match.minWidthMm} errors={errors['match.minWidthMm']} min={0.01} step={0.01} />
                <MatcherNumberField id={`${prefix}-maxWidthMm`} name="match.maxWidthMm" label="最大宽度（mm）" defaultValue={rule.match.maxWidthMm} errors={errors['match.maxWidthMm']} min={0.01} step={0.01} />
                <MatcherNumberField id={`${prefix}-minHeightMm`} name="match.minHeightMm" label="最小高度（mm）" defaultValue={rule.match.minHeightMm} errors={errors['match.minHeightMm']} min={0.01} step={0.01} />
                <MatcherNumberField id={`${prefix}-maxHeightMm`} name="match.maxHeightMm" label="最大高度（mm）" defaultValue={rule.match.maxHeightMm} errors={errors['match.maxHeightMm']} min={0.01} step={0.01} />
                <MatcherNumberField id={`${prefix}-minPaperWeightGsm`} name="match.minPaperWeightGsm" label="最小克重（g）" defaultValue={rule.match.minPaperWeightGsm} errors={errors['match.minPaperWeightGsm']} min={1} />
                <MatcherNumberField id={`${prefix}-maxPaperWeightGsm`} name="match.maxPaperWeightGsm" label="最大克重（g）" defaultValue={rule.match.maxPaperWeightGsm} errors={errors['match.maxPaperWeightGsm']} min={1} />
                <MatcherNumberField id={`${prefix}-minItemCount`} name="match.minItemCount" label="订单最少款式数" defaultValue={rule.match.minItemCount} errors={errors['match.minItemCount']} min={1} />
                <MatcherNumberField id={`${prefix}-maxItemCount`} name="match.maxItemCount" label="订单最多款式数" defaultValue={rule.match.maxItemCount} errors={errors['match.maxItemCount']} min={1} />
              </div>
            </fieldset>

                <fieldset className="grid min-w-0 gap-2 rounded-lg border p-3 sm:grid-cols-2">
              <legend className="px-1 text-sm font-medium">计算倍数</legend>
              {[
                ['match.perFoilColor', '按实际烫金颜色数乘算', rule.match.perFoilColor],
                ['match.perFoilPass', '按实际烫金道数乘算', rule.match.perFoilPass],
                ['match.perPrintColor', '按实际彩印颜色数乘算', rule.match.perPrintColor],
              ].map(([name, label, checked]) => (
                <label key={String(name)} className="flex min-h-11 cursor-pointer items-center gap-1 rounded-lg border bg-background pr-3 text-sm has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
                  <Checkbox
                    name={String(name)}
                    value="true"
                    defaultChecked={Boolean(checked)}
                    disabled={pending}
                    aria-label={String(label)}
                  />
                  <span>{String(label)}</span>
                </label>
              ))}
                </fieldset>
              </>
            )}
          </div>
        </Disclosure>
      ) : null}

      {isShipping ? (
        <fieldset className="min-w-0 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">物流首重/续重</legend>
          <div className="mt-2 grid min-w-0 gap-4 sm:grid-cols-3">
            <Field
              label="首重单位（kg）"
              htmlFor={`${prefix}-includedUnits`}
              errorId={errorIdFor('includedUnits')}
              errors={errors.includedUnits}
            >
              <Input
                id={`${prefix}-includedUnits`}
                name="includedUnits"
                inputMode="decimal"
                className={controlClass}
                defaultValue={rule.includedUnits ?? ''}
                {...fieldA11y('includedUnits')}
              />
            </Field>
            <Field
              label="续重单位（kg）"
              htmlFor={`${prefix}-incrementUnits`}
              errorId={errorIdFor('incrementUnits')}
              errors={errors.incrementUnits}
            >
              <Input
                id={`${prefix}-incrementUnits`}
                name="incrementUnits"
                inputMode="decimal"
                className={controlClass}
                defaultValue={rule.incrementUnits ?? ''}
                {...fieldA11y('incrementUnits')}
              />
            </Field>
            <Field
              label="续重金额（元）"
              htmlFor={`${prefix}-incrementAmount`}
              errorId={errorIdFor('incrementAmount')}
              errors={errors.incrementAmount}
            >
              <Input
                id={`${prefix}-incrementAmount`}
                name="incrementAmount"
                inputMode="decimal"
                className={controlClass}
                defaultValue={rule.incrementAmount ?? ''}
                {...fieldA11y('incrementAmount')}
              />
            </Field>
          </div>
        </fieldset>
      ) : (
        null
      )}

      <fieldset
        className={`grid min-w-0 gap-3 rounded-lg border p-3 ${
          isProcessing ? 'sm:grid-cols-2' : ''
        }`}
      >
        <legend className="px-1 text-sm font-medium">规则状态</legend>
        <input type="hidden" name="isActive" value="false" />
        <label className="flex min-h-11 min-w-0 cursor-pointer items-center gap-1 text-sm has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
          <Checkbox
            name="isActive"
            value="true"
            defaultChecked={rule.isActive}
            disabled={pending}
            aria-label="启用此规则"
            {...fieldA11y('isActive')}
          />
          <span className="admin-wrap-anywhere">启用此规则</span>
        </label>
        <FieldErrorMessages
          id={errorIdFor('isActive')}
          messages={errors.isActive}
        />
        {isProcessing ? (
          <>
            <input
              type="hidden"
              name="blocksAutomaticQuote"
              value="false"
            />
            <label className="flex min-h-11 min-w-0 cursor-pointer items-center gap-1 text-sm has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
              <Checkbox
                name="blocksAutomaticQuote"
                value="true"
                defaultChecked={rule.blocksAutomaticQuote}
                disabled={pending}
                aria-label="不自动计价"
                {...fieldA11y('blocksAutomaticQuote')}
              />
              <span className="admin-wrap-anywhere">
                不自动计价
              </span>
            </label>
            <FieldErrorMessages
              id={errorIdFor('blocksAutomaticQuote')}
              messages={errors.blocksAutomaticQuote}
            />
          </>
        ) : (
          null
        )}
      </fieldset>

      <MutationFeedback
        state={state}
        onRefresh={() => router.refresh()}
        successMessage="草稿已保存。"
      />
      <div className="sticky bottom-0 z-10 -mx-4 flex min-w-0 flex-col gap-2 border-t bg-card/95 px-4 pt-3 admin-safe-bottom shadow-[0_-8px_18px_-16px_var(--foreground)] backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-muted-foreground">
          发布后生效。
        </p>
        <Button
          type="submit"
          className="min-h-11 w-full sm:w-auto"
          disabled={pending}
        >
          {pending ? '保存中…' : '保存草稿'}
        </Button>
      </div>
    </form>
  );
}
