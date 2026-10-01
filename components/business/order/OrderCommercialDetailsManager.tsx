'use client';

import { useActionState, useContext, useState, useTransition } from 'react';
import { formatMoneyPlain } from '@/lib/dashboard/format';
import { cn } from '@/lib/utils';
import {
  deleteOrderManualChargeAction,
  deleteOrderPlateDetailAction,
  saveOrderManualChargeAction,
  saveOrderPlateDetailAction,
} from '@/actions/order';
import type { OrderCommercialDetailMutationResult } from '@/actions/order.types';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';
import { OrderEditorAuxiliaryContext, useOrderEditorAuxiliary } from './use-order-editor-auxiliary';
import { CommercialFeeRecoveryNotice, useCommercialFeeRecovery, type CommercialFeeRecovery } from './use-commercial-fee-recovery';

type ManualChargeCode =
  | 'SAMPLE_FEE'
  | 'OTHER_PACKAGING_FEE'
  | 'APPROVED_ADJUSTMENT';

type ManualCharge = {
  id: string;
  status: string;
  description: string;
  amount: string;
  overrideReason: string | null;
  approvalReference: string | null;
  category: { code: string; name: string };
  finalizedBy: { displayName: string } | null;
  finalizedAt: Date | string | null;
};

type PlateDetail = {
  id: string;
  sequence: number;
  name: string;
  plateGroupId: string | null;
  specification: string | null;
  quantity: number;
  unitPrice: string;
  amount: string;
  remark: string | null;
  isActive: boolean;
};

type ItemWithPlateDetails = {
  id: string;
  sequence: number;
  name: string;
  independentPlateEligible: boolean;
  plateDetails: PlateDetail[];
};

type Props = {
  headingLevel?: 2 | 3;
  /** Reuse the enclosing disclosure's heading and surface on the edit page. */
  embedded?: boolean;
  orderId: string;
  priceRevision: number;
  manualCharges: ManualCharge[];
  items: ItemWithPlateDetails[];
  allowPlateDetailMaintenance: boolean;
};

const MANUAL_CHARGE_OPTIONS: Array<{
  value: ManualChargeCode;
  label: string;
}> = [
  { value: 'SAMPLE_FEE', label: '打样费' },
  { value: 'OTHER_PACKAGING_FEE', label: '其他包装费' },
  { value: 'APPROVED_ADJUSTMENT', label: '经审批调整金额' },
];

function resultError(
  result: OrderCommercialDetailMutationResult | null,
): string | null {
  if (result?.status === 'error') return result.message;
  if (result?.status === 'invalid') {
    return Object.values(result.fieldErrors).flat()[0] ?? '提交内容非法';
  }
  return null;
}

function ManualChargeEditor({
  orderId,
  priceRevision,
  charge,
  recovery,
}: {
  orderId: string;
  priceRevision: number;
  charge: ManualCharge | null;
  recovery: CommercialFeeRecovery;
}) {
  const initialCategory = isManualChargeCode(charge?.category.code)
    ? charge.category.code
    : 'SAMPLE_FEE';
  const [categoryCode, setCategoryCode] =
    useState<ManualChargeCode>(initialCategory);
  const [description, setDescription] = useState(charge?.description ?? '');
  const [amount, setAmount] = useState(charge?.amount ?? '');
  const [reason, setReason] = useState(charge?.overrideReason ?? '');
  const [approvalReference, setApprovalReference] = useState(
    charge?.approvalReference ?? '',
  );
  const [removeReason, setRemoveReason] = useState('');
  const [saveState, saveAction] = useActionState<
    OrderCommercialDetailMutationResult | null,
    unknown
  >((previous, input) => recovery.run(saveOrderManualChargeAction, previous, input), null);
  const [deleteState, deleteAction] = useActionState<
    OrderCommercialDetailMutationResult | null,
    unknown
  >((previous, input) => recovery.run(deleteOrderManualChargeAction, previous, input), null);
  const [savePending, startSave] = useTransition();
  const [deletePending, startDelete] = useTransition();

  const removed = charge?.status === 'WAIVED';
  const dirty = !removed && (
    categoryCode !== initialCategory || description !== (charge?.description ?? '') ||
    amount !== (charge?.amount ?? '') || reason !== (charge?.overrideReason ?? '') ||
    approvalReference !== (charge?.approvalReference ?? '') || removeReason !== ''
  );
  const auxiliary = useOrderEditorAuxiliary({ dirty, pending: savePending || deletePending });
  const disabled = auxiliary.blocked || savePending || deletePending || recovery.isBlocked;
  function resetDraft() {
    setCategoryCode(initialCategory);
    setDescription(charge?.description ?? '');
    setAmount(charge?.amount ?? '');
    setReason(charge?.overrideReason ?? '');
    setApprovalReference(charge?.approvalReference ?? '');
    setRemoveReason('');
  }
  const ready =
    description.trim().length > 0 &&
    amount.trim().length > 0 &&
    reason.trim().length > 0 &&
    (categoryCode !== 'APPROVED_ADJUSTMENT' ||
      approvalReference.trim().length > 0);

  return (
    <div className="@container/fee-row min-w-0 space-y-3 py-5 first:pt-0 last:pb-0">
      <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {charge ? charge.category.name : '添加订单级费用'}
        </p>
        {charge ? (
          <Badge variant={removed ? 'outline' : 'secondary'}>
            {removed ? '已移除（保留历史）' : '管理员已确认'}
          </Badge>
        ) : null}
      </div>

      {removed ? (
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">收费说明</dt>
            <dd>{description}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">移除说明</dt>
            <dd>{reason}</dd>
          </div>
        </dl>
      ) : (
        <>
          <div className="grid min-w-0 gap-3 @min-[400px]/fee-row:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span>费用类型</span>
              <NativeSelect
                className="w-full"
                value={categoryCode}
                onChange={(event) =>
                  setCategoryCode(event.target.value as ManualChargeCode)
                }
              >
                {MANUAL_CHARGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="space-y-1 text-xs">
              <span>
                金额（元
                {categoryCode === 'APPROVED_ADJUSTMENT'
                  ? '，审批调整可为负数'
                  : '，不得为负数'}
                ）
              </span>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-label="订单级费用金额"
              />
            </label>
          </div>
          <label className="block space-y-1 text-xs">
            <span>收费说明</span>
            <Input
              maxLength={120}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span>原因</span>
            <Textarea
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {categoryCode === 'APPROVED_ADJUSTMENT' ? (
            <label className="block space-y-1 text-xs">
              <span>审批信息（审批人 / 单号 / 结论）</span>
              <Textarea
                maxLength={500}
                value={approvalReference}
                onChange={(event) =>
                  setApprovalReference(event.target.value)
                }
              />
            </label>
          ) : null}
          {charge?.finalizedBy ? (
            <p className="text-xs text-muted-foreground">
              最近确认人：{charge.finalizedBy.displayName}
            </p>
          ) : null}
          {resultError(saveState) ? (
            <p role="alert" className="text-xs text-destructive">
              {resultError(saveState)}
            </p>
          ) : null}
          {!recovery.hasUnknownResult && saveState?.status === 'success' ? (
            <p role="status" className="text-xs text-success-foreground">
              已保存，工单总额更新为 {saveState.totalAmount} 元。
            </p>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={!ready || disabled}
            onClick={() =>
              startSave(() =>
                saveAction({
                  orderId,
                  chargeId: charge?.id ?? null,
                  expectedPriceRevision: priceRevision,
                  categoryCode,
                  description,
                  amount,
                  reason,
                  approvalReference,
                }),
              )
            }
          >
            {savePending ? '正在保存…' : charge ? '保存修改' : '添加费用'}
          </Button>
          {charge ? (
            <div className="space-y-2 pt-2">
              <label className="block space-y-1 text-xs">
                <span>移除原因</span>
                <Input
                  maxLength={500}
                  value={removeReason}
                  onChange={(event) => setRemoveReason(event.target.value)}
                />
              </label>
              {resultError(deleteState) ? (
                <p role="alert" className="text-xs text-destructive">
                  {resultError(deleteState)}
                </p>
              ) : null}
                  <ConfirmActionController level="L2"
                    disabled={!removeReason.trim() || disabled}
                    trigger={
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!removeReason.trim() || disabled}
                      >
                        {deletePending ? '正在移除…' : '移除并保留历史'}
                      </Button>
                    }
                    onConfirm={() =>
                      startDelete(() =>
                        deleteAction({
                          orderId,
                          chargeId: charge.id,
                          expectedPriceRevision: priceRevision,
                          reason: removeReason,
                        }),
                      )
                    }>
                    <ConfirmActionDialog action="移除这项对客费用" changes={[]} consequences={[
                      '对客应收总额将立即重算',
                      '原金额、确认人和移除原因继续保留',
                    ]} confirmText="移除对客费用" />
                  </ConfirmActionController>
            </div>
          ) : null}
        </>
      )}
      </fieldset>
      {auxiliary.managed && dirty ? <Button type="button" variant="outline" size="sm" disabled={savePending || deletePending || auxiliary.pending || recovery.isBlocked} onClick={resetDraft}>还原费用输入</Button> : null}
    </div>
  );
}

function PlateDetailEditor({
  orderId,
  orderItemId,
  priceRevision,
  detail,
  recovery,
}: {
  orderId: string;
  orderItemId: string;
  priceRevision: number;
  detail: PlateDetail | null;
  recovery: CommercialFeeRecovery;
}) {
  const [name, setName] = useState(detail?.name ?? '');
  // Existing rows retain their billing quantity and production metadata.
  const plateGroupId = detail?.plateGroupId ?? '';
  const specification = detail?.specification ?? '';
  const quantity = String(detail?.quantity ?? 1);
  const [unitPrice, setUnitPrice] = useState(detail?.unitPrice ?? '');
  const [remark, setRemark] = useState(detail?.remark ?? '');
  const [removeReason, setRemoveReason] = useState('');
  const [saveState, saveAction] = useActionState<
    OrderCommercialDetailMutationResult | null,
    unknown
  >((previous, input) => recovery.run(saveOrderPlateDetailAction, previous, input), null);
  const [deleteState, deleteAction] = useActionState<
    OrderCommercialDetailMutationResult | null,
    unknown
  >((previous, input) => recovery.run(deleteOrderPlateDetailAction, previous, input), null);
  const [savePending, startSave] = useTransition();
  const [deletePending, startDelete] = useTransition();
  const dirty = (!detail || detail.isActive) && (
    name !== (detail?.name ?? '') ||
    unitPrice !== (detail?.unitPrice ?? '') || remark !== (detail?.remark ?? '') || removeReason !== ''
  );
  const auxiliary = useOrderEditorAuxiliary({ dirty, pending: savePending || deletePending });
  const disabled = auxiliary.blocked || savePending || deletePending || recovery.isBlocked;
  function resetDraft() {
    setName(detail?.name ?? '');
    setUnitPrice(detail?.unitPrice ?? '');
    setRemark(detail?.remark ?? '');
    setRemoveReason('');
  }

  if (detail && !detail.isActive) {
    return (
      <div className="min-w-0 py-5 text-xs text-muted-foreground first:pt-0 last:pb-0">
        <div className="flex flex-wrap justify-between gap-2">
          <span>
            #{detail.sequence} · {detail.name} · 原金额 {detail.amount} 元
          </span>
          <Badge variant="outline">已移除（保留历史）</Badge>
        </div>
      </div>
    );
  }

  const calculatedAmount = Number(quantity) * Number(unitPrice);
  const ready =
    name.trim().length > 0 &&
    /^\d+$/.test(quantity) &&
    Number(quantity) > 0 &&
    unitPrice.trim().length > 0;

  return (
    <div className="@container/fee-row min-w-0 space-y-3 py-5 first:pt-0 last:pb-0">
      <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium">
          {detail ? `制版明细 #${detail.sequence}` : '添加制版明细'}
        </p>
        {Number.isFinite(calculatedAmount) ? (
          <span className="font-sans text-xs tabular-nums">
            {Number(quantity) > 1 ? `数量 ${quantity} · ` : null}
            金额 {formatMoneyPlain(calculatedAmount)} 元
          </span>
        ) : null}
      </div>
      <div className="grid min-w-0 gap-3 @min-[400px]/fee-row:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span>制版名称</span>
          <Input
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs">
          <span>单价（元）</span>
          <Input
            inputMode="decimal"
            value={unitPrice}
            onChange={(event) => setUnitPrice(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs @min-[400px]/fee-row:col-span-2">
          <span>备注</span>
          <Textarea
            value={remark}
            maxLength={500}
            onChange={(event) => setRemark(event.target.value)}
          />
        </label>
      </div>
      {resultError(saveState) ? (
        <p role="alert" className="text-xs text-destructive">
          {resultError(saveState)}
        </p>
      ) : null}
      {!recovery.hasUnknownResult && saveState?.status === 'success' ? (
        <p role="status" className="text-xs text-success-foreground">
          制版明细已保存，工单总额更新为 {saveState.totalAmount} 元。
        </p>
      ) : null}
      <Button
        type="button"
        size="sm"
        disabled={!ready || disabled}
        onClick={() =>
          startSave(() =>
            saveAction({
              orderId,
              orderItemId,
              plateDetailId: detail?.id ?? null,
              expectedPriceRevision: priceRevision,
              name,
              plateGroupId,
              specification,
              quantity,
              unitPrice,
              remark,
            }),
          )
        }
      >
        {savePending ? '正在保存…' : detail ? '保存制版修改' : '添加制版明细'}
      </Button>
      {detail ? (
        <div className="space-y-2 pt-2">
          <label className="block space-y-1 text-xs">
            <span>移除原因</span>
            <Input
              value={removeReason}
              maxLength={500}
              onChange={(event) => setRemoveReason(event.target.value)}
            />
          </label>
          {resultError(deleteState) ? (
            <p role="alert" className="text-xs text-destructive">
              {resultError(deleteState)}
            </p>
          ) : null}
            <ConfirmActionController level="L2"
              disabled={!removeReason.trim() || disabled}
              trigger={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!removeReason.trim() || disabled}
                >
                  {deletePending ? '正在移除…' : '移除并保留历史'}
                </Button>
              }
              onConfirm={() =>
                startDelete(() =>
                  deleteAction({
                    orderId,
                    orderItemId,
                    plateDetailId: detail.id,
                    expectedPriceRevision: priceRevision,
                    reason: removeReason,
                  }),
                )
              }>
              <ConfirmActionDialog action="移除这条制版明细" changes={[]} consequences={[
                '对应制版费归零并重算工单总额',
                '制版明细保留为已移除历史记录',
              ]} confirmText="移除制版明细" />
            </ConfirmActionController>
        </div>
      ) : null}
      </fieldset>
      {auxiliary.managed && dirty ? <Button type="button" variant="outline" size="sm" disabled={savePending || deletePending || auxiliary.pending || recovery.isBlocked} onClick={resetDraft}>还原费用输入</Button> : null}
    </div>
  );
}

function isManualChargeCode(value: string | undefined): value is ManualChargeCode {
  return MANUAL_CHARGE_OPTIONS.some((option) => option.value === value);
}

export function OrderCommercialDetailsManager({
  orderId,
  priceRevision,
  manualCharges,
  items,
  allowPlateDetailMaintenance,
  headingLevel = 2,
  embedded = false,
}: Props) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const Subheading = headingLevel === 3 ? 'h4' : 'h3';
  const ItemHeading = headingLevel === 3 ? 'h5' : 'h4';
  const recovery = useCommercialFeeRecovery();
  useOrderEditorAuxiliary({ dirty: recovery.hasUnknownResult, pending: recovery.isPending });
  const scope = useContext(OrderEditorAuxiliaryContext);
  const plateItems = items.filter((item) => item.independentPlateEligible || item.plateDetails.length > 0);
  const hasActiveEditor = scope?.mainBlocked || Object.values(scope?.entries ?? {}).some((entry) => entry.dirty || entry.pending);
  return (
    <section id="commercial-fees" aria-label="制版明细与其他费用" className={cn(
      '@container/fees min-w-0 space-y-6 [overflow-wrap:anywhere]',
      !embedded && 'rounded-xl border bg-card p-4 sm:p-6',
    )}>
      {!embedded ? <Heading className="text-base font-semibold">制版明细与其他费用</Heading> : null}
      {recovery.hasUnknownResult ? <CommercialFeeRecoveryNotice orderId={orderId} /> : null}
      {!recovery.hasUnknownResult && hasActiveEditor ? <p className="text-xs text-muted-foreground">请先保存或还原当前输入，再编辑其他工单资料或费用。</p> : null}

      <div className="grid min-w-0 gap-4 @min-[640px]/fees:grid-cols-[136px_minmax(0,1fr)] @min-[640px]/fees:gap-6">
        <Subheading className="text-sm font-semibold">订单级其他费用</Subheading>
        <div className="min-w-0 divide-y">
          {manualCharges.map((charge) => (
            <ManualChargeEditor
              key={charge.id}
              recovery={recovery}
              orderId={orderId}
              priceRevision={priceRevision}
              charge={charge}
            />
          ))}
          <ManualChargeEditor
            key={`new-manual-${priceRevision}`}
            recovery={recovery}
            orderId={orderId}
            priceRevision={priceRevision}
            charge={null}
          />
        </div>
      </div>

      {!allowPlateDetailMaintenance || plateItems.length > 0 ? <div className="grid min-w-0 gap-4 border-t pt-6 @min-[640px]/fees:grid-cols-[136px_minmax(0,1fr)] @min-[640px]/fees:gap-6">
        <Subheading className="text-sm font-semibold">按款式制版明细</Subheading>
        {allowPlateDetailMaintenance ? (
          <ol className="min-w-0 divide-y">
            {plateItems.map((item) => (
              <li key={item.id} className="min-w-0 space-y-4 py-6 first:pt-0 last:pb-0">
                <ItemHeading className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                  #{item.sequence} · {item.name}
                </ItemHeading>
                <div className="min-w-0 divide-y">
                  {item.plateDetails.map((detail) => (
                    <PlateDetailEditor
                      key={detail.id}
                      recovery={recovery}
                      orderId={orderId}
                      orderItemId={item.id}
                      priceRevision={priceRevision}
                      detail={detail}
                    />
                  ))}
                  {item.independentPlateEligible ? (
                    <PlateDetailEditor
                      key={`new-plate-${item.id}-${priceRevision}`}
                      recovery={recovery}
                      orderId={orderId}
                      orderItemId={item.id}
                      priceRevision={priceRevision}
                      detail={null}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-muted-foreground">
            当前价格待管理员确认，请在上方“工厂核价确认”中直接填写制烫金版费；确认后才能维护逐款明细。
          </p>
        )}
      </div> : null}
    </section>
  );
}
