'use client';

import { foilColorInputLabel, restoreFoilColorInput } from '@/lib/order/foil-colors';

import {
  useActionState,
  useMemo,
  useState,
  useTransition,
} from 'react';
import type { FormEvent } from 'react';
import type { OrderItemPricingRoute } from '@/generated/prisma/enums';
import { createOrderChangeRequestAction } from '@/actions/order';
import type { CreateOrderChangeRequestMutationResult } from '@/actions/order.types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { resolveOrderItemFoilSides } from '@/lib/order/pricing-route';
import {
  listOrderChangeSpecificationOptions,
  type OrderChangeCatalogProduct,
} from '@/lib/order/change-request-catalog-identity';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

type ItemOption = {
  id: string;
  sequence: number;
  name: string;
  quantity: number;
  pack?: number | null;
  packagingEditable?: boolean;
  productId: string | null;
  pricingRoute: OrderItemPricingRoute;
  specification: string | null;
  paperType: string | null;
  paperWeightGsm: number | null;
  frontFoilColors?: string[];
  backFoilColors?: string[];
  foilColors: string[];
  isDoubleSided?: boolean;
};

type EditableItem = {
  selected: boolean;
  /** Submitted value; keep the imported matcher text until the user edits it. */
  name: string;
  displayName: string;
  quantity: number;
  pack: string;
  targetProductId: string | null;
  specification: string;
  specificationSelectionKey: string;
  displaySpecification: string;
  frontFoilColors: string;
  backFoilColors: string;
};

type OrderItemChangePayload =
  | {
      operation: 'UPDATE';
      itemId: string;
      pack?: number;
      name: string;
      quantity: number;
      targetProductId?: string;
      targetBlankIdentity?: { paperType: string; paperWeightGsm: number; specification: string };
      specification?: string;
      frontFoilColors: string[];
      backFoilColors: string[];
    }
  | {
      operation: 'ADD';
      templateItemId: string;
      name: string;
      quantity: number;
      targetProductId?: string;
      targetBlankIdentity?: { paperType: string; paperWeightGsm: number; specification: string };
      specification?: string;
      frontFoilColors: string[];
      backFoilColors: string[];
    };

type Props = {
  orderId: string;
  expectedRevision: number;
  expectedWorkOrderVersion: number;
  items: ItemOption[];
  catalogProducts: OrderChangeCatalogProduct[];
  promisedDate?: string | null;
  hasPackagingGroups?: boolean;
  /** Catalog foil names; protects typed catalog names from the display-label reverse map. */
  foilColorNames?: readonly string[];
  /** 已有地址发货：只能申请修改交期，不提供款式 / 数量修改（服务端同样拒绝）。 */
  dueDateOnly?: boolean;
};

export function orderChangeRequestDraftIdentity({
  orderId,
  expectedRevision,
  expectedWorkOrderVersion,
  items,
  catalogProducts,
  promisedDate = null,
  hasPackagingGroups = false,
  dueDateOnly = false,
}: Pick<
  Props,
  | 'orderId'
  | 'expectedRevision'
  | 'expectedWorkOrderVersion'
  | 'items'
  | 'catalogProducts'
  | 'promisedDate'
  | 'hasPackagingGroups'
  | 'dueDateOnly'
>): string {
  const catalogFacts = catalogProducts
    .map((product) => ({
      id: product.id,
      category: product.category,
      specification: product.specification,
      paperType: product.paperType,
      weight: product.weight,
      isActive: product.isActive,
      paperMaterialId: product.paperMaterialId ?? null,
      linkedPaper: product.linkedPaper
        ? {
            isActive: product.linkedPaper.isActive,
            outOfStock: product.linkedPaper.outOfStock,
          }
        : null,
    }))
    .sort((left, right) => {
      const leftKey = JSON.stringify(left);
      const rightKey = JSON.stringify(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });

  return JSON.stringify({
    orderId,
    expectedRevision,
    expectedWorkOrderVersion,
    promisedDate,
    hasPackagingGroups,
    dueDateOnly,
    items: items.map((item) => ({
      id: item.id,
      sequence: item.sequence,
      name: item.name,
      quantity: item.quantity,
      pack: item.pack ?? null,
      packagingEditable: item.packagingEditable ?? false,
      productId: item.productId,
      pricingRoute: item.pricingRoute,
      specification: item.specification,
      paperType: item.paperType,
      paperWeightGsm: item.paperWeightGsm,
      frontFoilColors: item.frontFoilColors ?? [],
      backFoilColors: item.backFoilColors ?? [],
      foilColors: item.foilColors,
      isDoubleSided: item.isDoubleSided ?? false,
    })),
    catalogProducts: catalogFacts,
  });
}

const MODIFY_KINDS = [
  ['QTY', '数量'],
  ['DUE_DATE', '交期'],
  ['CRAFT_PAPER', '工艺 / 纸张'],
  ['OTHER', '其他'],
] as const;

type ModifyKind = (typeof MODIFY_KINDS)[number][0];

export function buildOrderChangeRequestPayload({
  orderId,
  expectedRevision,
  expectedWorkOrderVersion,
  modifyKind,
  reason,
  items,
  promisedDate,
}: {
  orderId: string;
  expectedRevision: number;
  expectedWorkOrderVersion: number;
  modifyKind: ModifyKind;
  reason: string;
  items: OrderItemChangePayload[];
  promisedDate?: string | null;
}) {
  return {
    orderId,
    expectedRevision,
    expectedWorkOrderVersion,
    ...(promisedDate !== undefined ? { promisedDate } : {}),
    type: 'MODIFY' as const,
    modifyKind,
    reason,
    items,
  };
}

function splitColors(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，、]/)
        .map((color) => color.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Every identity the user could legitimately type: catalog foils plus any
 * color already on this order. See restoreFoilColorInput.
 */
export function knownOrderFoilColors(
  foilColorNames: readonly string[],
  items: readonly Pick<ItemOption, 'frontFoilColors' | 'backFoilColors' | 'foilColors'>[],
): string[] {
  return [...new Set([
    ...foilColorNames,
    ...items.flatMap((entry) => [...(entry.frontFoilColors ?? []), ...(entry.backFoilColors ?? []), ...entry.foilColors]),
  ])];
}

/** An added item has no saved colors, so typed display names resolve to catalog names. */
export function addedItemFoilColors(text: string, known: readonly string[]): string[] {
  return splitColors(restoreFoilColorInput(text, [], known));
}

function hasSameColorSet(left: readonly string[], right: readonly string[]) {
  const normalizedLeft = new Set(
    left.map((color) => color.trim()).filter(Boolean),
  );
  const normalizedRight = new Set(
    right.map((color) => color.trim()).filter(Boolean),
  );
  return (
    normalizedLeft.size === normalizedRight.size &&
    [...normalizedLeft].every((color) => normalizedRight.has(color))
  );
}

export function createOrderChangeEditableItem(
  item: ItemOption,
  catalogProducts: readonly OrderChangeCatalogProduct[] = [],
): EditableItem {
  const specification = item.specification ?? '';
  const foilSides = resolveOrderItemFoilSides(item);
  const currentOption = listOrderChangeSpecificationOptions({
    sourceItem: item,
    products: catalogProducts,
  }).find(
    (option) =>
      option.productId === item.productId &&
      option.specification === specification,
  );
  return {
    selected: false,
    name: item.name,
    displayName: externalPriceBusinessText(item.name),
    quantity: item.quantity,
    pack: item.pack == null ? '' : String(item.pack),
    targetProductId: item.productId,
    specification,
    specificationSelectionKey: currentOption?.selectionKey ?? '',
    displaySpecification: specification
      ? externalPriceBusinessText(specification)
      : '',
    frontFoilColors: foilSides.frontFoilColors.join('、'),
    backFoilColors: foilSides.backFoilColors.join('、'),
  };
}

export function hasOrderItemSemanticChange(
  item: ItemOption,
  editableItem: EditableItem,
): boolean {
  const foilSides = resolveOrderItemFoilSides(item);
  return (
    editableItem.name.trim() !== item.name.trim() ||
    editableItem.quantity !== item.quantity ||
    (Boolean(item.packagingEditable) && editableItem.pack !== (item.pack == null ? '' : String(item.pack))) ||
    editableItem.targetProductId !== item.productId ||
    editableItem.specification !== (item.specification ?? '') ||
    !hasSameColorSet(
      splitColors(editableItem.frontFoilColors),
      foilSides.frontFoilColors,
    ) ||
    !hasSameColorSet(
      splitColors(editableItem.backFoilColors),
      foilSides.backFoilColors,
    )
  );
}

export function buildSelectedOrderItemChanges(
  items: ItemOption[],
  editable: Record<string, EditableItem>,
): OrderItemChangePayload[] {
  return items.flatMap((item) => {
    const current = editable[item.id];
    if (
      !current?.selected ||
      !hasOrderItemSemanticChange(item, current)
    ) {
      return [];
    }
    const specificationChanged =
      current.targetProductId !== item.productId ||
      current.specification !== (item.specification ?? '');
    const targetProductId = current.targetProductId;
    if (
      specificationChanged &&
      ((!targetProductId && item.pricingRoute !== 'STOCK_BLANK') || !current.specification.trim())
    ) {
      return [];
    }
    return [
      {
        operation: 'UPDATE' as const,
        itemId: item.id,
        name: current.name,
        quantity: current.quantity,
        ...(item.packagingEditable && current.pack !== (item.pack == null ? '' : String(item.pack))
          ? { pack: Number(current.pack) } : {}),
        ...(specificationChanged && item.pricingRoute === 'STOCK_BLANK'
          ? { targetBlankIdentity: { paperType: item.paperType ?? '', paperWeightGsm: item.paperWeightGsm ?? 0, specification: current.specification } }
          : specificationChanged && targetProductId ? {
              targetProductId,
              specification: current.specification,
            }
          : {}),
        frontFoilColors: splitColors(current.frontFoilColors),
        backFoilColors: splitColors(current.backFoilColors),
      },
    ];
  });
}

function StateMessage({
  state,
}: {
  state: CreateOrderChangeRequestMutationResult | null;
}) {
  if (!state || state.status === 'success') return null;
  const message =
    state.status === 'error'
      ? state.message
      : Object.values(state.fieldErrors).flat()[0] ?? '请检查申请内容';
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

function ExistingOrderItemChanges({
  catalogProducts,
  editable,
  items,
  pending,
  updateItem,
  foilColorNames = [],
}: {
  catalogProducts: readonly OrderChangeCatalogProduct[];
  editable: Record<string, EditableItem>;
  items: ItemOption[];
  pending: boolean;
  updateItem: (itemId: string, patch: Partial<EditableItem>) => void;
  foilColorNames?: readonly string[];
}) {
  const knownFoilColors = knownOrderFoilColors(foilColorNames, items);
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="sr-only">选择并修改现有款式</legend>
      {items.map((item) => {
        const current = editable[item.id];
        const specificationOptions = listOrderChangeSpecificationOptions({
          sourceItem: item,
          products: catalogProducts,
        });
        const sourceHasCatalogOption = specificationOptions.some(
          (option) =>
            option.productId === item.productId &&
            option.specification === (item.specification ?? ''),
        );
        return (
          <div key={item.id} className="min-w-0 rounded-lg border p-3">
            <label className="flex min-h-11 min-w-0 cursor-pointer items-start gap-1 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-muted-foreground">
              <Checkbox
                className="-ml-3"
                checked={current.selected}
                disabled={pending}
                aria-label={`选择款式 ${item.sequence}：${externalPriceBusinessText(item.name)}`}
                onCheckedChange={(checked) =>
                  updateItem(item.id, { selected: checked })
                }
              />
              <span className="admin-wrap-anywhere min-w-0 pt-3 leading-5 font-medium">
                #{item.sequence} · {externalPriceBusinessText(item.name)}
              </span>
            </label>
            {current.selected ? (
              <div className="grid min-w-0 grid-cols-1 gap-3 border-t pt-3 lg:grid-cols-2">
                <label className="min-w-0 space-y-1 text-sm">
                  <span>款式名称</span>
                  <Input
                    value={current.displayName}
                    maxLength={64}
                    required
                    disabled={pending}
                    onChange={(event) =>
                      updateItem(item.id, {
                        name: event.target.value,
                        displayName: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="min-w-0 space-y-1 text-sm">
                  <span>数量</span>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={current.quantity}
                    required
                    disabled={pending}
                    onChange={(event) =>
                      updateItem(item.id, {
                        quantity: Number(event.target.value),
                      })
                    }
                  />
                </label>
                {item.packagingEditable ? (
                  <label className="min-w-0 space-y-1 text-sm">
                    <span>每袋数量</span>
                    <Input type="number" min={1} max={9999999} step={1}
                      required value={current.pack} disabled={pending}
                      onChange={(event) => updateItem(item.id, { pack: event.target.value })} />
                  </label>
                ) : null}
                <label className="min-w-0 space-y-1 text-sm">
                  <span>规格</span>
                  <NativeSelect
                    value={current.specificationSelectionKey}
                    disabled={pending || specificationOptions.length === 0}
                    onChange={(event) => {
                      const selected = specificationOptions.find(
                        (option) => option.selectionKey === event.target.value,
                      );
                      if (!selected) {
                        updateItem(item.id, {
                          targetProductId: item.productId,
                          specification: item.specification ?? '',
                          specificationSelectionKey: '',
                          displaySpecification: item.specification
                            ? externalPriceBusinessText(item.specification)
                            : '',
                        });
                        return;
                      }
                      updateItem(item.id, {
                        targetProductId: selected.productId,
                        specification: selected.specification,
                        specificationSelectionKey: selected.selectionKey,
                        displaySpecification: externalPriceBusinessText(
                          selected.specification,
                        ),
                      });
                    }}
                    className="w-full min-w-0"
                  >
                    {!sourceHasCatalogOption ? (
                      <option value="">
                        {current.specificationSelectionKey
                          ? '选择目录规格'
                          : current.displaySpecification || '原规格'}
                      </option>
                    ) : null}
                    {specificationOptions.map((option) => (
                      <option
                        key={option.selectionKey}
                        value={option.selectionKey}
                      >
                        {externalPriceBusinessText(option.specification)}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="min-w-0 space-y-1 text-sm">
                  <span>正面烫金颜色（多个用顿号分隔）</span>
                  <Input
                    value={foilColorInputLabel(current.frontFoilColors, knownFoilColors)}
                    maxLength={200}
                    disabled={pending}
                    onChange={(event) =>
                      updateItem(item.id, {
                        frontFoilColors: restoreFoilColorInput(event.target.value, item.frontFoilColors ?? item.foilColors, knownFoilColors),
                      })
                    }
                  />
                </label>
                <label className="min-w-0 space-y-1 text-sm">
                  <span>反面烫金颜色（多个用顿号分隔）</span>
                  <Input
                    value={foilColorInputLabel(current.backFoilColors, knownFoilColors)}
                    maxLength={200}
                    disabled={pending}
                    onChange={(event) =>
                      updateItem(item.id, {
                        backFoilColors: restoreFoilColorInput(event.target.value, item.backFoilColors ?? item.foilColors, knownFoilColors),
                      })
                    }
                  />
                </label>
              </div>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}

export function OrderChangeRequestForm(props: Props) {
  return (
    <OrderChangeRequestDraftForm
      key={orderChangeRequestDraftIdentity(props)}
      {...props}
    />
  );
}

function OrderChangeReasonFields({ modifyKind, setModifyKind, reason, setReason, pending, dueDate, setDueDate, hasItems }: {
  hasItems: boolean;
  dueDate: string;
  setDueDate: (value: string) => void;
  modifyKind: ModifyKind;
  setModifyKind: (value: ModifyKind) => void;
  reason: string;
  setReason: (value: string) => void;
  pending: boolean;
}) {
  return (
    <>
      <label className="block min-w-0 space-y-1 text-sm">
        <span className="font-medium">修改类别</span>
        <NativeSelect
          value={modifyKind}
          onChange={(event) =>
            setModifyKind(event.target.value as typeof modifyKind)
          }
          disabled={pending}
          className="w-full"
        >
          {MODIFY_KINDS.filter(([value]) => hasItems || value === 'DUE_DATE').map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
        <span className="block text-xs text-muted-foreground">
          选择交期时填写新的承诺交期；收货地址通过工单资料编辑修改。
        </span>
      </label>

      {modifyKind === 'DUE_DATE' ? <label className="block min-w-0 space-y-1 text-sm">
        <span className="font-medium">新的承诺交期</span>
        <Input
          type="date"
          className="h-11 text-foreground sm:h-8"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          disabled={pending}
        />
        <span className="text-xs text-muted-foreground">留空表示清除交期，批准后生效。</span>
      </label> : null}

      <label className="block min-w-0 space-y-1 text-sm">
        <span className="font-medium">修改原因</span>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={500}
          required
          disabled={pending}
          className="w-full min-w-0"
          placeholder="写明客户要求、交期影响等，方便管理员审核"
        />
      </label>
    </>
  );
}

function OrderChangeRequestDraftForm({
  foilColorNames,
  orderId,
  expectedRevision,
  expectedWorkOrderVersion,
  items,
  catalogProducts,
  promisedDate = null,
  hasPackagingGroups = false, dueDateOnly = false,
}: Props) {
  const [state, action] = useActionState<
    CreateOrderChangeRequestMutationResult | null,
    unknown
  >(createOrderChangeRequestAction, null);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState('');
  const hasItems = items.length > 0 && !dueDateOnly;
  const [modifyKind, setModifyKind] = useState<ModifyKind>(hasItems ? 'QTY' : 'DUE_DATE');
  const [dueDate, setDueDate] = useState(promisedDate ?? '');
  const dueDateChanged = modifyKind === 'DUE_DATE' && (dueDate || null) !== promisedDate;
  const [editable, setEditable] = useState<Record<string, EditableItem>>(() =>
    Object.fromEntries(
      items.map((item) => [
        item.id,
        createOrderChangeEditableItem(item, catalogProducts),
      ]),
    ),
  );
  const [addEnabled, setAddEnabled] = useState(false);
  const [templateItemId, setTemplateItemId] = useState(items[0]?.id ?? '');
  const [newName, setNewName] = useState('');
  const [newQuantity, setNewQuantity] = useState(1);
  const [newSpecificationSelectionKey, setNewSpecificationSelectionKey] =
    useState('');
  const [newTargetProductId, setNewTargetProductId] = useState<string | null>(
    null,
  );
  const [newSpecification, setNewSpecification] = useState<string | null>(
    null,
  );
  const [newFrontFoilColors, setNewFrontFoilColors] = useState('');
  const [newBackFoilColors, setNewBackFoilColors] = useState('');

  const selectedCount = Object.values(editable).filter(
    (item) => item.selected,
  ).length;
  const selectedChanges = useMemo(
    () => buildSelectedOrderItemChanges(items, editable),
    [editable, items],
  );
  const selectedTemplate = items.find((item) => item.id === templateItemId);
  const newSpecificationOptions = selectedTemplate
    ? listOrderChangeSpecificationOptions({
        sourceItem: selectedTemplate,
        products: catalogProducts,
      })
    : [];
  const unchangedSelectedCount = selectedCount - selectedChanges.length;
  const hasValidAddedItem =
    addEnabled &&
    Boolean(templateItemId) &&
    newName.trim().length > 0 &&
    newQuantity > 0;
  const canSubmit = useMemo(
    () =>
      reason.trim().length > 0 &&
      (selectedChanges.length > 0 || hasValidAddedItem || dueDateChanged) &&
      (!addEnabled || hasValidAddedItem),
    [
      addEnabled,
      hasValidAddedItem,
      reason,
      dueDateChanged,
      selectedChanges.length,
    ],
  );

  function updateItem(itemId: string, patch: Partial<EditableItem>) {
    setEditable((current) => ({
      ...current,
      [itemId]: { ...current[itemId], ...patch },
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !canSubmit) return;
    const changes = buildSelectedOrderItemChanges(items, editable);
    const knownFoilColors = knownOrderFoilColors(foilColorNames ?? [], items);
    if (addEnabled) {
      changes.push({
        operation: 'ADD',
        templateItemId,
        name: newName,
        quantity: newQuantity,
        ...(newSpecification && selectedTemplate?.pricingRoute === 'STOCK_BLANK'
          ? { targetBlankIdentity: { paperType: selectedTemplate.paperType ?? '', paperWeightGsm: selectedTemplate.paperWeightGsm ?? 0, specification: newSpecification } }
          : newTargetProductId && newSpecification ? {
              targetProductId: newTargetProductId,
              specification: newSpecification,
            }
          : {}),
        frontFoilColors: addedItemFoilColors(newFrontFoilColors, knownFoilColors),
        backFoilColors: addedItemFoilColors(newBackFoilColors, knownFoilColors),
      });
    }
    startTransition(() =>
      action(buildOrderChangeRequestPayload({
        orderId,
        expectedRevision,
        expectedWorkOrderVersion,
        modifyKind,
        reason,
        items: changes,
        ...(dueDateChanged ? { promisedDate: dueDate || null } : {}),
      })),
    );
  }

  if (state?.status === 'success') {
    return (
      <div
        role="status"
        className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm"
      >
        修改申请已提交，待管理员审批。
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="min-w-0 space-y-4"
    >
      <p className="text-xs text-muted-foreground">
        {hasItems ? '选择要修改的款式' : dueDateOnly ? '工单已有地址发货，本次只能申请调整交期。' : '未记录款式，本次可申请调整交期。'}
      </p>
      {hasItems ? <ExistingOrderItemChanges
        catalogProducts={catalogProducts}
        editable={editable}
        items={items}
        pending={pending}
        updateItem={updateItem}
        foilColorNames={foilColorNames}
      /> : null}
      {unchangedSelectedCount > 0 ? (
        <p
          role={
            selectedChanges.length === 0 && !hasValidAddedItem
              ? 'alert'
              : 'status'
          }
          className={
            selectedChanges.length === 0 && !hasValidAddedItem
              ? 'text-sm text-destructive'
              : 'text-sm text-muted-foreground'
          }
        >
          {selectedChanges.length === 0 && !hasValidAddedItem
            ? '已勾选的款式内容未发生变化，请修改名称、数量、目录规格或正反面烫金颜色。'
            : `${unchangedSelectedCount} 款内容未发生变化，本次不会提交。`}
        </p>
      ) : null}

      {hasItems && !hasPackagingGroups ? <fieldset className="min-w-0 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">增加款式</legend>
        <label className="flex min-h-11 cursor-pointer items-center gap-1 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-muted-foreground">
          <Checkbox className="-ml-3"
            checked={addEnabled}
            disabled={pending}
            aria-label="本次申请需要添加一款"
            onCheckedChange={setAddEnabled}
          />
          <span className="text-sm">本次申请需要添加一款</span>
        </label>
        {addEnabled ? (
          <div className="grid min-w-0 grid-cols-1 gap-3 border-t pt-3 lg:grid-cols-2">
            <label className="min-w-0 space-y-1 text-sm">
              <span>参考现有款式（沿用纸张和工艺）</span>
              <NativeSelect
                value={templateItemId}
                disabled={pending}
                onChange={(event) => {
                  setTemplateItemId(event.target.value);
                  setNewSpecificationSelectionKey('');
                  setNewTargetProductId(null);
                  setNewSpecification(null);
                }}
                className="w-full min-w-0"
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.sequence} · {externalPriceBusinessText(item.name)}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="min-w-0 space-y-1 text-sm">
              <span>新款式名称</span>
              <Input
                value={newName}
                maxLength={64}
                required
                disabled={pending}
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
            <label className="min-w-0 space-y-1 text-sm">
              <span>数量</span>
              <Input
                type="number"
                min={1}
                step={1}
                value={newQuantity}
                required
                disabled={pending}
                onChange={(event) => setNewQuantity(Number(event.target.value))}
              />
            </label>
            <label className="min-w-0 space-y-1 text-sm">
              <span>规格</span>
              <NativeSelect
                value={newSpecificationSelectionKey}
                disabled={pending || !selectedTemplate}
                onChange={(event) => {
                  const selected = newSpecificationOptions.find(
                    (option) => option.selectionKey === event.target.value,
                  );
                  setNewSpecificationSelectionKey(
                    selected?.selectionKey ?? '',
                  );
                  setNewTargetProductId(selected?.productId ?? null);
                  setNewSpecification(selected?.specification ?? null);
                }}
                className="w-full min-w-0"
              >
                <option value="">
                  继承参考款式规格
                  {selectedTemplate?.specification
                    ? `：${externalPriceBusinessText(selectedTemplate.specification)}`
                    : ''}
                </option>
                {newSpecificationOptions.map((option) => (
                  <option
                    key={option.selectionKey}
                    value={option.selectionKey}
                  >
                    {externalPriceBusinessText(option.specification)}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="min-w-0 space-y-1 text-sm lg:col-span-2">
              <span>正面烫金颜色（可多色）</span>
              <Input
                value={newFrontFoilColors}
                maxLength={200}
                disabled={pending}
                onChange={(event) => setNewFrontFoilColors(event.target.value)}
              />
            </label>
            <label className="min-w-0 space-y-1 text-sm lg:col-span-2">
              <span>反面烫金颜色（可多色）</span>
              <Input
                value={newBackFoilColors}
                maxLength={200}
                disabled={pending}
                onChange={(event) => setNewBackFoilColors(event.target.value)}
              />
            </label>
          </div>
        ) : null}
      </fieldset> : null}

      <OrderChangeReasonFields
        hasItems={hasItems}
        dueDate={dueDate}
        setDueDate={setDueDate}
        modifyKind={modifyKind}
        setModifyKind={setModifyKind}
        reason={reason}
        setReason={setReason}
        pending={pending}
      />
      <StateMessage state={state} />
      <Button type="submit" disabled={pending || !canSubmit} className="min-h-11">
        {pending
          ? '正在提交…'
          : `提交修改申请${selectedChanges.length ? `（${selectedChanges.length} 款）` : ''}`}
      </Button>
    </form>
  );
}
