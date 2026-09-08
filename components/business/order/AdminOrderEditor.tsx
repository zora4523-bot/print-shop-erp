'use client';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, RotateCcw, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ActionNotice } from '@/components/ui-business';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { OrderStatusBadge } from './OrderStatusBadge';
import { EditOrderForm } from './EditOrderForm';
import {
  OrderChangePendingChargeEditor,
  buildOrderChangePendingChargeResolutions,
  type OrderChangePendingChargeDrafts,
} from './OrderChangeReviewForm';
import { DesignUploadPanel } from './DesignUploadPanel';
import { ORDER_PRICING_ROUTE_LABELS } from '@/lib/order/pricing-route';
import {
  listOrderChangeSpecificationOptions,
  type OrderChangeCatalogProduct,
} from '@/lib/order/change-request-catalog-identity';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import {
  previewAdminOrderEditAction,
  saveAdminOrderEditAction,
} from '@/actions/admin-order-edit';
import type {
  AdminOrderEditInput,
  AdminOrderEditPreview,
} from '@/lib/order/admin-edit-schema';
import type {
  OrderItemPricingRoute,
  OrderStatus,
} from '@/generated/prisma/enums';

type EditFormProps = ComponentProps<typeof EditOrderForm>;
export type AdminEditorItem = {
  id: string;
  sequence: number;
  name: string;
  quantity: number;
  pack: number | null;
  productId: string | null;
  pricingRoute: OrderItemPricingRoute;
  specification: string | null;
  paperType: string | null;
  paperWeightGsm: number | null;
  frontFoilColors: string[];
  backFoilColors: string[];
  subtotal: string | null;
  details?: ReactNode;
  packagingEditable: boolean;
  designs: ComponentProps<typeof DesignUploadPanel>['designs'];
};
type DraftItem = {
  key: string;
  sourceId: string;
  added: boolean;
  name: string;
  quantity: string;
  pack: string;
  productId: string | null;
  specification: string;
  front: string;
  back: string;
};
type Difference = { label: string; before: string; after: string };
type Props = {
  orderId: string;
  orderNo: string;
  status: OrderStatus;
  revision: number;
  workOrderVersion: number;
  items: AdminEditorItem[];
  products: OrderChangeCatalogProduct[];
  form: Omit<
    EditFormProps,
    'onReview' | 'onFormChange' | 'formId' | 'designLayout'
  >;
  canModify: boolean;
  canAdd: boolean;
  canEditDesigns: boolean;
  productionLocked: boolean;
  fees: ReactNode;
  pendingNotice?: ReactNode;
};
const money = (value: string | null) =>
  value === null
    ? '待核定'
    : `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const colors = (text: string) => [
  ...new Set(
    text
      .split(/[,，、]/)
      .map((value) => value.trim())
      .filter(Boolean),
  ),
];
const colorKey = (text: string) => colors(text).sort().join('、');
const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
const initialDraft = (item: AdminEditorItem): DraftItem => ({
  key: item.id,
  sourceId: item.id,
  added: false,
  name: item.name,
  quantity: String(item.quantity),
  pack: item.pack === null ? '' : String(item.pack),
  productId: item.productId,
  specification: item.specification ?? '',
  front: item.frontFoilColors.join('、'),
  back: item.backFoilColors.join('、'),
});
function formValues(data: FormData): Record<string, string> {
  // The checkbox's successful control precedes its hidden false fallback.
  return Object.fromEntries(
    [...new Set(data.keys())].map((key) => [key, String(data.get(key))]),
  );
}
const fieldNames: Record<string, string> = {
  customName: '工单名称',
  customerRef: '客户简称',
  externalSalesUserId: '关联外部销售',
  remark: '工单备注',
  packageRequirement: '包装补充说明',
  isUrgent: '急单',
  shipments: '收货信息',
};

/** Only collect changed form fields; inactive historical accounts must round-trip without reassignment. */
export function changedAdminOrderFields(
  before: Record<string, string>,
  after: Record<string, string>,
) {
  return Object.fromEntries(
    Object.entries(after).filter(
      ([key, value]) => key !== 'expectedEditVersion' && before[key] !== value,
    ),
  );
}

export function AdminOrderEditor(props: Props) {
  const router = useRouter();
  const formId = 'admin-order-edit-form';
  const [drafts, setDrafts] = useState(() => props.items.map(initialDraft));
  const [date, setDate] = useState(props.form.initial.promisedDate ?? '');
  const baseline = useRef<Record<string, string> | null>(null);
  const [metadataChanges, setMetadataChanges] = useState<Difference[]>([]);
  const ready = useSyncExternalStore(
    subscribeToHydration,
    clientReady,
    serverReady,
  );
  const [pending, startTransition] = useTransition();
  const [review, setReview] = useState<AdminOrderEditPreview | null>(null);
  const [payload, setPayload] = useState<AdminOrderEditInput | null>(null);
  const [error, setError] = useState('');
  const [chargeDrafts, setChargeDrafts] =
    useState<OrderChangePendingChargeDrafts>({});
  const [leaving, setLeaving] = useState(false);
  const destination = useRef(`/orders/${props.orderId}`);
  const readForm = () => {
    const element = document.getElementById(formId) as HTMLFormElement | null;
    return element ? formValues(new FormData(element)) : {};
  };
  useEffect(() => {
    if (ready) baseline.current = readForm();
  }, [ready]);
  const itemChanges: AdminOrderEditInput['items'] = [];
  const differences: Difference[] = [...metadataChanges];
  for (const draft of drafts) {
    const source = props.items.find((item) => item.id === draft.sourceId)!;
    const original = initialDraft(source);
    const label = `第 ${source.sequence} 款`;
    if (draft.added) {
      itemChanges.push({
        operation: 'ADD',
        templateItemId: source.id,
        name: draft.name,
        quantity: Number(draft.quantity),
        frontFoilColors: colors(draft.front),
        backFoilColors: colors(draft.back),
        ...(draft.productId &&
        (draft.productId !== source.productId ||
          draft.specification !== original.specification)
          ? {
              targetProductId: draft.productId,
              specification: draft.specification,
            }
          : {}),
      });
      differences.push({
        label: '新增款式',
        before: '—',
        after: `${draft.name || '未命名'} · ${externalPriceBusinessText(draft.specification)} · ${draft.quantity || '0'} 个 · 正面 ${draft.front || '无'} / 反面 ${draft.back || '无'}`,
      });
      continue;
    }
    const change: AdminOrderEditInput['items'][number] = {
      operation: 'UPDATE',
      itemId: source.id,
    };
    if (draft.name !== original.name) {
      change.name = draft.name;
      differences.push({
        label: `${label} · 名称`,
        before: source.name,
        after: draft.name,
      });
    }
    if (Number(draft.quantity) !== source.quantity) {
      change.quantity = Number(draft.quantity);
      differences.push({
        label: `${label} · 数量`,
        before: `${source.quantity} 个`,
        after: `${draft.quantity || '0'} 个`,
      });
    }
    if (draft.pack !== original.pack) {
      change.pack = Number(draft.pack);
      differences.push({
        label: `${label} · 每包数量`,
        before: original.pack || '未记录',
        after: draft.pack || '未填写',
      });
    }
    if (
      draft.productId !== original.productId ||
      draft.specification !== original.specification
    ) {
      if (draft.productId) change.targetProductId = draft.productId;
      change.specification = draft.specification;
      differences.push({
        label: `${label} · 规格`,
        before: externalPriceBusinessText(original.specification),
        after: externalPriceBusinessText(draft.specification),
      });
    }
    if (
      colorKey(draft.front) !== colorKey(original.front) ||
      colorKey(draft.back) !== colorKey(original.back)
    ) {
      change.frontFoilColors = colors(draft.front);
      change.backFoilColors = colors(draft.back);
      differences.push({
        label: `${label} · 烫金`,
        before: `正面 ${original.front || '无'} / 反面 ${original.back || '无'}`,
        after: `正面 ${draft.front || '无'} / 反面 ${draft.back || '无'}`,
      });
    }
    if (Object.keys(change).length > 2) itemChanges.push(change);
  }
  if (date !== (props.form.initial.promisedDate ?? ''))
    differences.push({
      label: '承诺交期',
      before: props.form.initial.promisedDate ?? '未设置',
      after: date || '未设置',
    });
  const dirty = differences.length > 0;
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const interceptLink = (event: MouseEvent) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>(
        'a[href]',
      );
      if (
        !dirtyRef.current ||
        !link ||
        link.target === '_blank' ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        link.hasAttribute('download')
      )
        return;
      const url = new URL(link.href);
      if (
        url.origin !== location.origin ||
        (url.pathname === location.pathname && url.search === location.search)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      destination.current = url.pathname + url.search + url.hash;
      setLeaving(true);
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', interceptLink, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', interceptLink, true);
    };
  }, []);
  function updateDraft(key: string, changes: Partial<DraftItem>) {
    setDrafts((items) =>
      items.map((item) => (item.key === key ? { ...item, ...changes } : item)),
    );
    setReview(null);
    setError('');
  }
  function metadataChanged() {
    // Controlled fields (including the serialized shipment array) render before we read the form.
    window.setTimeout(() => {
      const values = readForm();
      if (
        Object.keys(values).length < Object.keys(baseline.current ?? {}).length
      )
        return;
      const changed = changedAdminOrderFields(
        baseline.current ?? values,
        values,
      );
      const formElement = document.getElementById(
        formId,
      ) as HTMLFormElement | null;
      setMetadataChanges(
        Object.entries(changed).flatMap(([key, value]) => {
          if (key === 'shipments') {
            type ShipmentValues = {
              id: string;
              receiverName?: string;
              receiverPhone?: string;
              receiverAddress?: string;
              expressCode?: string;
            };
            const beforeRows = JSON.parse(
              baseline.current?.shipments ?? '[]',
            ) as ShipmentValues[];
            const afterRows = JSON.parse(value) as ShipmentValues[];
            const labels = {
              receiverName: '收件人',
              receiverPhone: '收货电话',
              receiverAddress: '收货地址',
              expressCode: '快递代码',
            };
            return afterRows.flatMap((row, index) => {
              const old = beforeRows.find(
                (candidate) => candidate.id === row.id,
              );
              return (
                Object.keys(labels) as Array<keyof typeof labels>
              ).flatMap((field) =>
                (old?.[field] ?? '') === (row[field] ?? '')
                  ? []
                  : [
                      {
                        label: `第 ${index + 1} 票 · ${labels[field]}`,
                        before: old?.[field] || '未填写',
                        after: row[field] || '未填写',
                      },
                    ],
              );
            });
          }
          const before = baseline.current?.[key] ?? '';
          const display = (entry: string) =>
            key === 'isUrgent'
              ? entry === 'true' || entry === 'on'
                ? '急单'
                : '普通'
              : entry || '未填写';
          if (key === 'externalSalesUserId') {
            const select = formElement?.elements.namedItem(
              key,
            ) as HTMLSelectElement | null;
            const account = (id: string) =>
              [...(select?.options ?? [])].find((option) => option.value === id)
                ?.text ?? '未关联';
            return [
              {
                label: fieldNames[key],
                before: account(before),
                after: account(value),
              },
            ];
          }
          return [
            {
              label: fieldNames[key] ?? key,
              before: display(before),
              after: display(value),
            },
          ];
        }),
      );
      setReview(null);
      setError('');
    }, 0);
  }
  function preview(data: FormData) {
    const changed = changedAdminOrderFields(
      baseline.current ?? {},
      formValues(data),
    );
    const fields: AdminOrderEditInput['fields'] = {
      promisedDate: undefined,
      isUrgent: undefined,
      ...changed,
      expectedEditVersion: String(props.form.expectedEditVersion),
    };
    if (typeof fields.shipments === 'string')
      fields.shipments = JSON.parse(fields.shipments);
    const input: AdminOrderEditInput = {
      orderId: props.orderId,
      requestId: crypto.randomUUID(),
      expectedRevision: props.revision,
      expectedWorkOrderVersion: props.workOrderVersion,
      fields,
      items: itemChanges,
      ...(date !== (props.form.initial.promisedDate ?? '')
        ? { promisedDate: date || null }
        : {}),
    };
    setError('');
    startTransition(async () => {
      try {
        const result = await previewAdminOrderEditAction(input);
        if (result.status === 'error') {
          setError(result.message);
          return;
        }
        if (result.status === 'preview') {
          setPayload(input);
          setReview(result.preview);
          setChargeDrafts(
            Object.fromEntries(
              (result.preview.pendingCharges ?? []).map((charge) => [
                charge.businessKey,
                { amount: charge.amount ?? '', reason: charge.reason ?? '' },
              ]),
            ),
          );
        }
      } catch {
        setError('预览未完成，请检查网络后重试；尚未保存修改。');
      }
    });
  }
  const chargeBuild = buildOrderChangePendingChargeResolutions(
    review?.pendingCharges ?? [],
    chargeDrafts,
  );
  const chargesMatchPreview =
    chargeBuild.missing.length === 0 &&
    JSON.stringify(chargeBuild.resolutions) ===
      JSON.stringify(payload?.pendingChargeResolutions ?? []);
  function repriceCharges() {
    if (!payload || chargeBuild.missing.length) return;
    const next = {
      ...payload,
      pendingChargeResolutions: chargeBuild.resolutions,
    };
    setError('');
    startTransition(async () => {
      try {
        const result = await previewAdminOrderEditAction(next);
        if (result.status === 'error') {
          setError(result.message);
          return;
        }
        if (result.status === 'preview') {
          setPayload(next);
          setReview(result.preview);
        }
      } catch {
        setError('重新核价未完成，请稍后重试。');
      }
    });
  }
  function save() {
    if (!payload || !review || !chargesMatchPreview) return;
    startTransition(async () => {
      try {
        const result = await saveAdminOrderEditAction({
          ...payload,
          expectedQuoteToken: review.quoteToken,
          expectedPriceRevision: review.priceRevision,
        });
        if (result.status === 'error') {
          setError(result.message);
          setReview(null);
          return;
        }
        if (result.status === 'saved') {
          dirtyRef.current = false;
          router.push(`/orders/${props.orderId}`);
          router.refresh();
        }
      } catch {
        setError('保存结果未确认，请刷新核对工单后再操作。');
        setReview(null);
      }
    });
  }
  const locked = !ready || pending || Boolean(props.form.blocked);
  return (
    <div className="mx-auto min-w-0 max-w-[880px] space-y-4 pb-8 [&_[data-slot=card]]:gap-3 [&_[data-slot=card]]:shadow-none [&_button]:min-h-11 [&_input:not([type=hidden])]:min-h-11 [&_select]:min-h-11">
      <header className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-1 py-3 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-label="返回工单"
            onClick={() => {
              destination.current = `/orders/${props.orderId}`;
              if (dirty) setLeaving(true);
              else router.push(destination.current);
            }}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">编辑工单</h1>
            <p className="break-all font-mono text-xs text-muted-foreground">
              {props.orderNo} · v{props.revision}
            </p>
          </div>
          <OrderStatusBadge status={props.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {dirty ? `已改 ${differences.length} 处` : '未修改'}
          </span>
          <Button
            variant="outline"
            disabled={!dirty || locked}
            onClick={() => {
              destination.current = `/orders/${props.orderId}`;
              setLeaving(true);
            }}
          >
            放弃
          </Button>
          <Button type="submit" form={formId} disabled={!dirty || locked}>
            <Save className="size-4" />
            {pending ? '处理中…' : '保存修改…'}
          </Button>
        </div>
      </header>
      {props.pendingNotice}
      {error ? (
        <ActionNotice tone="error" title="未完成保存" description={error} />
      ) : null}
      <Card id="edit-items">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b pb-3">
          <h2 className="text-sm font-semibold">款式 · {drafts.length} 款</h2>
          <span className="text-xs text-muted-foreground">
            总量{' '}
            {drafts
              .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
              .toLocaleString('zh-CN')}{' '}
            个
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          {props.productionLocked ? (
            <p className="text-sm text-muted-foreground">
              已有生产记录的款式保持锁定。生产变更请通过工单详情的修改申请处理。
            </p>
          ) : null}
          {!drafts.length ? (
            <ActionNotice
              tone="warning"
              title="未记录款式"
              description="这张历史工单缺少创建时的款式和分袋记录，无法还原生产报价。请核对原始资料后新建完整工单。"
            />
          ) : null}
          {drafts.map((draft, index) => {
            const source = props.items.find(
              (item) => item.id === draft.sourceId,
            )!;
            const stylesLocked =
              locked ||
              !props.canModify ||
              (props.productionLocked && !draft.added);
            const original = initialDraft(source);
            const changed =
              draft.added || JSON.stringify(draft) !== JSON.stringify(original);
            const options = listOrderChangeSpecificationOptions({
              sourceItem: source,
              products: props.products,
            });
            return (
              <section
                key={draft.key}
                className="min-w-0 space-y-4 rounded-xl border p-3 sm:p-4"
                aria-label={`第 ${index + 1} 款`}
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs text-background">
                    {index + 1}
                  </span>
                  <Input
                    aria-label={`第 ${index + 1} 款名称`}
                    value={draft.name}
                    maxLength={64}
                    disabled={stylesLocked}
                    onChange={(event) =>
                      updateDraft(draft.key, { name: event.target.value })
                    }
                    className="min-w-0 flex-1 font-medium"
                  />
                  {changed ? (
                    <span className="shrink-0 rounded border px-2 py-1 text-xs">
                      {draft.added ? '新增' : '已改'}
                    </span>
                  ) : null}
                  {changed ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0"
                      disabled={locked}
                      aria-label={
                        draft.added ? '移除新增款式' : `还原第 ${index + 1} 款`
                      }
                      onClick={() =>
                        setDrafts((items) =>
                          draft.added
                            ? items.filter((item) => item.key !== draft.key)
                            : items.map((item) =>
                                item.key === draft.key ? original : item,
                              ),
                        )
                      }
                    >
                      {draft.added ? (
                        <X className="size-4" />
                      ) : (
                        <RotateCcw className="size-4" />
                      )}
                    </Button>
                  ) : null}
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <EditorField label="工艺">
                    <div className="flex min-h-11 items-center rounded-md border bg-muted/30 px-3 text-sm">
                      {ORDER_PRICING_ROUTE_LABELS[source.pricingRoute]}
                    </div>
                  </EditorField>
                  <EditorField label="纸张">
                    <div className="flex min-h-11 items-center rounded-md border bg-muted/30 px-3 text-sm">
                      {source.paperType
                        ? externalPriceBusinessText(source.paperType)
                        : '未记录'}{' '}
                      {source.paperWeightGsm &&
                      !new RegExp(`${source.paperWeightGsm}\\s*g`, 'i').test(
                        source.paperType ?? '',
                      )
                        ? `${source.paperWeightGsm}g`
                        : ''}
                    </div>
                  </EditorField>
                  <EditorField
                    label="规格"
                    htmlFor={`spec-${draft.key}`}
                    before={
                      draft.specification !== original.specification
                        ? externalPriceBusinessText(original.specification)
                        : undefined
                    }
                  >
                    <select
                      id={`spec-${draft.key}`}
                      value={
                        options.find(
                          (option) =>
                            option.productId === draft.productId &&
                            option.specification === draft.specification,
                        )?.selectionKey ?? ''
                      }
                      disabled={stylesLocked || !options.length}
                      onChange={(event) => {
                        const option = options.find(
                          (item) => item.selectionKey === event.target.value,
                        );
                        if (option)
                          updateDraft(draft.key, {
                            productId: option.productId,
                            specification: option.specification,
                          });
                      }}
                      className="min-h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
                    >
                      {!options.some(
                        (option) =>
                          option.productId === draft.productId &&
                          option.specification === draft.specification,
                      ) ? (
                        <option value="">
                          {externalPriceBusinessText(draft.specification) ||
                            '未记录'}
                        </option>
                      ) : null}
                      {options.map((option) => (
                        <option
                          key={option.selectionKey}
                          value={option.selectionKey}
                        >
                          {externalPriceBusinessText(option.specification)}
                        </option>
                      ))}
                    </select>
                  </EditorField>
                  <EditorField
                    label="数量（个）"
                    htmlFor={`qty-${draft.key}`}
                    before={
                      draft.quantity !== original.quantity
                        ? original.quantity
                        : undefined
                    }
                  >
                    <Input
                      id={`qty-${draft.key}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={9999999}
                      step={1}
                      value={draft.quantity}
                      disabled={stylesLocked}
                      onChange={(event) =>
                        updateDraft(draft.key, { quantity: event.target.value })
                      }
                    />
                  </EditorField>
                  <EditorField
                    label="包装（个/包）"
                    htmlFor={`pack-${draft.key}`}
                    before={
                      draft.pack !== original.pack ? original.pack : undefined
                    }
                  >
                    <Input
                      id={`pack-${draft.key}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={9999999}
                      step={1}
                      value={draft.pack}
                      placeholder="未记录"
                      disabled={
                        stylesLocked || !source.packagingEditable || draft.added
                      }
                      onChange={(event) =>
                        updateDraft(draft.key, { pack: event.target.value })
                      }
                    />
                  </EditorField>
                  <EditorField label="正面烫金" htmlFor={`front-${draft.key}`}>
                    <Input
                      id={`front-${draft.key}`}
                      value={draft.front}
                      disabled={
                        stylesLocked || source.pricingRoute === 'COLOR_PRINT'
                      }
                      placeholder="多个颜色用顿号分隔"
                      onChange={(event) =>
                        updateDraft(draft.key, { front: event.target.value })
                      }
                    />
                  </EditorField>
                  <EditorField label="反面烫金" htmlFor={`back-${draft.key}`}>
                    <Input
                      id={`back-${draft.key}`}
                      value={draft.back}
                      disabled={
                        stylesLocked || source.pricingRoute === 'COLOR_PRINT'
                      }
                      placeholder="无反面烫金可留空"
                      onChange={(event) =>
                        updateDraft(draft.key, { back: event.target.value })
                      }
                    />
                  </EditorField>
                </div>
                {draft.pack && Number(draft.pack) > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    每包 {draft.pack} 个；袋数与入袋费按已保存的常规装 /
                    混装组成自动重算。
                  </p>
                ) : null}
                {!draft.added ? (
                  <Disclosure>
                    <DisclosureSummary className="text-sm">
                      设计图{' '}
                      {
                        source.designs.filter(
                          (design) => design.fileType === 'IMAGE',
                        ).length
                      }{' '}
                      · CDR{' '}
                      {
                        source.designs.filter(
                          (design) => design.fileType === 'CDR',
                        ).length
                      }{' '}
                      · 查看 / 管理文件
                    </DisclosureSummary>
                    <DesignUploadPanel
                      orderId={props.orderId}
                      orderItemId={source.id}
                      designs={source.designs}
                      canEdit={props.canEditDesigns && !dirty && !pending}
                    />
                  </Disclosure>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    保存新增款式后上传该款设计文件。
                  </p>
                )}
                {!draft.added && source.details ? (
                  <Disclosure>
                    <DisclosureSummary className="text-sm">
                      更多生产信息
                    </DisclosureSummary>
                    {source.details}
                  </Disclosure>
                ) : null}
                <div className="border-t pt-3 text-right text-sm">
                  <span className="mr-2 text-muted-foreground">
                    {changed ? '修改前加工费' : '本款加工费'}
                  </span>
                  <span className="font-medium tabular-nums">
                    {draft.added ? '保存前自动核价' : money(source.subtotal)}
                  </span>
                </div>
              </section>
            );
          })}
          {props.canAdd && props.items.length ? (
            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed"
              disabled={locked || drafts.length >= 50}
              onClick={() => {
                const source = props.items[0];
                setDrafts((items) => [
                  ...items,
                  {
                    ...initialDraft(source),
                    key: crypto.randomUUID(),
                    added: true,
                    name: '',
                  },
                ]);
              }}
            >
              <Plus className="size-4" />
              新增款式（沿用第 1 款工艺和纸张）
            </Button>
          ) : null}
          {props.items.length > 0 && !props.productionLocked ? (
            <p className="text-xs text-muted-foreground">
              工艺、纸张和已有款式的删除会改变生产基础，当前通过新建工单处理；规格、数量、烫金及已有分袋数量可在此修改。
            </p>
          ) : null}
        </CardContent>
      </Card>
      <EditOrderForm
        {...props.form}
        designLayout
        designFields={
          <EditorField label="承诺交期" htmlFor="admin-promised-date">
            <Input
              id="admin-promised-date"
              type="date"
              value={date}
              disabled={locked || !props.canModify}
              onChange={(event) => {
                setDate(event.target.value);
                setReview(null);
              }}
            />
          </EditorField>
        }
        formId={formId}
        onFormChange={metadataChanged}
        onReview={preview}
        blocked={locked}
      />
      <section aria-label="费用核对" className="space-y-3">
        {dirty ? (
          <p className="text-xs text-muted-foreground">
            请先保存当前修改，再核定人工费用或维护制版明细。
          </p>
        ) : null}
        <fieldset disabled={dirty || pending} className="min-w-0 space-y-3">
          {props.fees}
        </fieldset>
      </section>
      <Dialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setReview(null);
        }}
      >
        <DialogContent className="max-w-[620px] [&_button]:min-h-11 [&_input]:min-h-11">
          <DialogHeader>
            <DialogTitle>确认保存修改</DialogTitle>
            <DialogDescription>
              请核对以下 {differences.length}{' '}
              处修改。所有资料与款式变更将一起保存。
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y">
            {differences.map((diff, index) => (
              <li key={index} className="space-y-1 py-3">
                <p className="text-sm font-medium">{diff.label}</p>
                <div className="grid min-w-0 grid-cols-[1fr_auto_1fr] items-start gap-3 text-sm">
                  <span className="break-words text-muted-foreground [overflow-wrap:anywhere]">
                    {diff.before || '未填写'}
                  </span>
                  <span aria-label="修改为">→</span>
                  <span className="break-words [overflow-wrap:anywhere]">
                    {diff.after || '未填写'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {review ? (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="flex flex-wrap justify-between gap-3 text-sm">
                <span>当前金额 {money(review.oldTotal)}</span>
                <strong>保存后 {money(review.newTotal)}</strong>
              </div>
              <p className="text-xs text-muted-foreground">
                {review.changesRevision
                  ? '保存后更新工单版本，并保留修改记录与原报价快照。'
                  : '本次仅修改资料，保留当前工单版本与费用。'}
              </p>
              {review.blockers.map((text, index) => (
                <p key={index} className="text-sm text-destructive">
                  {text}
                </p>
              ))}
            </div>
          ) : null}
          {review?.pendingCharges?.length ? (
            <div className="space-y-3">
              <OrderChangePendingChargeEditor
                charges={review.pendingCharges}
                drafts={chargeDrafts}
                disabled={pending}
                onChange={(key, field, value) =>
                  setChargeDrafts((drafts) => ({
                    ...drafts,
                    [key]: {
                      ...(drafts[key] ?? { amount: '', reason: '' }),
                      [field]: value,
                    },
                  }))
                }
              />
              <Button
                variant="outline"
                disabled={pending || chargeBuild.missing.length > 0}
                onClick={repriceCharges}
              >
                补齐运费并重新核价
              </Button>
            </div>
          ) : null}
          {error ? (
            <ActionNotice
              tone="error"
              title="请检查本次修改"
              description={error}
            />
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setReview(null)}
            >
              再改改
            </Button>
            <Button
              disabled={pending || !review?.complete || !chargesMatchPreview}
              onClick={save}
            >
              {pending ? '保存中…' : '确认保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={leaving} onOpenChange={setLeaving}>
        <DialogContent className="[&_button]:min-h-11">
          <DialogHeader>
            <DialogTitle>放弃未保存的修改？</DialogTitle>
            <DialogDescription>
              本次填写尚未保存，离开后将丢失。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaving(false)}>
              继续编辑
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                dirtyRef.current = false;
                router.push(destination.current);
              }}
            >
              放弃并离开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function EditorField({
  label,
  htmlFor,
  before,
  children,
}: {
  label: string;
  htmlFor?: string;
  before?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {before !== undefined ? (
        <p className="break-words text-xs text-muted-foreground">
          原：{before || '未填写'}
        </p>
      ) : null}
    </div>
  );
}
