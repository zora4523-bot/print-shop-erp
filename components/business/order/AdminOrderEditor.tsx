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
import Link from 'next/link';
import {
  ArrowLeft,
  FileImage,
  FileType,
  Plus,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import styles from './AdminOrderEditor.module.css';
import { useAdminOrderLeaveGuard } from './use-admin-order-leave-guard';
import {
  OrderEditorAuxiliaryContext,
  useOrderEditorAuxiliaryController,
} from './use-order-editor-auxiliary';
import { OrderFoilColorPicker } from './OrderFoilColorPicker';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
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
  foilColors?: string[];
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
  const surfaceRef = useRef<HTMLDivElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const fileButtonRef = useRef<HTMLButtonElement | null>(null);
  const detailsButtonRef = useRef<HTMLButtonElement | null>(null);
  const [filesFor, setFilesFor] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const addTemplate = props.items.find(
    (item) => item.pricingRoute !== 'MANUAL_QUOTE',
  );
  const fileItem = props.items.find((item) => item.id === filesFor);
  const detailItem = props.items.find((item) => item.id === detailsFor);
  const formId = 'admin-order-edit-form';
  useEffect(() => {
    const surface = surfaceRef.current;
    const shell = surface?.closest('main');
    const header = shell?.querySelector<HTMLElement>(':scope > header');
    if (!surface || !header) return;
    const update = () =>
      surface.style.setProperty(
        '--editor-header-offset',
        `${header.getBoundingClientRect().height}px`,
      );
    const observer = new ResizeObserver(update);
    observer.observe(header);
    update();
    return () => observer.disconnect();
  }, []);
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
  const pendingNavigation = useRef<(() => void) | null>(null);
  const destination = useRef(`/orders/${props.orderId}`);
  const readForm = () => {
    const element = document.getElementById(formId) as HTMLFormElement | null;
    return element ? formValues(new FormData(element)) : {};
  };
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
  const auxiliary = useOrderEditorAuxiliaryController(
    !ready || dirty || pending || fileBusy || Boolean(props.form.blocked),
  );
  const { allowNavigation } = useAdminOrderLeaveGuard({
    protectedLeave: dirty || fileBusy || auxiliary.dirty || auxiliary.pending,
    onBlocked: (navigation) => {
      if (pending || fileBusy || auxiliary.pending) return;
      pendingNavigation.current = navigation.resume;
      setLeaving(true);
    },
  });
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
          allowNavigation();
          router.push(`/orders/${props.orderId}`);
          router.refresh();
        }
      } catch {
        setError('保存结果未确认，请刷新核对工单后再操作。');
        setReview(null);
      }
    });
  }
  const locked =
    !ready ||
    pending ||
    fileBusy ||
    auxiliary.dirty ||
    auxiliary.pending ||
    Boolean(props.form.blocked);
  useEffect(() => {
    if (!locked && baseline.current === null) baseline.current = readForm();
  }, [locked]);
  return (
    <div
      ref={surfaceRef}
      className={`${styles.surface} mx-auto min-w-0 max-w-[880px] space-y-3 pb-8 [&_[data-slot=card]]:gap-3 [&_[data-slot=card]]:shadow-none [&_button]:min-h-11 [&_input:not([type=hidden])]:min-h-11 [&_select]:min-h-11`}
    >
      <header
        aria-label="编辑工单操作"
        className={`${styles.toolbar} sticky z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 border-b bg-background px-1 py-3`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-label="返回工单"
            disabled={pending || fileBusy || auxiliary.pending}
            onClick={() => {
              destination.current = `/orders/${props.orderId}`;
              pendingNavigation.current = () =>
                router.push(destination.current);
              if (dirty || auxiliary.dirty) setLeaving(true);
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
            {auxiliary.pending
              ? '费用处理中…'
              : auxiliary.dirty
                ? '费用有未保存修改'
                : dirty
                  ? `已改 ${differences.length} 处`
                  : '未修改'}
          </span>
          <Button
            variant="outline"
            disabled={!dirty || locked}
            onClick={() => {
              destination.current = `/orders/${props.orderId}`;
              pendingNavigation.current = () =>
                router.push(destination.current);
              setLeaving(true);
            }}
          >
            放弃
          </Button>
          <Button
            ref={saveButtonRef}
            type="submit"
            form={formId}
            disabled={!dirty || locked}
          >
            <Save className="size-4" />
            {pending ? '处理中…' : '保存修改…'}
          </Button>
        </div>
      </header>
      {props.pendingNotice}
      {auxiliary.dirty ? (
        <p role="status" className="text-sm text-muted-foreground">
          请先保存或还原下方费用输入，再修改工单资料与款式。
        </p>
      ) : null}
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
            const factsLocked =
              stylesLocked || source.pricingRoute === 'MANUAL_QUOTE';
            const plainPrint =
              source.pricingRoute === 'COLOR_PRINT' &&
              source.frontFoilColors.length + source.backFoilColors.length ===
                0;
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
                className={styles.item}
                aria-label={`第 ${index + 1} 款`}
              >
                <div className={styles.itemHeader}>
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
                    className="min-w-0 flex-1 border-transparent bg-transparent px-1 font-semibold shadow-none hover:border-input focus-visible:border-input"
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
                <div className={styles.fields}>
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
                      disabled={factsLocked || !options.length}
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
                      disabled={factsLocked}
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
                        factsLocked || !source.packagingEditable || draft.added
                      }
                      onChange={(event) =>
                        updateDraft(draft.key, { pack: event.target.value })
                      }
                    />
                  </EditorField>
                  <EditorField label="正面烫金">
                    <OrderFoilColorPicker
                      label={`第 ${index + 1} 款正面烫金`}
                      allowNone={plainPrint || colors(draft.back).length > 0}
                      selected={colors(draft.front)}
                      options={[
                        ...source.frontFoilColors,
                        ...(props.foilColors ?? []),
                      ]}
                      disabled={factsLocked || plainPrint}
                      onChange={(selected) =>
                        updateDraft(draft.key, { front: selected.join('、') })
                      }
                    />
                  </EditorField>
                  <EditorField label="反面烫金">
                    <OrderFoilColorPicker
                      label={`第 ${index + 1} 款反面烫金`}
                      allowNone={plainPrint || colors(draft.front).length > 0}
                      collapsedCount={1}
                      selected={colors(draft.back)}
                      options={[
                        ...source.backFoilColors,
                        ...(props.foilColors ?? []),
                      ]}
                      disabled={factsLocked || plainPrint}
                      onChange={(selected) =>
                        updateDraft(draft.key, { back: selected.join('、') })
                      }
                    />
                  </EditorField>
                </div>
                {plainPrint ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    纯彩印不含烫金；如需新增烫金工艺，请新建对应工单。
                  </p>
                ) : null}
                {!source.packagingEditable || draft.added ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {draft.added
                      ? '新增款式暂不支持同步分袋，请核对包装安排。'
                      : '分袋记录缺失或存在多组分货，当前不能直接修改每包数量。'}
                  </p>
                ) : null}
                {source.pricingRoute === 'MANUAL_QUOTE' ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    历史人工报价款仅可修改名称；其他生产参数请核对后新建完整工单。
                  </p>
                ) : null}
                {!draft.added ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        fileButtonRef.current = event.currentTarget;
                        setFilesFor(source.id);
                      }}
                    >
                      <FileImage className="size-3.5" />
                      设计图{' '}
                      {
                        source.designs.filter(
                          (design) => design.fileType === 'IMAGE',
                        ).length
                      }
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        fileButtonRef.current = event.currentTarget;
                        setFilesFor(source.id);
                      }}
                    >
                      <FileType className="size-3.5" />
                      CDR{' '}
                      {
                        source.designs.filter(
                          (design) => design.fileType === 'CDR',
                        ).length
                      }
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    保存新增款式后上传该款设计文件。
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 border-t border-dashed pt-1 text-xs">
                  {!draft.added && source.details ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-1 text-xs text-muted-foreground"
                      onClick={(event) => {
                        detailsButtonRef.current = event.currentTarget;
                        setDetailsFor(source.id);
                      }}
                    >
                      更多生产信息
                    </Button>
                  ) : (
                    <span />
                  )}
                  <p className="ml-auto py-2 text-right">
                    <span className="mr-2 text-muted-foreground">
                      {changed ? '修改前加工费' : '本款加工费'}
                    </span>
                    <span className="font-medium tabular-nums">
                      {draft.added ? '保存前自动核价' : money(source.subtotal)}
                    </span>
                  </p>
                </div>
              </section>
            );
          })}
          {props.status === 'DRAFT' && props.canAdd && addTemplate ? (
            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed"
              disabled={locked || drafts.length >= 50}
              onClick={() => {
                const source = addTemplate;
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
              新增款式（沿用第 {addTemplate.sequence} 款工艺和纸张）
            </Button>
          ) : null}
          {props.status !== 'DRAFT' && props.canModify ? (
            <p className="text-xs text-muted-foreground">
              已提交工单的新款需要独立上传设计图与生产文件，请
              <Link
                href="/orders/new"
                className="ml-1 underline underline-offset-2"
              >
                新建完整工单
              </Link>
              。
            </p>
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
        blocked={props.form.blocked}
        busy={
          !ready || pending || fileBusy || auxiliary.dirty || auxiliary.pending
        }
      />
      <OrderEditorAuxiliaryContext.Provider value={auxiliary.context}>
        <section aria-label="费用核对" className="space-y-3">
          {dirty ? (
            <p className="text-xs text-muted-foreground">
              请先保存当前修改，再核定人工费用或维护制版明细。
            </p>
          ) : null}
          <fieldset
            disabled={
              dirty || pending || fileBusy || Boolean(props.form.blocked)
            }
            className="min-w-0 space-y-3"
          >
            {props.fees}
          </fieldset>
        </section>
      </OrderEditorAuxiliaryContext.Provider>
      <Sheet
        open={review !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setReview(null);
        }}
      >
        <SheetContent
          side="bottom"
          finalFocus={saveButtonRef}
          showCloseButton={false}
          className={`${styles.reviewSheet} [&_button]:min-h-11 [&_input]:min-h-11`}
        >
          <SheetHeader className="px-5 pt-5 pb-3">
            <SheetTitle>确认保存修改</SheetTitle>
            <SheetDescription>
              请核对以下 {differences.length}{' '}
              处修改。所有资料与款式变更将一起保存。
            </SheetDescription>
          </SheetHeader>
          <div className={styles.reviewBody}>
            <ul className="divide-y">
              {differences.map((diff, index) => (
                <li key={index} className="space-y-1 py-2">
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
                    ? `工单版本 v${props.revision} → v${props.revision + 1}，保留修改记录与原报价快照。`
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
          </div>
          <SheetFooter className="grid grid-cols-2 border-t px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
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
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <Dialog
        open={Boolean(fileItem)}
        onOpenChange={(open) => {
          if (!open && !fileBusy) setFilesFor(null);
        }}
      >
        <DialogContent finalFocus={fileButtonRef} showCloseButton={!fileBusy}>
          <DialogHeader>
            <DialogTitle>第 {fileItem?.sequence} 款设计文件</DialogTitle>
            <DialogDescription>
              {dirty || auxiliary.dirty
                ? '请先保存或还原当前修改，再上传或删除文件。'
                : props.canEditDesigns
                  ? '上传与删除立即保存到该款式。'
                  : '当前工单阶段仅可查看已有文件。'}
            </DialogDescription>
          </DialogHeader>
          {fileItem ? (
            <DesignUploadPanel
              orderId={props.orderId}
              orderItemId={fileItem.id}
              designs={fileItem.designs}
              canEdit={
                props.canEditDesigns &&
                !dirty &&
                !pending &&
                !auxiliary.dirty &&
                !auxiliary.pending
              }
              onBusyChange={setFileBusy}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(detailItem)}
        onOpenChange={(open) => {
          if (!open) setDetailsFor(null);
        }}
      >
        <DialogContent finalFocus={detailsButtonRef}>
          <DialogHeader>
            <DialogTitle>第 {detailItem?.sequence} 款生产信息</DialogTitle>
            <DialogDescription>已保存的工艺与生产事实</DialogDescription>
          </DialogHeader>
          {detailItem?.details}
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
                allowNavigation();
                pendingNavigation.current?.();
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
