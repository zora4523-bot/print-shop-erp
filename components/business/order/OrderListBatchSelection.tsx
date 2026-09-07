'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ClipboardCopy, X } from 'lucide-react';
import { OrderStatus } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export type OrderListSelectionItem = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  canSchedule: boolean;
};

export type OrderListSelectionAction =
  | { type: 'toggle'; orderId: string }
  | { type: 'toggle-page'; orderIds: readonly string[] }
  | { type: 'clear' };

export type OrderListBatchFeedbackState = {
  tone: 'success' | 'error';
  message: string;
};

type SelectionContextValue = {
  items: readonly OrderListSelectionItem[];
  selectedIds: ReadonlySet<string>;
  dispatch: (action: OrderListSelectionAction) => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

type BatchBarLayout = 'floating' | 'inline';

/**
 * Keeps selection changes deterministic and page-scoped. The list remounts this
 * provider when the server-side page/filter result changes, so IDs from a
 * previous result set are never carried into a new bulk operation.
 */
export function reduceOrderListSelection(
  current: readonly string[],
  action: OrderListSelectionAction,
): string[] {
  const next = new Set(current);

  if (action.type === 'clear') return [];

  if (action.type === 'toggle') {
    if (next.has(action.orderId)) next.delete(action.orderId);
    else next.add(action.orderId);
    return [...next];
  }

  const pageIds = [...new Set(action.orderIds)];
  const allSelected =
    pageIds.length > 0 && pageIds.every((orderId) => next.has(orderId));
  if (allSelected) {
    pageIds.forEach((orderId) => next.delete(orderId));
  } else {
    pageIds.forEach((orderId) => next.add(orderId));
  }
  return [...next];
}

export function OrderListSelectionProvider({
  items,
  children,
  renderBatchActions,
  batchBarLayout = 'floating',
}: {
  items: readonly OrderListSelectionItem[];
  children: ReactNode;
  batchBarLayout?: BatchBarLayout;
  renderBatchActions?: (
    selectedItems: readonly OrderListSelectionItem[],
  ) => ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const selectedItems = items.filter((item) => selectedIds.has(item.id));

  const value = useMemo<SelectionContextValue>(
    () => ({
      items,
      selectedIds,
      dispatch: (action) =>
        setSelected((current) => reduceOrderListSelection(current, action)),
    }),
    [items, selectedIds],
  );

  const batchBar = (
    <OrderListBatchBar
      selectedItems={selectedItems}
      onClear={() => value.dispatch({ type: 'clear' })}
      renderBatchActions={renderBatchActions}
      layout={batchBarLayout}
    />
  );

  return (
    <SelectionContext.Provider value={value}>
      {batchBarLayout === 'inline' ? batchBar : null}
      {children}
      <p className="sr-only" role="status" aria-live="polite">
        已选 {selectedItems.length} 项工单
      </p>
      {batchBarLayout === 'floating' ? batchBar : null}
    </SelectionContext.Provider>
  );
}

export function OrderListRowSelection({
  orderId,
  orderNo,
}: {
  orderId: string;
  orderNo: string;
}) {
  const selection = useOrderListSelection();
  return (
    <SelectionCheckbox
      checked={selection.selectedIds.has(orderId)}
      label={`选择工单 ${orderNo}`}
      onChange={() => selection.dispatch({ type: 'toggle', orderId })}
    />
  );
}

export function OrderListPageSelection() {
  const selection = useOrderListSelection();
  const orderIds = selection.items.map((item) => item.id);
  const selectedCount = orderIds.filter((id) =>
    selection.selectedIds.has(id),
  ).length;
  const allSelected =
    orderIds.length > 0 && selectedCount === orderIds.length;

  return (
    <SelectionCheckbox
      checked={allSelected}
      indeterminate={selectedCount > 0 && !allSelected}
      label={allSelected ? '取消选择本页工单' : `选择本页 ${orderIds.length} 项工单`}
      onChange={() =>
        selection.dispatch({ type: 'toggle-page', orderIds })
      }
    />
  );
}

export function OrderListBatchBar({
  selectedItems,
  onClear,
  renderBatchActions,
  layout = 'floating',
}: {
  selectedItems: readonly OrderListSelectionItem[];
  onClear: () => void;
  layout?: BatchBarLayout;
  renderBatchActions?: (
    selectedItems: readonly OrderListSelectionItem[],
  ) => ReactNode;
}) {
  const selectionKey = selectedItems.map((item) => item.id).join(':');
  const [feedback, setFeedback] = useState<
    (OrderListBatchFeedbackState & { selectionKey: string }) | null
  >(null);
  const visibleFeedback =
    feedback?.selectionKey === selectionKey ? feedback : null;
  const batchBarRef = useRef<HTMLElement>(null);
  const [batchBarHeight, setBatchBarHeight] = useState<number | null>(null);

  useEffect(() => {
    const batchBar = batchBarRef.current;
    if (layout !== 'floating' || !batchBar || selectedItems.length === 0) return;

    const syncHeight = () => {
      const nextHeight = Math.ceil(batchBar.getBoundingClientRect().height);
      setBatchBarHeight((current) =>
        current === nextHeight ? current : nextHeight,
      );
    };
    syncHeight();
    window.addEventListener('resize', syncHeight);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(syncHeight);
    observer?.observe(batchBar);

    return () => {
      window.removeEventListener('resize', syncHeight);
      observer?.disconnect();
    };
  }, [layout, selectedItems.length, selectionKey]);

  if (selectedItems.length === 0) return null;

  async function copyOrderNumbers() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(
        selectedItems.map((item) => item.orderNo).join('\n'),
      );
      setFeedback({
        selectionKey,
        tone: 'success',
        message: `已复制 ${selectedItems.length} 个工单号`,
      });
    } catch {
      setFeedback({
        selectionKey,
        tone: 'error',
        message: '复制失败，请检查浏览器的剪贴板权限后重试',
      });
    }
  }

  return (
    <>
      {layout === 'floating' ? (
        <div
          data-slot="order-list-batch-placeholder"
          aria-hidden="true"
          className="pointer-events-none pb-[calc(1rem_+_env(safe-area-inset-bottom,0px))]"
        >
          <div
            data-slot="order-list-batch-placeholder-height"
            className="h-32 sm:h-16"
            style={{ height: batchBarHeight ?? undefined }}
          />
        </div>
      ) : null}
      <section
        ref={batchBarRef}
        role="region"
        aria-label="工单批量操作"
        className={cn(
          'flex flex-col rounded-xl bg-foreground py-3 text-background sm:flex-row sm:items-center',
          layout === 'inline'
            ? 'w-full min-w-0 gap-3 px-3.5'
            : 'fixed bottom-[calc(1rem_+_env(safe-area-inset-bottom,0px))] left-1/2 z-40 w-[calc(100%_-_1rem)] max-w-3xl -translate-x-1/2 gap-2 px-3 shadow-xl sm:w-auto sm:min-w-[28rem]',
        )}
      >
        <p className="shrink-0 text-sm font-semibold tabular-nums">
          已选 {selectedItems.length} 项
        </p>
        <div className="hidden h-5 w-px bg-background/20 sm:block" aria-hidden="true" />
        <div className={cn('flex min-w-0 flex-1 flex-wrap gap-2', layout === 'inline' ? 'items-start' : 'items-center')}>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 flex-1 sm:flex-none"
            onClick={copyOrderNumbers}
          >
            <ClipboardCopy aria-hidden="true" />
            复制工单号
          </Button>
          {renderBatchActions?.(selectedItems)}
          <Button
            type="button"
            variant="ghost"
            className={cn('min-h-11 flex-1 text-background hover:bg-background/10 hover:text-background sm:flex-none', layout === 'inline' && 'sm:ml-auto')}
            onClick={onClear}
          >
            <X aria-hidden="true" />
            取消选择
          </Button>
          <OrderListBatchFeedback feedback={visibleFeedback} />
        </div>
      </section>
    </>
  );
}

export function OrderListBatchFeedback({
  feedback,
}: {
  feedback: OrderListBatchFeedbackState | null;
}) {
  return (
    <p
      data-slot="order-list-batch-feedback"
      data-tone={feedback?.tone}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      title={feedback?.message}
      className={cn(
        'min-w-0 basis-full truncate text-xs text-background/75 sm:max-w-48 sm:basis-auto',
        !feedback && 'sr-only',
      )}
    >
      {feedback?.message ?? ''}
    </p>
  );
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <Checkbox
      data-batch-checkbox="true"
      checked={checked}
      indeterminate={indeterminate}
      onCheckedChange={onChange}
      aria-label={label}
    />
  );
}

function useOrderListSelection(): SelectionContextValue {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error('Order list selection controls require their provider');
  }
  return context;
}
