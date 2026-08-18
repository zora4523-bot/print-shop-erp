'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  createCustomerPriceBookDraftAction,
  discardCustomerPriceBookDraftAction,
  publishCustomerPriceBookDraftAction,
  updateCustomerPriceRuleDraftAction,
} from '@/actions/customer-price-books';
import type {
  CustomerPriceBookMutationResult,
  UpdateCustomerPriceRuleDraftActionInput,
} from '@/actions/customer-price-books.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
  CustomerPriceRuleKind,
} from '@/generated/prisma/enums';
import type {
  CustomerPriceRuleDraftEditorDto,
} from '@/lib/price/customer-price-book-admin';
import { externalPriceRuleDisplayName } from './external-price-display';

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
  [CustomerPriceRuleKind.BASE]: '基础价',
  [CustomerPriceRuleKind.ADD_ON]: '附加费',
  [CustomerPriceRuleKind.REFERENCE]: '人工参考/阻断',
};

const CALCULATION_TYPE_LABELS: Record<CustomerPriceCalculationType, string> = {
  [CustomerPriceCalculationType.PER_PIECE]: '按个',
  [CustomerPriceCalculationType.FIXED_AMOUNT]: '整批固定金额',
  [CustomerPriceCalculationType.PER_SHEET]: '按张',
  [CustomerPriceCalculationType.PER_10K]: '每万个',
  [CustomerPriceCalculationType.PER_ITEM]: '每款一次',
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
  returnHref,
}: {
  purpose: CustomerPriceBookPurpose;
  returnHref?: string;
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
        `/owner/prices/external-sales/items?purpose=${
          purpose === CustomerPriceBookPurpose.LOGISTICS
            ? 'logistics'
            : 'processing'
        }`,
    );
  }, [purpose, returnHref, router, state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-label={`创建${
        purpose === CustomerPriceBookPurpose.PROCESSING
          ? '加工费'
          : '快递与耗材'
      }调价草稿`}
      className="mt-4 min-w-0 space-y-3 rounded-lg border border-dashed p-3"
    >
      <input type="hidden" name="purpose" value={purpose} />
      <div className="space-y-1">
        <p className="text-sm font-medium">从当前生效价目开始调整</p>
        <p className="text-xs leading-5 text-muted-foreground">
          系统会复制当前价目为一份独立草稿。草稿发布前不会影响当前报价，历史工单的原结算金额也不会改变。
        </p>
      </div>
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
          请说明这次调整的原因，方便后续查看调价记录。
        </p>
        <FieldErrorMessages
          id={changeReasonErrorId}
          messages={errors.changeReason}
        />
      </div>
      <Button type="submit" className="min-h-11" disabled={pending}>
        {pending ? '正在复制…' : '复制当前价目并开始调价'}
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
}: {
  priceBookId: string;
  expectedDraftUpdatedAt: string;
  defaultEffectiveFrom: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<MutationState, FormData>(
    publishDraftFromForm,
    null,
  );
  const formRef = useFocusFirstInvalidField(state);
  const errors = mutationFieldErrors(state);
  const effectiveFromId = `effectiveFrom-${priceBookId}`;
  const effectiveFromHintId = `${effectiveFromId}-hint`;
  const effectiveFromErrorId = `${effectiveFromId}-error`;

  useEffect(() => {
    if (state?.status !== 'success') return;
    router.replace('/owner/prices/external-sales/versions');
  }, [router, state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-label="发布价目草稿"
      className="min-w-0 space-y-3 rounded-lg border p-3"
    >
      <input type="hidden" name="priceBookId" value={priceBookId} />
      <input
        type="hidden"
        name="expectedDraftUpdatedAt"
        value={expectedDraftUpdatedAt}
      />
      <div className="space-y-2">
        <Label htmlFor={effectiveFromId}>
          生效时间（上海时间）
        </Label>
        <Input
          id={effectiveFromId}
          name="effectiveFrom"
          type="datetime-local"
          className={controlClass}
          defaultValue={defaultEffectiveFrom}
          required
          aria-required="true"
          aria-invalid={Boolean(errors.effectiveFrom?.length)}
          aria-describedby={fieldDescriptionIds(
            effectiveFromErrorId,
            errors.effectiveFrom,
            effectiveFromHintId,
          )}
        />
        <p id={effectiveFromHintId} className="text-xs text-muted-foreground">
          按 Asia/Shanghai 解释。发布前会检查数量区间、金额和规则冲突。
        </p>
        <FieldErrorMessages
          id={effectiveFromErrorId}
          messages={errors.effectiveFrom}
        />
      </div>
      <Button type="submit" className="min-h-11" disabled={pending}>
        {pending ? '校验并发布中…' : '校验并发布'}
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

  useEffect(() => {
    if (state?.status !== 'success') return;
    router.replace('/owner/prices/external-sales/versions');
  }, [router, state]);

  return (
    <form
      action={formAction}
      aria-label="放弃价目草稿"
      className="min-w-0 space-y-3 rounded-lg border border-destructive/30 p-3"
      onSubmit={(event) => {
        if (
          !window.confirm(
            '确定放弃这份草稿？草稿和其中所有未发布修改将永久删除，已发布版本不受影响。',
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="priceBookId" value={priceBookId} />
      <input
        type="hidden"
        name="expectedDraftUpdatedAt"
        value={expectedDraftUpdatedAt}
      />
      <p className="text-xs text-muted-foreground">
        仅删除未发布草稿，不影响当前价目和历史工单。
      </p>
      <Button
        type="submit"
        variant="destructive"
        className="min-h-11"
        disabled={pending}
      >
        {pending ? '放弃中…' : '放弃草稿'}
      </Button>
      <MutationFeedback
        state={state}
        onRefresh={() => router.refresh()}
        successMessage="未发布草稿已放弃。"
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
      aria-label={`编辑收费项目：${displayName}`}
      className="min-w-0 space-y-5 rounded-xl border bg-card p-4 shadow-sm"
    >
      <input type="hidden" name="priceBookId" value={context.id} />
      <input type="hidden" name="ruleId" value={rule.id} />
      <input type="hidden" name="expectedUpdatedAt" value={rule.updatedAt} />

      <div className="space-y-1 border-b pb-4">
        <p className="text-sm font-medium">正在编辑调价草稿</p>
        <p className="text-xs leading-5 text-muted-foreground">
          保存只更新草稿，发布前不会改变当前报价或历史工单金额。
        </p>
      </div>

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
              label="收费类目"
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
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="适用产品"
              htmlFor={`${prefix}-product`}
              hint="留空表示通用收费项；基础价规则必须选择产品。"
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
                    {product.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="规则类型"
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
              <p className="font-medium">收费类目</p>
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
        <legend className="px-1 text-sm font-medium">状态与自动计价</legend>
        <input type="hidden" name="isActive" value="false" />
        <label className="relative flex min-h-11 min-w-0 cursor-pointer items-center pl-12 text-sm">
          <input
            type="checkbox"
            name="isActive"
            value="true"
            className="peer absolute top-0 left-0 size-11 cursor-pointer opacity-0"
            defaultChecked={rule.isActive}
            {...fieldA11y('isActive')}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 flex size-5 items-center justify-center rounded border border-input text-xs text-transparent peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
          >
            ✓
          </span>
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
            <label className="relative flex min-h-11 min-w-0 cursor-pointer items-center pl-12 text-sm">
              <input
                type="checkbox"
                name="blocksAutomaticQuote"
                value="true"
                className="peer absolute top-0 left-0 size-11 cursor-pointer opacity-0"
                defaultChecked={rule.blocksAutomaticQuote}
                {...fieldA11y('blocksAutomaticQuote')}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-3 flex size-5 items-center justify-center rounded border border-input text-xs text-transparent peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
              >
                ✓
              </span>
              <span className="admin-wrap-anywhere">
                此项目仅供参考，不自动计价
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
        successMessage="已保存到调价草稿。"
      />
      <div className="sticky bottom-0 z-10 -mx-4 flex min-w-0 flex-col gap-2 border-t bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_18px_-16px_var(--foreground)] backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-muted-foreground">
          只保存草稿；需要在发布中心发布后，新价才会生效。
        </p>
        <Button
          type="submit"
          className="min-h-11 w-full sm:w-auto"
          disabled={pending}
        >
          {pending ? '保存中…' : '保存到调价草稿'}
        </Button>
      </div>
    </form>
  );
}
